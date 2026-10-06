function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`環境變數 ${name} 未設定`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  // API 以受 RLS 約束的角色連線
  databaseUrl: required("DATABASE_URL", isProd ? undefined : "postgres://insuranceai_api:dev@localhost:5432/insuranceai"),
  // 只給 migration 與開發用 seed 使用的擁有者連線
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL ?? "postgres://insuranceai_owner:dev@localhost:5432/insuranceai",
  jwtSecret: required("JWT_SECRET", isProd ? undefined : "dev-only-secret-change-me-0123456789"),
  // 客戶分享頁的對外網址（LINE 分享連結會用到）
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:5173",
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  // 每個 IP 每分鐘可嘗試登入的次數
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
};
