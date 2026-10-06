-- 第一階段：多租戶基礎、輕量客戶管理、每日新聞、分享、稽核
--
-- 權限模型：
--   * 資料表擁有者只用於 migration；API 以 insuranceai_app 身分連線，受 RLS 約束。
--   * 每個 API 請求都在交易內以 set_config('app.*', ..., true) 設定目前使用者，
--     RLS 政策依此判斷可見範圍（不只靠程式判斷）。
--   * 背景 Worker 以 insuranceai_worker 身分連線，只能存取新聞與工作佇列，碰不到客戶資料。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_app') THEN
    CREATE ROLE insuranceai_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insuranceai_worker') THEN
    CREATE ROLE insuranceai_worker NOLOGIN;
  END IF;
END $$;

-- ---------- 目前請求的身分 ----------
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.role', true), '') $$;

-- ---------- 租戶與使用者 ----------
CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  -- 個人業務員單獨訂閱時，也建立一個只有自己的組織
  kind         text NOT NULL DEFAULT 'brokerage' CHECK (kind IN ('brokerage', 'individual')),
  plan         text NOT NULL DEFAULT 'pro',
  seats        int  NOT NULL DEFAULT 10,
  require_mfa  boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'supervisor', 'agent')),
  password_hash  text NOT NULL,
  mfa_secret     text,
  mfa_enabled    boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

-- ---------- 客戶管理（業務員私有） ----------
CREATE TABLE clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  agent_id     uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL,
  gender       text CHECK (gender IN ('男', '女', '其他')),
  birthday     date,
  phone        text,
  email        text,
  line_id      text,
  occupation   text,
  family       text,
  tags         text[] NOT NULL DEFAULT '{}',
  next_action  text,
  note         text,   -- 內部備註：客戶展示模式下隱藏
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_owner_idx ON clients (org_id, agent_id);
CREATE INDEX clients_tags_idx ON clients USING gin (tags);

CREATE TABLE client_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  agent_id        uuid NOT NULL REFERENCES users(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  insurer         text NOT NULL,
  product_name    text NOT NULL,
  category        text NOT NULL CHECK (category IN ('壽險', '醫療', '重疾', '癌症', '意外', '失能', '長照', '儲蓄', '投資型', '年金', '團保', '其他')),
  annual_premium  int  NOT NULL DEFAULT 0 CHECK (annual_premium >= 0),
  status          text NOT NULL DEFAULT '有效' CHECK (status IN ('有效', '繳費期滿', '停效', '已到期', '已解約')),
  commission      int  CHECK (commission >= 0),  -- 預估佣金：客戶展示模式下隱藏
  start_date      date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_policies_client_idx ON client_policies (client_id);

-- ---------- 每日新聞（平台共用） ----------
CREATE TABLE news_sources (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  feed_url  text NOT NULL UNIQUE,
  category  text NOT NULL CHECK (category IN ('健康', '投資', '保險')),
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE news_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date    date NOT NULL,
  category       text NOT NULL CHECK (category IN ('健康', '投資', '保險')),
  title          text NOT NULL,
  source_name    text NOT NULL,
  url            text NOT NULL UNIQUE,
  published_at   timestamptz,
  -- 版權：只存 AI 改寫的摘要與原文連結，不轉載全文
  summary        text NOT NULL,
  angle          text NOT NULL,  -- 聊天切入點（業務員版專用）
  tags           text[] NOT NULL DEFAULT '{}',
  is_investment  boolean NOT NULL DEFAULT false,
  rank           int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_items_digest_idx ON news_items (digest_date DESC, rank);

-- ---------- 互動紀錄與分享 ----------
CREATE TABLE interactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  agent_id     uuid NOT NULL REFERENCES users(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('面談', '電話', 'LINE', '新聞分享', '問卷', '建議書', '其他')),
  content      text NOT NULL,
  news_id      uuid REFERENCES news_items(id) ON DELETE SET NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interactions_client_idx ON interactions (client_id, occurred_at DESC);

CREATE TABLE shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  agent_id    uuid NOT NULL REFERENCES users(id),
  news_id     uuid NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  token       text NOT NULL UNIQUE,
  view_count  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 合作保險公司（各保經公司設定） ----------
CREATE TABLE insurers (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE,
  kind  text NOT NULL CHECK (kind IN ('人壽', '產險'))
);

CREATE TABLE org_partners (
  org_id           uuid NOT NULL REFERENCES organizations(id),
  insurer_id       uuid NOT NULL REFERENCES insurers(id),
  active           boolean NOT NULL DEFAULT true,
  contract_expiry  date,
  PRIMARY KEY (org_id, insurer_id)
);

-- ---------- 稽核日誌 ----------
CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id),
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text,
  entity_id  uuid,
  ip         text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, at DESC);

