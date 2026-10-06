import type { FastifyInstance } from "fastify";

process.env.LOGIN_RATE_LIMIT ??= "10000";

process.env.MIGRATION_DATABASE_URL ??=
  process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://insuranceai_owner:dev@localhost:5432/insuranceai_test";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgres://insuranceai_api:dev@localhost:5432/insuranceai_test";

export async function login(app: FastifyInstance, email: string, password = "demo1234", otp?: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password, otp } });
  const cookie = res.cookies.find((c) => c.name === "session");
  return { res, cookie: cookie ? `session=${cookie.value}` : "" };
}

export function as(app: FastifyInstance, cookie: string) {
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers: { cookie } }),
    post: (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload: payload as object, headers: { cookie } }),
    put: (url: string, payload?: unknown) => app.inject({ method: "PUT", url, payload: payload as object, headers: { cookie } }),
    patch: (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload: payload as object, headers: { cookie } }),
    del: (url: string) => app.inject({ method: "DELETE", url, headers: { cookie } }),
  };
}
