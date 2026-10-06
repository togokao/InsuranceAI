import { as, login } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { totp } from "../src/auth/totp.js";
import { pool } from "../src/db.js";
import { seed } from "../src/seed.js";

const OWNER_URL = process.env.MIGRATION_DATABASE_URL!;
let app: FastifyInstance;
let owner: pg.Client;

beforeAll(async () => {
  app = await buildApp();
  owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
});

afterAll(async () => {
  await app.close();
  await owner.end();
  await pool.end();
});

beforeEach(async () => {
  await seed(OWNER_URL);
});

describe("認證", () => {
  it("rejects wrong password and unauthenticated requests", async () => {
    const bad = await login(app, "agent@demo.tw", "nope");
    expect(bad.res.statusCode).toBe(401);
    expect(bad.res.json().code).toBe("BAD_CREDENTIALS");
    const unknown = await login(app, "nobody@demo.tw");
    expect(unknown.res.json().code).toBe("BAD_CREDENTIALS");
    expect((await app.inject({ method: "GET", url: "/api/clients" })).statusCode).toBe(401);
  });

  it("logs in and returns the current user", async () => {
    const { res, cookie } = await login(app, "agent@demo.tw");
    expect(res.statusCode).toBe(200);
    const me = (await as(app, cookie).get("/api/me")).json();
    expect(me).toMatchObject({ name: "林子晴", role: "agent", org_name: "示範保經股份有限公司" });
  });

  it("enforces MFA enrollment when the organization requires it", async () => {
    await owner.query(`UPDATE organizations SET require_mfa = true`);
    const first = await login(app, "agent@demo.tw");
    expect(first.res.json().mfaSetupRequired).toBe(true);
    const api = as(app, first.cookie);
    expect((await api.get("/api/clients")).json().code).toBe("MFA_SETUP_REQUIRED");

    const { secret } = (await api.post("/api/auth/mfa/setup")).json();
    expect((await api.post("/api/auth/mfa/enable", { otp: "000000" })).statusCode).toBe(400);
    const enabled = await api.post("/api/auth/mfa/enable", { otp: totp(secret) });
    expect(enabled.statusCode).toBe(200);
    const newCookie = `session=${enabled.cookies.find((c) => c.name === "session")!.value}`;
    expect((await as(app, newCookie).get("/api/clients")).statusCode).toBe(200);

    // 之後登入都要驗證碼
    expect((await login(app, "agent@demo.tw")).res.json().code).toBe("MFA_REQUIRED");
    expect((await login(app, "agent@demo.tw", "demo1234", "123456")).res.json().code).toBe("MFA_INVALID");
    expect((await login(app, "agent@demo.tw", "demo1234", totp(secret))).res.statusCode).toBe(200);
  });

  it("invalidates sessions of deactivated users", async () => {
    const agent = await login(app, "agent@demo.tw");
    const admin = await login(app, "admin@demo.tw");
    const team = (await as(app, admin.cookie).get("/api/admin/team")).json();
    const agentId = team.members.find((m: { email: string }) => m.email === "agent@demo.tw").user_id;
    expect((await as(app, admin.cookie).patch(`/api/admin/users/${agentId}`, { active: false })).statusCode).toBe(200);
    const res = await as(app, agent.cookie).get("/api/clients");
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INACTIVE");
  });
});