-- ---------- 工作佇列（背景 Worker） ----------
CREATE TABLE jobs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  dedupe_key  text,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    int  NOT NULL DEFAULT 0,
  run_at      timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, dedupe_key)
);
CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE status = 'queued';

-- =====================================================================
-- 列層級安全性
-- =====================================================================
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares          ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_partners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_self ON organizations
  USING (id = app_org_id());

CREATE POLICY users_same_org ON users FOR SELECT
  USING (org_id = app_org_id());
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (id = app_user_id()) WITH CHECK (id = app_user_id() AND org_id = app_org_id());
CREATE POLICY users_admin_insert ON users FOR INSERT
  WITH CHECK (org_id = app_org_id() AND app_role() = 'org_admin' AND role IN ('agent', 'supervisor'));
CREATE POLICY users_admin_update ON users FOR UPDATE
  USING (org_id = app_org_id() AND app_role() = 'org_admin')
  WITH CHECK (org_id = app_org_id());

-- 客戶相關資料只有負責的業務員本人看得到；管理者與主管只能透過統計函式看數字。
CREATE POLICY clients_owner ON clients
  USING (org_id = app_org_id() AND agent_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND agent_id = app_user_id());
CREATE POLICY client_policies_owner ON client_policies
  USING (org_id = app_org_id() AND agent_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND agent_id = app_user_id());
CREATE POLICY interactions_owner ON interactions
  USING (org_id = app_org_id() AND agent_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND agent_id = app_user_id());
CREATE POLICY shares_owner ON shares
  USING (org_id = app_org_id() AND agent_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND agent_id = app_user_id());

CREATE POLICY partners_read ON org_partners FOR SELECT
  USING (org_id = app_org_id());
CREATE POLICY partners_admin ON org_partners FOR ALL
  USING (org_id = app_org_id() AND app_role() = 'org_admin')
  WITH CHECK (org_id = app_org_id() AND app_role() = 'org_admin');

CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (org_id = app_org_id() AND user_id IS NOT DISTINCT FROM app_user_id());
CREATE POLICY audit_admin_read ON audit_logs FOR SELECT
  USING (org_id = app_org_id() AND app_role() = 'org_admin');

