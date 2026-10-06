import pg from "pg";
import { config } from "./config.js";

// 讓 date 欄位維持 'YYYY-MM-DD' 字串，避免時區位移
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Role = "platform_admin" | "org_admin" | "supervisor" | "agent";

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
}

export type Tx = pg.PoolClient;

export class InactiveUserError extends Error {}

/**
 * 在交易中以指定使用者身分執行查詢。
 * set_config(..., true) 只在本交易有效，連線歸還連線池後不會殘留身分。
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true), set_config('app.role', $3, true)`,
      [actor.userId, actor.orgId, actor.role],
    );
    // 停用帳號的既有登入憑證立即失效
    const me = await client.query(`SELECT 1 FROM users WHERE id = $1 AND active`, [actor.userId]);
    if (me.rowCount === 0) throw new InactiveUserError();
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 尚未登入時使用（只能呼叫 auth_lookup、open_share 等 SECURITY DEFINER 函式）。 */
export async function anonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function audit(tx: Tx, actor: Actor, action: string, entity?: string, entityId?: string, ip?: string) {
  await tx.query(
    `INSERT INTO audit_logs (org_id, user_id, action, entity, entity_id, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.orgId, actor.userId, action, entity ?? null, entityId ?? null, ip ?? null],
  );
}
