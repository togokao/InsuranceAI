import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import { config } from "./config.js";
import { InactiveUserError } from "./db.js";
import { HttpError, mapDbError } from "./http.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes, SESSION_COOKIE } from "./routes/auth.js";
import { clientRoutes } from "./routes/clients.js";
import { homeRoutes, newsRoutes } from "./routes/news.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** 不需登入 */
    public?: boolean;
    /** 尚未完成 MFA 設定時仍可呼叫 */
    allowDuringMfaSetup?: boolean;
  }
}

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({ trustProxy: true, ...opts });

  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(rateLimit, { global: false });

  // 預設所有路由都要登入；組織要求 MFA 但本人尚未設定時，只開放 MFA 設定相關路由
  app.addHook("onRequest", async (req) => {
    const routeConfig = req.routeOptions.config;
    if (routeConfig?.public || !req.routeOptions.url) return;
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, "請先登入", "UNAUTHENTICATED");
    }
    if (req.user.mfaSetup && !routeConfig?.allowDuringMfaSetup) {
      throw new HttpError(403, "請先完成多因素驗證設定", "MFA_SETUP_REQUIRED");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof InactiveUserError) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(401).send({ error: "帳號已停用", code: "INACTIVE" });
    }
    const mapped = err instanceof HttpError ? err : mapDbError(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.message, code: mapped.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: (err as Error).message, code: "REQUEST" });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "系統發生錯誤", code: "INTERNAL" });
  });

  app.get("/api/health", { config: { public: true } }, async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(homeRoutes);
  await app.register(clientRoutes);
  await app.register(newsRoutes);
  await app.register(adminRoutes);

  return app;
}
