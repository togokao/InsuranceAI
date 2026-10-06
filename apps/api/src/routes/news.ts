import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { anonymous, withActor } from "../db.js";
import { actorOf, HttpError, parse, requireRole, uuidParam } from "../http.js";
import { renderSharePage } from "../share-page.js";

export const INVESTMENT_DISCLAIMER = "以上內容僅供參考，非投資建議。";

export async function newsRoutes(app: FastifyInstance) {
  // 新聞是平台共用；「可能感興趣的客戶」依業務員自己的客戶標籤比對（RLS 自動限縮範圍）
  app.get("/api/news", async (req) => {
    const q = parse(
      z.object({
        date: z.iso.date().optional(),
        category: z.enum(["健康", "投資", "保險"]).optional(),
      }),
      req.query,
    );
    return withActor(actorOf(req), async (db) => {
      const date =
        q.date ?? (await db.query(`SELECT max(digest_date) AS d FROM news_items`)).rows[0]?.d ?? null;
      if (!date) return { date: null, items: [] };
      const items = await db.query(
        `SELECT n.id, n.digest_date, n.category, n.title, n.source_name, n.url, n.published_at, n.summary,
                n.angle, n.tags, n.is_investment,
                coalesce((
                  SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.updated_at DESC)
                  FROM clients c WHERE c.tags && n.tags
                ), '[]'::json) AS matched_clients
         FROM news_items n
         WHERE n.digest_date = $1 AND ($2::text IS NULL OR n.category = $2)
         ORDER BY n.rank, n.published_at DESC NULLS LAST`,
        [date, q.category ?? null],
      );
      return { date, items: items.rows };
    });
  });

  // 建立分享連結；指定客戶時同時寫入互動紀錄
  app.post("/api/news/:id/shares", { preHandler: requireRole("agent") }, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const { clientId } = parse(z.object({ clientId: z.uuid().nullish() }), req.body ?? {});
    const actor = actorOf(req);
    const token = randomBytes(12).toString("base64url");
    const result = await withActor(actor, async (db) => {
      const news = await db.query(`SELECT title FROM news_items WHERE id = $1`, [id]);
      if (news.rowCount === 0) throw new HttpError(404, "找不到新聞", "NOT_FOUND");
      await db.query(
        `INSERT INTO shares (org_id, agent_id, news_id, client_id, token) VALUES ($1, $2, $3, $4, $5)`,
        [actor.orgId, actor.userId, id, clientId ?? null, token],
      );
      if (clientId) {
        await db.query(
          `INSERT INTO interactions (org_id, agent_id, client_id, kind, content, news_id)
           VALUES ($1, $2, $3, '新聞分享', $4, $5)`,
          [actor.orgId, actor.userId, clientId, `LINE 分享「${news.rows[0].title}」`, id],
        );
        await db.query(`UPDATE clients SET updated_at = now() WHERE id = $1`, [clientId]);
      }
      return news.rows[0];
    });
    const url = `${config.publicBaseUrl}/s/${token}`;
    reply.code(201);
    return {
      token,
      url,
      lineUrl: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`,
      title: result.title,
    };
  });

  // 客戶看到的分享頁（不需登入、純 HTML）
  app.get("/s/:token", { config: { public: true } }, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }), req.params);
    const row = await anonymous(async (db) => (await db.query(`SELECT * FROM open_share($1)`, [token])).rows[0]);
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    if (!row) {
      reply.code(404).type("text/html; charset=utf-8");
      return renderSharePage(null);
    }
    reply.type("text/html; charset=utf-8");
    return renderSharePage({
      title: row.title,
      summary: row.summary,
      url: row.url,
      sourceName: row.source_name,
      category: row.category,
      disclaimer: row.is_investment ? INVESTMENT_DISCLAIMER : null,
      agentName: row.agent_name,
      orgName: row.org_name,
    });
  });
}

export async function homeRoutes(app: FastifyInstance) {
  app.get("/api/home", async (req) => {
    return withActor(actorOf(req), async (db) => {
      // 7 天內生日（處理跨年）
      const birthdays = await db.query(
        `SELECT id, name, birthday, next_bday,
                (next_bday - current_date) AS days_left,
                date_part('year', age(next_bday, birthday))::int AS turning
         FROM (
           SELECT id, name, birthday,
                  CASE WHEN make_date(extract(year FROM current_date)::int, extract(month FROM birthday)::int, 1)
                            + (extract(day FROM birthday)::int - 1) >= current_date
                       THEN make_date(extract(year FROM current_date)::int, extract(month FROM birthday)::int, 1)
                            + (extract(day FROM birthday)::int - 1)
                       ELSE make_date(extract(year FROM current_date)::int + 1, extract(month FROM birthday)::int, 1)
                            + (extract(day FROM birthday)::int - 1)
                  END AS next_bday
           FROM clients WHERE birthday IS NOT NULL
         ) x
         WHERE next_bday <= current_date + 7
         ORDER BY next_bday`,
      );
      const followups = await db.query(
        `SELECT id, name, next_action, tags FROM clients
         WHERE next_action IS NOT NULL ORDER BY updated_at DESC LIMIT 8`,
      );
      const date = (await db.query(`SELECT max(digest_date) AS d FROM news_items`)).rows[0]?.d ?? null;
      const news = date
        ? (
            await db.query(
              `SELECT id, category, title, source_name, published_at, angle, is_investment
               FROM news_items WHERE digest_date = $1 ORDER BY rank LIMIT 3`,
              [date],
            )
          ).rows
        : [];
      const newsCount = date
        ? Number((await db.query(`SELECT count(*) FROM news_items WHERE digest_date = $1`, [date])).rows[0].count)
        : 0;
      return { birthdays: birthdays.rows, followups: followups.rows, news, newsDate: date, newsCount };
    });
  });
}
