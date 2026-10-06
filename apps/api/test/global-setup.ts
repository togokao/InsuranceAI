/**
 * 整合測試需要 PostgreSQL。使用獨立的測試資料庫：
 *   TEST_MIGRATION_DATABASE_URL（擁有者）與 TEST_DATABASE_URL（API 角色）
 * 預設為本機 insuranceai_test，可先執行：PGUSER=postgres ./db/dev-setup.sh insuranceai_test
 */
import pg from "pg";

export default async function setup() {
  const owner =
    process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://insuranceai_owner:dev@localhost:5432/insuranceai_test";
  process.env.MIGRATION_DATABASE_URL = owner;
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? "postgres://insuranceai_api:dev@localhost:5432/insuranceai_test";

  // 每次測試從乾淨的 schema 開始
  const c = new pg.Client({ connectionString: owner });
  await c.connect();
  await c.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await c.end();

  const { migrate } = await import("../src/migrate.js");
  await migrate(owner, () => {});
}
