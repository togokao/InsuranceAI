import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { generateSecret, otpauthUri, verifyTotp } from "../auth/totp.js";
import { config } from "../config.js";
import { anonymous, audit, withActor } from "../db.js";
import { actorOf, HttpError, parse, type SessionClaims } from "../http.js";

export const SESSION_COOKIE = "session";

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  otp: z.string().trim().optional(),
});

async function issueSession(app: FastifyInstance, reply: FastifyReply, claims: SessionClaims) {
  const token = await reply.jwtSign(claims, { expiresIn: `${config.sessionHours}h` });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd,
    maxAge: config.sessionHours * 3600,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    { config: { public: true, rateLimit: { max: config.loginRateLimit, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(loginBody, req.body);
      const user = await anonymous(async (db) => {
        const r = await db.query(`SELECT * FROM auth_lookup($1)`, [body.email]);
        return r.rows[0] as
          | { id: string; org_id: string; role: SessionClaims["role"]; name: string; password_hash: string;
              mfa_secret: string | null; mfa_enabled: boolean; require_mfa: boolean }
          | undefined;
      });
      // 帳號不存在或密碼錯誤回同一個訊息，避免被用來探測帳號
      if (!user || !(await verifyPassword(body.password, user.password_hash))) {
        throw new HttpError(401, "帳號或密碼錯誤", "BAD_CREDENTIALS");
      }
      if (user.mfa_enabled) {
        if (!body.otp) throw new HttpError(401, "請輸入驗證碼", "MFA_REQUIRED");
        if (!user.mfa_secret || !verifyTotp(user.mfa_secret, body.otp)) {
          throw new HttpError(401, "驗證碼錯誤", "MFA_INVALID");
        }
      }
      const claims: SessionClaims = {
        sub: user.id,
        org: user.org_id,
        role: user.role,
        name: user.name,
        mfaSetup: user.require_mfa && !user.mfa_enabled,
      };
      await withActor({ userId: user.id, orgId: user.org_id, role: user.role }, (db) =>
        audit(db, { userId: user.id, orgId: user.org_id, role: user.role }, "auth.login", "user", user.id, req.ip),
      );
      await issueSession(app, reply, claims);
      return { ok: true, mfaSetupRequired: claims.mfaSetup };
    },
  );

  app.post("/api/auth/logout", { config: { public: true } }, async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { config: { allowDuringMfaSetup: true } }, async (req) => {
    return withActor(actorOf(req), async (db) => {
      const me = await db.query(
        `SELECT u.id, u.email, u.name, u.role, u.mfa_enabled, o.name AS org_name, o.kind AS org_kind, o.require_mfa
         FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`,
        [req.user.sub],
      );
      return { ...me.rows[0], mfa_setup_required: req.user.mfaSetup };
    });
  });

  // 產生新的 MFA 金鑰（尚未啟用，需以驗證碼確認後才生效）
  app.post("/api/auth/mfa/setup", { config: { allowDuringMfaSetup: true } }, async (req) => {
    const secret = generateSecret();
    return withActor(actorOf(req), async (db) => {
      const r = await db.query(
        `UPDATE users SET mfa_secret = $1 WHERE id = $2 AND NOT mfa_enabled RETURNING email`,
        [secret, req.user.sub],
      );
      if (r.rowCount === 0) throw new HttpError(409, "已啟用多因素驗證", "MFA_ALREADY_ENABLED");
      return { secret, otpauthUri: otpauthUri(secret, r.rows[0].email) };
    });
  });

  app.post("/api/auth/mfa/enable", { config: { allowDuringMfaSetup: true } }, async (req, reply) => {
    const { otp } = parse(z.object({ otp: z.string().trim() }), req.body);
    await withActor(actorOf(req), async (db) => {
      const email = (await db.query(`SELECT email FROM users WHERE id = $1`, [req.user.sub])).rows[0]?.email;
      const secret = (await db.query(`SELECT mfa_secret FROM auth_lookup($1)`, [email])).rows[0]?.mfa_secret;
      if (!secret) throw new HttpError(400, "請先產生 MFA 金鑰", "MFA_NOT_SETUP");
      if (!verifyTotp(secret, otp)) throw new HttpError(400, "驗證碼錯誤，請確認手機時間正確", "MFA_INVALID");
      await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [req.user.sub]);
      await audit(db, actorOf(req), "auth.mfa_enabled", "user", req.user.sub, req.ip);
    });
    const { sub, org, role, name } = req.user; // 不可帶入舊 token 的 iat/exp
    await issueSession(app, reply, { sub, org, role, name, mfaSetup: false });
    return { ok: true };
  });
}
