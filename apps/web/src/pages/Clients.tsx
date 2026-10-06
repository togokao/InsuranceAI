import { useState, type FormEvent } from "react";
import { api, fmt, type ClientDetail, type ClientSummary, type Policy } from "../api";
import { navigate, usePresent } from "../App";
import { Avatar, fmtDate, Icon, Loading, Modal, useLoad, useToast } from "../ui";

const SUGGESTED_TAGS = ["健康", "親子", "長照", "投資", "退休", "節稅", "傳承", "旅遊", "教育金", "企業"];
const POLICY_CATEGORIES = ["壽險", "醫療", "重疾", "癌症", "意外", "失能", "長照", "儲蓄", "投資型", "年金", "團保", "其他"];
const POLICY_STATUSES = ["有效", "繳費期滿", "停效", "已到期", "已解約"];
const INTERACTION_KINDS = ["面談", "電話", "LINE", "新聞分享", "問卷", "建議書", "其他"];

export function ClientsPage({ selectedId }: { selectedId?: string }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => api.get<ClientSummary[]>(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`), [q]);
  const currentId = selectedId ?? list.data?.[0]?.id;

  return (
    <div className="md">
      <section className="panel sensitive">
        <div className="panel-h">
          <input className="search" type="search" placeholder="搜尋姓名或標籤" aria-label="搜尋客戶" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn small primary" onClick={() => setCreating(true)} aria-label="新增客戶">
            <Icon name="plus" size={16} />新增
          </button>
        </div>
        {!list.data ? (
          <Loading error={list.error} />
        ) : list.data.length === 0 ? (
          <p className="empty">{q ? "找不到符合的客戶" : "還沒有客戶，點「新增」開始建檔"}</p>
        ) : (
          <ul className="list">
            {list.data.map((c) => (
              <li key={c.id}>
                <button className="row" onClick={() => navigate("clients", c.id)} aria-current={c.id === currentId || undefined}>
                  <Avatar name={c.name} />
                  <span className="row-main">
                    <b style={c.id === currentId ? { color: "var(--brand)" } : undefined}>{c.name}</b>
                    <small>{[c.age != null && `${c.age} 歲`, c.occupation].filter(Boolean).join(" · ") || "—"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {currentId ? (
        <ClientDetailView key={currentId} id={currentId} onChanged={list.reload} />
      ) : (
        list.data && <section className="panel"><p className="empty">請從左側選擇客戶</p></section>
      )}
      {creating && (
        <ClientForm
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            list.reload();
            navigate("clients", c.id);
          }}
        />
      )}
    </div>
  );
}

function ClientDetailView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const present = usePresent();
  const toast = useToast();
  const { data: c, error, reload } = useLoad(() => api.get<ClientDetail>(`/api/clients/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [policy, setPolicy] = useState<Policy | "new" | null>(null);

  if (!c) return <Loading error={error} />;

  const refresh = () => {
    reload();
    onChanged();
  };
  const remove = async () => {
    if (!confirm(`確定刪除客戶「${c.name}」？保單與互動紀錄會一併刪除，無法復原。`)) return;
    await api.del(`/api/clients/${c.id}`);
    toast("已刪除客戶");
    onChanged();
    navigate("clients");
  };
  const removePolicy = async (p: Policy) => {
    if (!confirm(`刪除保單「${p.product_name}」？`)) return;
    await api.del(`/api/policies/${p.id}`);
    reload();
  };
  const totalPremium = c.policies.filter((p) => p.status === "有效").reduce((s, p) => s + p.annual_premium, 0);

  return (
    <div className="stack">
      <section className="panel">
        <div className="client-head">
          <Avatar name={c.name} />
          <div>
            <h2>{c.name}</h2>
            <p className="muted small">
              {[c.age != null && `${c.age} 歲`, c.gender, c.occupation, c.family].filter(Boolean).join(" · ") || "尚未填寫基本資料"}
            </p>
            <div className="chips" style={{ marginTop: 6 }}>
              {c.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          </div>
          <div className="client-actions sensitive">
            <button className="btn small" onClick={() => setEditing(true)}><Icon name="edit" size={16} />編輯</button>
            <button className="btn small" onClick={remove} aria-label="刪除客戶"><Icon name="trash" size={16} /></button>
          </div>
        </div>
        {(c.next_action || c.birthday) && (
          <p className="small sensitive">
            {c.next_action && <><b>下一步：</b>{c.next_action}　</>}
            {c.birthday && <span className="muted">生日 {fmtDate(c.birthday)}</span>}
          </p>
        )}
      </section>

      <section className="panel">
        <header className="panel-h">
          <h2>已有保單</h2>
          <span className="mock-note">{c.policies.length} 張 · 有效保單年繳 {fmt(totalPremium)} 元</span>
          <button className="btn small sensitive" onClick={() => setPolicy("new")}><Icon name="plus" size={16} />新增保單</button>
        </header>
        {c.policies.length === 0 ? (
          <p className="empty">尚無保單資料</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>保險公司</th><th>商品</th><th>類型</th><th className="r">年繳保費</th><th>狀態</th>
                  <th className="r sensitive">預估佣金</th><th className="sensitive"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {c.policies.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{p.insurer}</td>
                    <td>{p.product_name}</td>
                    <td className="nowrap">{p.category}</td>
                    <td className="r num">{p.annual_premium ? fmt(p.annual_premium) : "—"}</td>
                    <td><span className={`pill ${p.status === "有效" ? "ok" : ""}`}>{p.status}</span></td>
                    <td className="r num sensitive">{p.commission ? fmt(p.commission) : "—"}</td>
                    <td className="sensitive">
                      <div className="row-actions">
                        <button className="icon-btn sm" onClick={() => setPolicy(p)} aria-label="編輯保單"><Icon name="edit" size={16} /></button>
                        <button className="icon-btn sm" onClick={() => removePolicy(p)} aria-label="刪除保單"><Icon name="trash" size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel sensitive">
        <header className="panel-h"><h2>互動紀錄</h2></header>
        <InteractionForm clientId={c.id} onAdded={refresh} />
        {c.interactions.length === 0 ? (
          <p className="empty">尚無互動紀錄</p>
        ) : (
          <ul className="timeline">
            {c.interactions.map((i) => (
              <li key={i.id}>
                <time>{fmtDate(i.occurred_at)}</time>
                <span><span className="pill">{i.kind}</span> {i.content}</span>
              </li>
            ))}
          </ul>
        )}
        {c.note && <div className="note-box"><b>內部備註</b>　{c.note}</div>}
      </section>

      {editing && !present && (
        <ClientForm client={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      )}
      {policy && !present && (
        <PolicyForm clientId={c.id} policy={policy === "new" ? undefined : policy}
          onClose={() => setPolicy(null)} onSaved={() => { setPolicy(null); refresh(); }} />
      )}
    </div>
  );
}

function InteractionForm({ clientId, onAdded }: { clientId: string; onAdded: () => void }) {
  const [kind, setKind] = useState("電話");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/clients/${clientId}/interactions`, { kind, content });
      setContent("");
      onAdded();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="field" style={{ flex: "0 0 110px", minWidth: 0 }}>類型
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {INTERACTION_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
      </label>
      <label className="field">內容
        <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：電話關心健康檢查結果" maxLength={2000} />
      </label>
      <button className="btn primary" disabled={busy || !content.trim()}>記錄</button>
    </form>
  );
}

function ClientForm({ client, onClose, onSaved }: {
  client?: ClientDetail; onClose: () => void; onSaved: (c: { id: string }) => void;
}) {
  const [f, setF] = useState({
    name: client?.name ?? "",
    gender: client?.gender ?? "",
    birthday: client?.birthday ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    lineId: client?.line_id ?? "",
    occupation: client?.occupation ?? "",
    family: client?.family ?? "",
    tags: client?.tags ?? ([] as string[]),
    nextAction: client?.next_action ?? "",
    note: client?.note ?? "",
  });
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggleTag = (t: string) => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const extra = tagInput.trim() && !f.tags.includes(tagInput.trim()) ? [tagInput.trim()] : [];
    const body = { ...f, gender: f.gender || null, birthday: f.birthday || null, tags: [...f.tags, ...extra] };
    try {
      const saved = client
        ? await api.put<{ id: string }>(`/api/clients/${client.id}`, body)
        : await api.post<{ id: string }>("/api/clients", body);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={client ? "編輯客戶" : "新增客戶"} onClose={onClose} wide>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="form-grid">
          <label className="field">姓名 *<input required maxLength={50} value={f.name} onChange={set("name")} /></label>
          <label className="field">性別
            <select value={f.gender} onChange={set("gender")}>
              <option value="">未填</option><option>男</option><option>女</option><option>其他</option>
            </select>
          </label>
          <label className="field">生日<input type="date" value={f.birthday} onChange={set("birthday")} /></label>
          <label className="field">職業<input value={f.occupation} onChange={set("occupation")} /></label>
          <label className="field">家庭狀況<input placeholder="例如：已婚 · 2 子" value={f.family} onChange={set("family")} /></label>
          <label className="field">手機<input type="tel" value={f.phone} onChange={set("phone")} /></label>
          <label className="field">Email<input type="email" value={f.email} onChange={set("email")} /></label>
          <label className="field">LINE ID<input value={f.lineId} onChange={set("lineId")} /></label>
          <div className="field full">興趣標籤（用來媒合每日新聞）
            <div className="chips">
              {[...new Set([...SUGGESTED_TAGS, ...f.tags])].map((t) => (
                <button type="button" key={t} className="chip" aria-pressed={f.tags.includes(t)} onClick={() => toggleTag(t)}>{t}</button>
              ))}
              <input placeholder="自訂標籤" value={tagInput} maxLength={20} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    e.preventDefault();
                    if (!f.tags.includes(tagInput.trim())) toggleTag(tagInput.trim());
                    setTagInput("");
                  }
                }} style={{ width: 120 }} />
            </div>
          </div>
          <label className="field full">下一步<input value={f.nextAction} onChange={set("nextAction")} /></label>
          <label className="field full">內部備註（客戶展示模式下隱藏）<textarea value={f.note} onChange={set("note")} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button className="btn primary">儲存</button>
        </div>
      </form>
    </Modal>
  );
}

function PolicyForm({ clientId, policy, onClose, onSaved }: {
  clientId: string; policy?: Policy; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    insurer: policy?.insurer ?? "",
    productName: policy?.product_name ?? "",
    category: policy?.category ?? "壽險",
    annualPremium: String(policy?.annual_premium ?? ""),
    status: policy?.status ?? "有效",
    commission: policy?.commission != null ? String(policy.commission) : "",
    startDate: policy?.start_date ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      ...f,
      annualPremium: Number(f.annualPremium || 0),
      commission: f.commission === "" ? null : Number(f.commission),
      startDate: f.startDate || null,
    };
    try {
      if (policy) await api.put(`/api/policies/${policy.id}`, body);
      else await api.post(`/api/clients/${clientId}/policies`, body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={policy ? "編輯保單" : "新增保單"} onClose={onClose} wide>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="form-grid">
          <label className="field">保險公司 *<input required value={f.insurer} onChange={set("insurer")} /></label>
          <label className="field">商品名稱 *<input required value={f.productName} onChange={set("productName")} /></label>
          <label className="field">類型
            <select value={f.category} onChange={set("category")}>{POLICY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field">狀態
            <select value={f.status} onChange={set("status")}>{POLICY_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="field">年繳保費（元）<input type="number" min={0} inputMode="numeric" value={f.annualPremium} onChange={set("annualPremium")} /></label>
          <label className="field">預估佣金（元，展示模式隱藏）<input type="number" min={0} inputMode="numeric" value={f.commission} onChange={set("commission")} /></label>
          <label className="field">生效日<input type="date" value={f.startDate} onChange={set("startDate")} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button className="btn primary">儲存</button>
        </div>
      </form>
    </Modal>
  );
}
