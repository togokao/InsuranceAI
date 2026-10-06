#!/usr/bin/env bash
# 建立開發用資料庫與連線角色（只用於本機開發與 CI，正式環境請改用密碼管理服務）。
#
#   PGHOST=localhost PGUSER=postgres ./db/dev-setup.sh [資料庫名稱]
#
# 角色：
#   insuranceai_owner   資料表擁有者，只給 migration／seed 使用
#   insuranceai_api     API 連線用，屬於 insuranceai_app（受 RLS 約束）
#   insuranceai_worker_login  背景 Worker 連線用，屬於 insuranceai_worker
set -euo pipefail

DB="${1:-insuranceai}"
PW="${DEV_DB_PASSWORD:-dev}"

psql -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_owner') THEN
    CREATE ROLE insuranceai_owner LOGIN PASSWORD '${PW}' CREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_app') THEN
    CREATE ROLE insuranceai_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_worker') THEN
    CREATE ROLE insuranceai_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_api') THEN
    CREATE ROLE insuranceai_api LOGIN PASSWORD '${PW}' IN ROLE insuranceai_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_worker_login') THEN
    CREATE ROLE insuranceai_worker_login LOGIN PASSWORD '${PW}' IN ROLE insuranceai_worker;
  END IF;
END \$\$;
SQL

if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB}'" -d postgres | grep -q 1; then
  psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"${DB}\" OWNER insuranceai_owner"
fi
echo "資料庫 ${DB} 已就緒"
