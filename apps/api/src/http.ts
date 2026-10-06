import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Role } from "./db.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join(".") || "輸入"}：${first.message}` : "輸入格式錯誤", "VALIDATION");
  }
  return r.data;
}

export const uuidParam = z.object({ id: z.uuid() });

export interface SessionClaims {
  sub: string;
  org: string;
  role: Role;
  name: string;
  /** 組織要求 MFA 但本人尚未設定：只能進行 MFA 設定 */
  mfaSetup: boolean;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: SessionClaims;
    user: SessionClaims;
  }
}

export function actorOf(req: FastifyRequest): Actor {
  return { userId: req.user.sub, orgId: req.user.org, role: req.user.role };
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) throw new HttpError(403, "沒有權限執行此操作", "FORBIDDEN");
  };
}

/** 把 PostgreSQL 錯誤轉成合適的 HTTP 狀態碼。 */
export function mapDbError(err: unknown): HttpError | null {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "23505":
      return new HttpError(409, "資料重複", "CONFLICT");
    case "23503":
      return new HttpError(404, "找不到關聯資料", "NOT_FOUND");
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
      return new HttpError(400, "資料格式不正確", "VALIDATION");
    case "42501":
      return new HttpError(403, "沒有權限執行此操作", "FORBIDDEN");
    default:
      return null;
  }
}
