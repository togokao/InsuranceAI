/** 依序套用 db/migrations/*.sql（以資料表擁有者身分執行）。 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations/", import.meta.url));

export async function migrate(connectionString = config.migrationDatabaseUrl, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        log(`已套用 ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`套用 ${file} 失敗：${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
}