describe("資料隔離（RLS）", () => {
  it("agents only see their own clients", async () => {
    const a = as(app, (await login(app, "agent@demo.tw")).cookie);
    const b = as(app, (await login(app, "agent2@demo.tw")).cookie);
    const mine = (await a.get("/api/clients")).json();
    expect(mine).toHaveLength(6);
    expect((await b.get("/api/clients")).json().map((c: { name: string }) => c.name)).toEqual(["周的客戶"]);

    const target = mine[0].id;
    expect((await b.get(`/api/clients/${target}`)).statusCode).toBe(404);
    expect((await b.put(`/api/clients/${target}`, { name: "竄改" })).statusCode).toBe(404);
    expect((await b.del(`/api/clients/${target}`)).statusCode).toBe(404);
    // 不能把保單或互動紀錄掛到別人的客戶
    expect(
      (await b.post(`/api/clients/${target}/policies`, { insurer: "x", productName: "y", category: "壽險" })).statusCode,
    ).toBe(404);
    expect((await b.post(`/api/clients/${target}/interactions`, { kind: "電話", content: "x" })).statusCode).toBe(404);
    expect((await a.get(`/api/clients/${target}`)).json().name).toBe(mine[0].name);
  });

  it("isolates organizations from each other", async () => {
    const other = (await owner.query(`INSERT INTO organizations (name, require_mfa) VALUES ('別家保經', false) RETURNING id`))
      .rows[0].id;
    const hash = (await owner.query(`SELECT password_hash FROM users WHERE email = 'agent@demo.tw'`)).rows[0].password_hash;
    await owner.query(
      `INSERT INTO users (org_id, email, name, role, password_hash) VALUES ($1, 'x@other.tw', '別家業務', 'agent', $2),
       ($1, 'admin@other.tw', '別家管理', 'org_admin', $2)`,
      [other, hash],
    );
    const x = as(app, (await login(app, "x@other.tw")).cookie);
    expect((await x.get("/api/clients")).json()).toEqual([]);
    const otherAdmin = as(app, (await login(app, "admin@other.tw")).cookie);
    const team = (await otherAdmin.get("/api/admin/team")).json();
    expect(team.members.map((m: { name: string }) => m.name).sort()).toEqual(["別家業務", "別家管理"]);
    expect((await otherAdmin.get("/api/admin/audit")).json().every((a: { user_name: string }) => a.user_name.startsWith("別家"))).toBe(true);
  });

  it("managers see team statistics but not client records", async () => {
    const admin = as(app, (await login(app, "admin@demo.tw")).cookie);
    const sup = as(app, (await login(app, "supervisor@demo.tw")).cookie);
    const agent = as(app, (await login(app, "agent@demo.tw")).cookie);
    expect((await admin.get("/api/clients")).statusCode).toBe(403);
    expect((await sup.get("/api/clients")).statusCode).toBe(403);
    const team = (await sup.get("/api/admin/team")).json();
    expect(team.members.find((m: { name: string }) => m.name === "林子晴").client_count).toBe("6");
    expect((await agent.get("/api/admin/team")).statusCode).toBe(403);
    expect((await sup.get("/api/admin/audit")).statusCode).toBe(403);
  });

  it("blocks privilege escalation and secret reads at the database level", async () => {
    const api = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
    try {
      const { id, org_id } = (await owner.query(`SELECT id, org_id FROM users WHERE email = 'agent@demo.tw'`)).rows[0];
      await api.query("BEGIN");
      await api.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true), set_config('app.role', 'agent', true)`,
        [id, org_id],
      );
      await expect(api.query(`UPDATE users SET role = 'org_admin' WHERE id = $1`, [id])).rejects.toMatchObject({
        code: "42501",
      });
      await api.query("ROLLBACK");
      await expect(api.query(`SELECT password_hash FROM users`)).rejects.toMatchObject({ code: "42501" });
      // 沒有身分設定時什麼都看不到
      expect((await api.query(`SELECT * FROM clients`)).rowCount).toBe(0);
    } finally {
      await api.end();
    }
  });
});

describe("客戶管理", () => {
  it("creates, updates and audits client access", async () => {
    const a = as(app, (await login(app, "agent@demo.tw")).cookie);
    const created = await a.post("/api/clients", { name: "新客戶", birthday: "1990-01-02", tags: ["健康"] });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await a.post("/api/clients", { name: "" })).statusCode).toBe(400);
    expect((await a.put(`/api/clients/${id}`, { name: "新客戶", note: "備註", tags: ["退休"] })).json().tags).toEqual(["退休"]);
    expect((await a.post(`/api/clients/${id}/policies`, { insurer: "甲安人壽", productName: "醫療", category: "醫療", annualPremium: 1000 })).statusCode).toBe(201);
    expect((await a.post(`/api/clients/${id}/interactions`, { kind: "電話", content: "初次聯繫" })).statusCode).toBe(201);
    const detail = (await a.get(`/api/clients/${id}`)).json();
    expect(detail.policies).toHaveLength(1);
    expect(detail.interactions[0].content).toBe("初次聯繫");

    const admin = as(app, (await login(app, "admin@demo.tw")).cookie);
    const actions = (await admin.get("/api/admin/audit")).json().map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["client.create", "client.update", "client.view", "auth.login"]));
  });

  it("lists upcoming birthdays on the home page", async () => {
    const home = (await as(app, (await login(app, "agent@demo.tw")).cookie).get("/api/home")).json();
    expect(home.birthdays.map((b: { name: string }) => b.name)).toEqual(["王美玲", "林佳蓉"]);
    expect(home.news).toHaveLength(3);
    expect(home.newsCount).toBe(6);
  });
});

describe("新聞與分享", () => {
  it("matches news to clients by interest tags", async () => {
    const news = (await as(app, (await login(app, "agent@demo.tw")).cookie).get("/api/news?category=投資")).json();
    expect(news.items).toHaveLength(2);
    const names = news.items[0].matched_clients.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["李建國", "王美玲", "陳志豪"].sort());
  });

  it("creates a share, logs the interaction and renders the client page without internal notes", async () => {
    const a = as(app, (await login(app, "agent@demo.tw")).cookie);
    const news = (await a.get("/api/news?category=投資")).json().items[0];
    const client = (await a.get("/api/clients")).json().find((c: { name: string }) => c.name === "陳志豪");
    const share = await a.post(`/api/news/${news.id}/shares`, { clientId: client.id });
    expect(share.statusCode).toBe(201);
    const { token, lineUrl } = share.json();
    expect(lineUrl).toContain("social-plugins.line.me");

    const detail = (await a.get(`/api/clients/${client.id}`)).json();
    expect(detail.interactions[0]).toMatchObject({ kind: "新聞分享", news_id: news.id });

    const page = await app.inject({ method: "GET", url: `/s/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(news.title);
    expect(page.body).toContain("非投資建議");
    expect(page.body).toContain("林子晴");
    expect(page.body).not.toContain(news.angle);
    expect((await owner.query(`SELECT view_count FROM shares WHERE token = $1`, [token])).rows[0].view_count).toBe(1);

    expect((await app.inject({ method: "GET", url: "/s/doesnotexist" })).statusCode).toBe(404);
  });

  it("escapes HTML and drops unsafe links on the share page", async () => {
    const a = as(app, (await login(app, "agent@demo.tw")).cookie);
    const id = (
      await owner.query(
        `INSERT INTO news_items (digest_date, category, title, source_name, url, summary, angle)
         VALUES (current_date, '健康', '<script>alert(1)</script>', 'x', 'javascript:alert(1)', '<img src=x onerror=1>', 'a')
         RETURNING id`,
      )
    ).rows[0].id;
    const { token } = (await a.post(`/api/news/${id}/shares`, {})).json();
    const page = (await app.inject({ method: "GET", url: `/s/${token}` })).body;
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<img");
    expect(page).not.toContain('href="javascript:');
    expect(page).toContain("&lt;script&gt;");
  });

  it("does not let agents share to another agent's client", async () => {
    const a = as(app, (await login(app, "agent@demo.tw")).cookie);
    const b = as(app, (await login(app, "agent2@demo.tw")).cookie);
    const news = (await a.get("/api/news")).json().items[0];
    const target = (await a.get("/api/clients")).json()[0].id;
    expect((await b.post(`/api/news/${news.id}/shares`, { clientId: target })).statusCode).toBe(404);
  });
});

describe("管理者", () => {
  it("invites members within the seat limit and toggles partners", async () => {
    const admin = as(app, (await login(app, "admin@demo.tw")).cookie);
    const invited = await admin.post("/api/admin/users", { email: "new@demo.tw", name: "新人", role: "agent" });
    expect(invited.statusCode).toBe(201);
    const { tempPassword } = invited.json();
    expect((await login(app, "new@demo.tw", tempPassword)).res.statusCode).toBe(200);
    expect((await admin.post("/api/admin/users", { email: "x@demo.tw", name: "x", role: "org_admin" })).statusCode).toBe(400);

    await owner.query(`UPDATE organizations SET seats = 5`);
    expect((await admin.post("/api/admin/users", { email: "y@demo.tw", name: "y", role: "agent" })).json().code).toBe("SEATS_FULL");

    const partners = (await admin.get("/api/admin/partners")).json();
    const off = partners.find((p: { active: boolean }) => !p.active);
    expect((await admin.put(`/api/admin/partners/${off.id}`, { active: true })).json().active).toBe(true);
    const agent = as(app, (await login(app, "agent@demo.tw")).cookie);
    expect((await agent.put(`/api/admin/partners/${off.id}`, { active: false })).statusCode).toBe(403);
  });
});