-- 角色與啟用狀態只能由管理者調整，且不能調整自己、不能升為管理者
CREATE FUNCTION guard_user_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active) AND NOT (
    app_role() = 'org_admin' AND OLD.id <> app_user_id() AND NEW.role IN ('agent', 'supervisor')
  ) THEN
    RAISE EXCEPTION 'not allowed to change role or active flag' USING ERRCODE = '42501';
  END IF;
  -- 管理者只能改成員的角色／狀態，不能改別人的密碼或 MFA
  IF OLD.id <> app_user_id() AND (NEW.password_hash IS DISTINCT FROM OLD.password_hash
      OR NEW.mfa_secret IS DISTINCT FROM OLD.mfa_secret OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled
      OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'not allowed to change another user''s credentials' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_user_update();

-- 子資料必須掛在同一位業務員的客戶底下（避免把保單掛到別人的客戶）
CREATE FUNCTION check_client_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.agent_id = NEW.agent_id AND c.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'client % does not belong to agent', NEW.client_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_policies_owner_chk BEFORE INSERT OR UPDATE ON client_policies
  FOR EACH ROW EXECUTE FUNCTION check_client_owner();
CREATE TRIGGER interactions_owner_chk BEFORE INSERT OR UPDATE ON interactions
  FOR EACH ROW EXECUTE FUNCTION check_client_owner();
CREATE TRIGGER shares_owner_chk BEFORE INSERT OR UPDATE ON shares
  FOR EACH ROW EXECUTE FUNCTION check_client_owner();

-- =====================================================================
-- SECURITY DEFINER 函式：需要跨越 RLS 的少數操作，範圍嚴格限制
-- =====================================================================

-- 登入：依 Email 找使用者（此時尚無身分可設定）
CREATE FUNCTION auth_lookup(p_email text)
RETURNS TABLE (id uuid, org_id uuid, role text, name text, password_hash text,
               mfa_secret text, mfa_enabled boolean, require_mfa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.org_id, u.role, u.name, u.password_hash, u.mfa_secret, u.mfa_enabled, o.require_mfa
  FROM users u JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email) AND u.active
$$;

-- 公開分享頁：只回傳客戶版需要的欄位（不含聊天切入點），並累計瀏覽次數
CREATE FUNCTION open_share(p_token text)
RETURNS TABLE (title text, summary text, url text, source_name text, category text,
               is_investment boolean, agent_name text, org_name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE shares SET view_count = view_count + 1 WHERE token = p_token;
  SELECT n.title, n.summary, n.url, n.source_name, n.category, n.is_investment, u.name, o.name
  FROM shares s
  JOIN news_items n ON n.id = s.news_id
  JOIN users u ON u.id = s.agent_id
  JOIN organizations o ON o.id = s.org_id
  WHERE s.token = p_token
$$;

-- 團隊統計：管理者／主管只看得到數字，看不到個別客戶資料
CREATE FUNCTION team_stats()
RETURNS TABLE (user_id uuid, name text, email text, role text, active boolean, mfa_enabled boolean,
               client_count bigint, share_count_30d bigint, interaction_count_30d bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.name, u.email, u.role, u.active, u.mfa_enabled,
         (SELECT count(*) FROM clients c WHERE c.agent_id = u.id),
         (SELECT count(*) FROM shares s WHERE s.agent_id = u.id AND s.created_at > now() - interval '30 days'),
         (SELECT count(*) FROM interactions i WHERE i.agent_id = u.id AND i.occurred_at > now() - interval '30 days')
  FROM users u
  WHERE u.org_id = app_org_id() AND app_role() IN ('org_admin', 'supervisor')
  ORDER BY u.created_at
$$;

REVOKE ALL ON FUNCTION auth_lookup(text), open_share(text), team_stats() FROM PUBLIC;

-- =====================================================================
-- 權限
-- =====================================================================
GRANT USAGE ON SCHEMA public TO insuranceai_app, insuranceai_worker;

GRANT SELECT ON organizations TO insuranceai_app;
-- 欄位層級授權：密碼雜湊與 MFA 金鑰不可被查詢（登入時透過 auth_lookup 取得）
GRANT SELECT (id, org_id, email, name, role, mfa_enabled, active, created_at) ON users TO insuranceai_app;
GRANT INSERT (org_id, email, name, role, password_hash) ON users TO insuranceai_app;
GRANT UPDATE (name, role, active, password_hash, mfa_secret, mfa_enabled) ON users TO insuranceai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients, client_policies, interactions, shares TO insuranceai_app;
GRANT SELECT ON news_items, insurers TO insuranceai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_partners TO insuranceai_app;
GRANT SELECT, INSERT ON audit_logs TO insuranceai_app;
GRANT EXECUTE ON FUNCTION auth_lookup(text), open_share(text), team_stats() TO insuranceai_app;
GRANT EXECUTE ON FUNCTION app_user_id(), app_org_id(), app_role() TO insuranceai_app;

GRANT SELECT ON news_sources TO insuranceai_worker;
GRANT SELECT, INSERT, UPDATE ON news_items TO insuranceai_worker;
GRANT SELECT, INSERT, UPDATE ON jobs TO insuranceai_worker;
