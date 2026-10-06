import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, withActor } from "../db.js";
import { actorOf, HttpError, parse, requireRole, uuidParam } from "../http.js";

const optText = (max = 200) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const isoDate = z.iso.date().nullish().transform((v) => v ?? null);

const clientBody = z.object({
  name: z.string().trim().min(1).max(50),
  gender: z.enum(["男", "女", "其他"]).nullish().transform((v) => v ?? null),
  birthday: isoDate,
  phone: optText(30),
  email: optText(120),
  lineId: optText(60),
  occupation: optText(60),
  family: optText(100),
  tags: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  nextAction: optText(200),
  note: optText(2000),
});

const policyBody = z.object({
  insurer: z.string().trim().min(1).max(60),
  productName: z.string().trim().min(1).max(120),
  category: z.enum(["壽險", "醫療", "重疾", "癌症", "意外", "失能", "長照", "儲蓄", "投資型", "年金", "團保", "其他"]),
  annualPremium: z.number().int().min(0).default(0),
  status: z.enum(["有效", "繳費期滿", "停效", "已到期", "已解約"]).default("有效"),
  commission: z.number().int().min(0).nullish().transform((v) => v ?? null),
  startDate: isoDate,
});

const interactionBody = z.object({
  kind: z.enum(["面談", "電話", "LINE", "新聞分享", "問卷", "建議書", "其他"]),
  content: z.string().trim().min(1).max(2000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

const CLIENT_COLUMNS = `id, name, gender, birthday, phone, email, line_id, occupation, family, tags, next_action, note,
  created_at, updated_at`;

export async function clientRoutes(app: FastifyInstance) {
  // 客戶資料只屬於業務員本人；管理者／主管在 RLS 層就看不到
  const agentOnly = { preHandler: requireRole("agent") };

  app.get("/api/clients", agentOnly, async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().max(50).optional() }), req.query);
    return withActor(actorOf(req), async (db) => {
      const r = await db.query(
        `SELECT c.id, c.name, c.gender, c.birthday, c.occupation, c.family, c.tags, c.next_action,
                date_part('year', age(c.birthday))::int AS age,
                (SELECT count(*)::int FROM client_policies p WHERE p.client_id = c.id AND p.status = '有效') AS policy_count,
                (SELECT max(i.occurred_at) FROM interactions i WHERE i.client_id = c.id) AS last_contact
         FROM clients c
         WHERE $1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR EXISTS (
           SELECT 1 FROM unnest(c.tags) t WHERE t ILIKE '%' || $1 || '%')
         ORDER BY c.updated_at DESC`,
        [q || null],
      );
      return r.rows;
    });
  });

  app.post("/api/clients", agentOnly, async (req, reply) => {
    const b = parse(clientBody, req.body);
    const actor = actorOf(req);
    const row = await withActor(actor, async (db) => {
      const r = await db.query(
        `INSERT INTO clients (org_id, agent_id, name, gender, birthday, phone, email, line_id, occupation, family,
                              tags, next_action, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${CLIENT_COLUMNS}`,
        [actor.orgId, actor.userId, b.name, b.gender, b.birthday, b.phone, b.email, b.lineId, b.occupation,
          b.family, b.tags, b.nextAction, b.note],
      );
      await audit(db, actor, "client.create", "client", r.rows[0].id, req.ip);
      return r.rows[0];
    });
    reply.code(201);
    return row;
  });

  app.get("/api/clients/:id", agentOnly, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const actor = actorOf(req);
    return withActor(actor, async (db) => {
      const c = await db.query(
        `SELECT ${CLIENT_COLUMNS}, date_part('year', age(birthday))::int AS age FROM clients WHERE id = $1`,
        [id],
      );
      if (c.rowCount === 0) throw new HttpError(404, "找不到客戶", "NOT_FOUND");
      const policies = await db.query(
        `SELECT id, insurer, product_name, category, annual_premium, status, commission, start_date
         FROM client_policies WHERE client_id = $1 ORDER BY created_at`,
        [id],
      );
      const interactions = await db.query(
        `SELECT id, kind, content, news_id, occurred_at FROM interactions
         WHERE client_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
        [id],
      );
      // 稽核：誰在什麼時間看了哪位客戶的資料
      await audit(db, actor, "client.view", "client", id, req.ip);
      return { ...c.rows[0], policies: policies.rows, interactions: interactions.rows };
    });
  });

  app.put("/api/clients/:id", agentOnly, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(clientBody, req.body);
    const actor = actorOf(req);
    return withActor(actor, async (db) => {
      const r = await db.query(
        `UPDATE clients SET name = $2, gender = $3, birthday = $4, phone = $5, email = $6, line_id = $7,
           occupation = $8, family = $9, tags = $10, next_action = $11, note = $12, updated_at = now()
         WHERE id = $1 RETURNING ${CLIENT_COLUMNS}`,
        [id, b.name, b.gender, b.birthday, b.phone, b.email, b.lineId, b.occupation, b.family, b.tags,
          b.nextAction, b.note],
      );
      if (r.rowCount === 0) throw new HttpError(404, "找不到客戶", "NOT_FOUND");
      await audit(db, actor, "client.update", "client", id, req.ip);
      return r.rows[0];
    });
  });

  app.delete("/api/clients/:id", agentOnly, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const actor = actorOf(req);
    await withActor(actor, async (db) => {
      const r = await db.query(`DELETE FROM clients WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw new HttpError(404, "找不到客戶", "NOT_FOUND");
      await audit(db, actor, "client.delete", "client", id, req.ip);
    });
    reply.code(204);
  });

  // ---------- 已有保單 ----------

  app.post("/api/clients/:id/policies", agentOnly, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(policyBody, req.body);
    const actor = actorOf(req);
    const row = await withActor(actor, async (db) => {
      const r = await db.query(
        `INSERT INTO client_policies (org_id, agent_id, client_id, insurer, product_name, category, annual_premium,
                                      status, commission, start_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, insurer, product_name, category, annual_premium, status, commission, start_date`,
        [actor.orgId, actor.userId, id, b.insurer, b.productName, b.category, b.annualPremium, b.status,
          b.commission, b.startDate],
      );
      await db.query(`UPDATE clients SET updated_at = now() WHERE id = $1`, [id]);
      return r.rows[0];
    });
    reply.code(201);
    return row;
  });

  app.put("/api/policies/:id", agentOnly, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(policyBody, req.body);
    return withActor(actorOf(req), async (db) => {
      const r = await db.query(
        `UPDATE client_policies SET insurer = $2, product_name = $3, category = $4, annual_premium = $5, status = $6,
           commission = $7, start_date = $8
         WHERE id = $1 RETURNING id, insurer, product_name, category, annual_premium, status, commission, start_date`,
        [id, b.insurer, b.productName, b.category, b.annualPremium, b.status, b.commission, b.startDate],
      );
      if (r.rowCount === 0) throw new HttpError(404, "找不到保單", "NOT_FOUND");
      return r.rows[0];
    });
  });

  app.delete("/api/policies/:id", agentOnly, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    await withActor(actorOf(req), async (db) => {
      const r = await db.query(`DELETE FROM client_policies WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw new HttpError(404, "找不到保單", "NOT_FOUND");
    });
    reply.code(204);
  });

  // ---------- 互動紀錄 ----------

  app.post("/api/clients/:id/interactions", agentOnly, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(interactionBody, req.body);
    const actor = actorOf(req);
    const row = await withActor(actor, async (db) => {
      const r = await db.query(
        `INSERT INTO interactions (org_id, agent_id, client_id, kind, content, occurred_at)
         VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
         RETURNING id, kind, content, news_id, occurred_at`,
        [actor.orgId, actor.userId, id, b.kind, b.content, b.occurredAt ?? null],
      );
      await db.query(`UPDATE clients SET updated_at = now() WHERE id = $1`, [id]);
      return r.rows[0];
    });
    reply.code(201);
    return row;
  });

  app.delete("/api/interactions/:id", agentOnly, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    await withActor(actorOf(req), async (db) => {
      const r = await db.query(`DELETE FROM interactions WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw new HttpError(404, "找不到互動紀錄", "NOT_FOUND");
    });
    reply.code(204);
  });
}
