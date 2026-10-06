import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { audit, withActor } from "../db.js";
import { actorOf, HttpError, parse, requireRole, uuidParam } from "../http.js";

export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: requireRole("org_admin") };

  // 業務員與用量：管理者、主管只看得到統計數字
  app.get("/api/admin/team", { preHandler: requireRole("org_admin", "supervisor") }, async (req) => {
    return withActor(actorOf(req), async (db) => {
      const org = await db.query(`SELECT name, plan, seats, require_mfa FROM organizations`);
      const team = await db.query(`SELECT * FROM team_stats()`);
      return { org: org.rows[0], members: team.rows };
    });
  });

  // 邀請成員：回傳一次性臨時密碼，請成員首次登入後設定 MFA
  app.post("/api/admin/users", adminOnly, async (req, reply) => {
    const b = parse(
      z.object({
        email: z.email(),
        name: z.string().trim().min(1).max(50),
        role: z.enum(["agent", "supervisor"]),
      }),
      req.body,
    );
    const actor = actorOf(req);
    const tempPassword = randomBytes(9).toString("base64url");
    const user = await withActor(actor, async (db) => {
      const { seats } = (await db.query(`SELECT seats FROM organizations`)).rows[0];
      const used = Number((await db.query(`SELECT count(*) FROM users WHERE active`)).rows[0].count);
      if (used >= seats) throw new HttpError(409, `席次已滿（${seats} 席），請升級方案`, "SEATS_FULL");
      const r = await db.query(
        `INSERT INTO users (org_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role`,
        [actor.orgId, b.email, b.name, b.role, await hashPassword(tempPassword)],
      );
      await audit(db, actor, "user.invite", "user", r.rows[0].id, req.ip);
      return r.rows[0];
    });
    reply.code(201);
    return { ...user, tempPassword };
  });

  app.patch("/api/admin/users/:id", adminOnly, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(
      z.object({ active: z.boolean().optional(), role: z.enum(["agent", "supervisor"]).optional() }),
      req.body,
    );
    const actor = actorOf(req);
    return withActor(actor, async (db) => {
      const r = await db.query(
        `UPDATE users SET active = coalesce($2, active), role = coalesce($3, role)
         WHERE id = $1 RETURNING id, email, name, role, active`,
        [id, b.active ?? null, b.role ?? null],
      );
      if (r.rowCount === 0) throw new HttpError(404, "找不到成員", "NOT_FOUND");
      await audit(db, actor, "user.update", "user", id, req.ip);
      return r.rows[0];
    });
  });

  // 合作保險公司
  app.get("/api/admin/partners", async (req) => {
    return withActor(actorOf(req), async (db) => {
      const r = await db.query(
        `SELECT i.id, i.name, i.kind, coalesce(p.active, false) AS active, p.contract_expiry
         FROM insurers i LEFT JOIN org_partners p ON p.insurer_id = i.id
         ORDER BY i.kind, i.name`,
      );
      return r.rows;
    });
  });

  app.put("/api/admin/partners/:id", adminOnly, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(
      z.object({ active: z.boolean(), contractExpiry: z.iso.date().nullish() }),
      req.body,
    );
    const actor = actorOf(req);
    return withActor(actor, async (db) => {
      const r = await db.query(
        `INSERT INTO org_partners (org_id, insurer_id, active, contract_expiry) VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, insurer_id) DO UPDATE SET active = EXCLUDED.active,
           contract_expiry = coalesce(EXCLUDED.contract_expiry, org_partners.contract_expiry)
         RETURNING insurer_id AS id, active, contract_expiry`,
        [actor.orgId, id, b.active, b.contractExpiry ?? null],
      );
      await audit(db, actor, b.active ? "partner.enable" : "partner.disable", "insurer", id, req.ip);
      return r.rows[0];
    });
  });

  // 稽核紀錄
  app.get("/api/admin/audit", adminOnly, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return withActor(actorOf(req), async (db) => {
      const r = await db.query(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.at, u.name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.at DESC LIMIT $1`,
        [limit],
      );
      return r.rows;
    });
  });
}
