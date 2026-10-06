/**
 * 開發用示範資料（全部為虛構）。會清空既有資料！
 *
 *   npm run db:seed
 *
 * 示範帳號（密碼皆為 demo1234，示範組織不強制 MFA）：
 *   agent@demo.tw       一般業務 · 林子晴
 *   agent2@demo.tw      一般業務 · 周承翰
 *   supervisor@demo.tw  主管
 *   admin@demo.tw       保經公司管理者
 */
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "./auth/password.js";
import { config } from "./config.js";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 生日：距今 offsetDays 天後過生日、今年滿 age 歲 */
function birthday(age: number, offsetDays: number, today = new Date()): string {
  const next = new Date(today.getTime() + offsetDays * DAY);
  next.setUTCFullYear(next.getUTCFullYear() - age);
  return iso(next);
}

export async function seed(connectionString = config.migrationDatabaseUrl, today = new Date()) {
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(`TRUNCATE audit_logs, shares, interactions, client_policies, clients, org_partners,
                     users, organizations, news_items, news_sources, insurers, jobs RESTART IDENTITY CASCADE`);

    const org = (
      await db.query(
        `INSERT INTO organizations (name, plan, seats, require_mfa) VALUES ('示範保經股份有限公司', 'pro', 10, false)
         RETURNING id`,
      )
    ).rows[0].id as string;

    const pw = await hashPassword("demo1234");
    const user = async (email: string, name: string, role: string) =>
      (
        await db.query(
          `INSERT INTO users (org_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [org, email, name, role, pw],
        )
      ).rows[0].id as string;
    const agent = await user("agent@demo.tw", "林子晴", "agent");
    const agent2 = await user("agent2@demo.tw", "周承翰", "agent");
    await user("supervisor@demo.tw", "吳督導", "supervisor");
    await user("admin@demo.tw", "陳管理", "org_admin");

    // ---------- 保險公司與合作設定 ----------
    const insurers: Record<string, string> = {};
    for (const [name, kind] of [
      ["甲安人壽", "人壽"], ["乙泰人壽", "人壽"], ["丙聯人壽", "人壽"], ["戊豐人壽", "人壽"], ["丁和產險", "產險"],
    ] as const) {
      insurers[name] = (await db.query(`INSERT INTO insurers (name, kind) VALUES ($1, $2) RETURNING id`, [name, kind]))
        .rows[0].id;
    }
    for (const [name, active, expiry] of [
      ["甲安人壽", true, "2027-06-30"], ["乙泰人壽", true, "2026-12-31"], ["丙聯人壽", true, "2027-03-31"],
      ["丁和產險", true, "2027-01-31"], ["戊豐人壽", false, null],
    ] as const) {
      await db.query(`INSERT INTO org_partners (org_id, insurer_id, active, contract_expiry) VALUES ($1, $2, $3, $4)`, [
        org, insurers[name], active, expiry,
      ]);
    }

    // ---------- 客戶 ----------
    type P = [insurer: string, product: string, category: string, premium: number, status: string, commission: number | null];
    type C = {
      name: string; gender: string; age: number; bdayIn: number | null; job: string; family: string; tags: string[];
      next: string; note: string; policies: P[]; log: [daysAgo: number, kind: string, text: string][];
    };
    const clients: C[] = [
      { name: "王美玲", gender: "女", age: 38, bdayIn: 2, job: "國中教師", family: "已婚 · 2 子", tags: ["健康", "教育金", "退休"],
        next: "寄送醫療險簡化說明", note: "先生為自營業，收入波動大；客戶在意保費不超過月薪 8%。",
        policies: [["甲安人壽", "安家定期壽險 20 年", "壽險", 8900, "有效", 2670], ["學校團保", "團體醫療", "團保", 0, "有效", null]],
        log: [[4, "LINE", "分享「流感疫苗開打」，客戶回覆想了解小孩醫療"], [8, "面談", "討論醫療險升級，取得建議書"]] },
      { name: "陳志豪", gender: "男", age: 45, bdayIn: null, job: "半導體工程師", family: "已婚 · 1 女", tags: ["投資", "退休", "節稅"],
        next: "討論美元利變型保單", note: "偏好美元資產，對匯率風險有概念。",
        policies: [["丙聯人壽", "穩健美元利率變動型終身壽", "壽險", 120000, "有效", 24000], ["丁和產險", "意外傷害實支", "意外", 2860, "有效", 570]],
        log: [[3, "問卷", "已發送需求問卷"], [21, "面談", "討論匯率風險與資產配置"]] },
      { name: "林佳蓉", gender: "女", age: 32, bdayIn: 5, job: "產品經理", family: "已婚 · 新生兒", tags: ["親子", "健康"],
        next: "寶寶醫療險規劃", note: "寶寶 9 月出生，想在滿月前規劃好。",
        policies: [["乙泰人壽", "樂活一次金重大傷病", "重疾", 12600, "有效", 3150]],
        log: [[2, "問卷", "問卷連結已開啟，尚未填寫"]] },
      { name: "張文雄", gender: "男", age: 62, bdayIn: 40, job: "退休公務員", family: "已婚 · 子女皆成年", tags: ["長照", "健康", "傳承"],
        next: "長照險說明已完成，約面談", note: "子女在國外，關心未來照護安排。",
        policies: [["甲安人壽", "終身醫療（舊型）", "醫療", 15600, "繳費期滿", null]],
        log: [[5, "建議書", "長照險簡化說明產出完成"], [16, "電話", "電話關心健康檢查結果"]] },
      { name: "黃怡君", gender: "女", age: 29, bdayIn: 120, job: "平面設計師", family: "未婚", tags: ["健康", "旅遊"],
        next: "問卷已回覆，待媒合", note: "接案收入不穩，預算以月 3,000 元為上限。",
        policies: [["公司團保", "團體醫療", "團保", 0, "有效", null]],
        log: [[1, "問卷", "完成需求問卷"], [6, "新聞分享", "分享「規律運動降低慢性病風險」"]] },
      { name: "李建國", gender: "男", age: 51, bdayIn: 200, job: "餐飲業負責人", family: "已婚 · 2 子", tags: ["投資", "傳承", "企業"],
        next: "員工團保續約", note: "公司 18 位員工，團保 11 月到期。",
        policies: [["乙泰人壽", "安家定期壽險", "壽險", 21000, "有效", 5250]],
        log: [[11, "面談", "討論員工團保續約"]] },
    ];
    for (const c of clients) {
      const id = (
        await db.query(
          `INSERT INTO clients (org_id, agent_id, name, gender, birthday, occupation, family, tags, next_action, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [org, agent, c.name, c.gender, c.bdayIn === null ? null : birthday(c.age, c.bdayIn, today), c.job, c.family,
            c.tags, c.next, c.note],
        )
      ).rows[0].id;
      for (const [insurer, product, category, premium, status, commission] of c.policies) {
        await db.query(
          `INSERT INTO client_policies (org_id, agent_id, client_id, insurer, product_name, category, annual_premium, status, commission)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [org, agent, id, insurer, product, category, premium, status, commission],
        );
      }
      for (const [daysAgo, kind, text] of c.log) {
        await db.query(
          `INSERT INTO interactions (org_id, agent_id, client_id, kind, content, occurred_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [org, agent, id, kind, text, new Date(today.getTime() - daysAgo * DAY)],
        );
      }
    }
    // 另一位業務員的客戶：用來驗證彼此看不到
    await db.query(
      `INSERT INTO clients (org_id, agent_id, name, tags, next_action) VALUES ($1, $2, '周的客戶', '{健康}', '只有周承翰看得到')`,
      [org, agent2],
    );

    // ---------- 新聞來源與示範新聞 ----------
    // 新聞來源請由平台管理員依授權狀況設定；此處僅放示範用網址
    await db.query(
      `INSERT INTO news_sources (name, feed_url, category, active) VALUES
       ('示範健康新聞', 'https://example.com/health.rss', '健康', false),
       ('示範財經新聞', 'https://example.com/finance.rss', '投資', false),
       ('示範保險新聞', 'https://example.com/insurance.rss', '保險', false)`,
    );
    const news: [string, string, string, string, string, string[], boolean][] = [
      ["健康", "流感疫苗本週起分批開打，長者與幼兒優先接種", "示範新聞網",
        "各地衛生單位公布接種時程，65 歲以上長者、幼兒及慢性病患者為第一階段對象，建議儘早預約。",
        "問問客戶家中長輩與小孩的接種安排，順勢關心醫療與長照保障是否足夠。", ["健康", "親子", "長照"], false],
      ["健康", "研究：每週運動 150 分鐘，可降低多種慢性病風險", "示範健康誌",
        "大型追蹤研究顯示，規律中等強度運動與心血管疾病、第二型糖尿病風險下降有關。",
        "可帶到「外溢保單」：運動達標可折減保費，適合年輕、愛運動的客戶。", ["健康"], false],
      ["投資", "主要央行利率決策出爐，市場關注美元走勢", "示範財經",
        "市場預期利率維持不變，美元指數小幅波動，分析師關注後續通膨數據。",
        "適合和持有美元保單的客戶聊匯率風險觀念；只談觀念，不做買賣建議。", ["投資", "退休"], true],
      ["投資", "高股息 ETF 受益人數創新高，退休族群比重增加", "示範財經",
        "退休與屆退族群為主要增加來源，專家提醒留意配息來源與集中度風險。",
        "聊退休現金流規劃，帶出「穩定給付」與「資產分散」的話題。", ["投資", "退休"], true],
      ["保險", "主管機關研議調整保險商品資訊揭露格式，要求更易讀", "示範保險報",
        "草案方向是以圖表與重點摘要呈現保障內容與費用，降低消費者閱讀門檻。",
        "正好說明你提供「簡化說明書」的服務，強化專業形象。", ["健康", "退休", "投資"], false],
      ["保險", "長照需求人口持續增加，長照險詢問度明顯上升", "示範保險報",
        "家庭照護負擔增加，民眾開始比較長照險與類長照險的給付條件差異。",
        "適合有長輩或自身接近退休的客戶，可先寄長照險簡化說明。", ["長照", "退休", "傳承"], false],
    ];
    let rank = 0;
    for (const [category, title, source, summary, angle, tags, invest] of news) {
      await db.query(
        `INSERT INTO news_items (digest_date, category, title, source_name, url, published_at, summary, angle, tags,
                                 is_investment, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [iso(today), category, title, source, `https://example.com/demo-news/${rank + 1}`,
          new Date(today.getTime() - (rank + 1) * 1800_000), summary, angle, tags, invest, rank++],
      );
    }
    await db.query("COMMIT");
    return { org, agent, agent2 };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seed();
  console.log("已建立示範資料。示範帳號：agent@demo.tw / demo1234（另有 admin@、supervisor@、agent2@）");
}
