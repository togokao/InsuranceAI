import { useState, type FormEvent } from "react";
import { api, fmt, type AuditEntry, type Me, type Partner, type TeamMember } from "../api";
import { fmtDate, Icon, Loading, Modal, useLoad, useToast } from "../ui";

const ROLE_LABEL: Record<string, string> = { agent: "業務", supervisor: "主管", org_admin: "管理者", platform_admin: "平台" };

export function TeamPage({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(
    () => api.get<{ org: { name: string; plan: string; seats: number; require_mfa: boolean }; members: TeamMember[] }>("/api/admin/team"),
    [],
  );
  const [inviting, setInviting] = useState(false);
  const toast = useToast();
  const isAdmin = me.role === "org_admin";
  if (!data) return <Loading error={error} />;

  const active = data.members.filter((m) => m.active);
  const sum = (k: keyof TeamMember) => data.members.reduce((s, m) => s + Number(m[k]), 0);
  const toggle = async (m: TeamMember) => {
    try {
      await api.patch(`/api/admin/users/${m.user_id}`, { active: !m.active });
      toast(`${m.name} 已${m.active ? "停用" : "啟用"}`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>訂閱方案</small><b>{data.org.plan === "pro" ? "專業版" : data.org.plan}</b>
          <span className="small muted">{data.org.seats} 席，已用 {active.length} 席</span></div>
        <div className="kpi"><small>客戶總數</small><b>{fmt(sum("client_count"))}</b></div>
        <div className="kpi"><small>近 30 天新聞分享</small><b>{fmt(sum("share_count_30d"))}</b><span className="small muted">次</span></div>
        <div className="kpi"><small>近 30 天互動紀錄</small><b>{fmt(sum("interaction_count_30d"))}</b><span className="small muted">筆</span></div>
      </div>
      <section className="panel">
        <header className="panel-h">
          <h2>成員</h2>
          {isAdmin && <button className="btn small primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} />邀請成員</button>}
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>姓名</th><th>角色</th><th>MFA</th><th className="r">客戶數</th><th className="r">30 天分享</th>
                <th className="r">30 天互動</th>{isAdmin && <th>狀態</th>}</tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.user_id} style={m.active ? undefined : { opacity: 0.55 }}>
                  <td><b>{m.name}</b><div className="small muted">{m.email}</div></td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td>{m.mfa_enabled ? <span className="pill ok">已啟用</span> : <span className="pill warn">未設定</span>}</td>
                  <td className="r num">{m.client_count}</td>
                  <td className="r num">{m.share_count_30d}</td>
                  <td className="r num">{m.interaction_count_30d}</td>
                  {isAdmin && (
                    <td>
                      {m.role === "org_admin" ? <span className="muted small">—</span> : (
                        <button className="switch" aria-pressed={m.active} aria-label={`${m.name} 啟用中`} onClick={() => toggle(m)} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">管理者與主管只看得到統計數字，看不到業務員個別客戶的資料（由資料庫列層級安全性強制）。所有資料存取都有稽核紀錄。</p>
      </section>
      {inviting && <InviteDialog requireMfa={data.org.require_mfa} onClose={() => setInviting(false)} onDone={reload} />}
    </>
  );
}

function InviteDialog({ requireMfa, onClose, onDone }: { requireMfa: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: "", name: "", role: "agent" });
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setResult(await api.post("/api/admin/users", f));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title="邀請成員" onClose={onClose}>
      {result ? (
        <>
          <p>已建立帳號 <b>{result.email}</b>。請透過安全管道把臨時密碼交給成員：</p>
          <code style={{ fontFamily: "var(--f-mono)", fontSize: 18 }}>{result.tempPassword}</code>
          <p className="small muted">臨時密碼只會顯示這一次。{requireMfa && "成員首次登入時需設定多因素驗證。"}</p>
          <div className="form-actions"><button className="btn primary" onClick={onClose}>完成</button></div>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">Email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">姓名<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">角色
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="agent">一般業務</option><option value="supervisor">主管／督導</option>
            </select>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button className="btn primary">建立帳號</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PartnersPage({ me }: { me: Me }) {
  const { data, error, setData } = useLoad(() => api.get<Partner[]>("/api/admin/partners"), []);
  const toast = useToast();
  const isAdmin = me.role === "org_admin";
  if (!data) return <Loading error={error} />;

  const toggle = async (p: Partner) => {
    try {
      const r = await api.put<{ active: boolean }>(`/api/admin/partners/${p.id}`, { active: !p.active });
      setData(data.map((x) => (x.id === p.id ? { ...x, active: r.active } : x)));
      toast(`${p.name} ${r.active ? "已開啟合作" : "已關閉合作"}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <p className="small muted">關閉合作後，該公司商品不會出現在業務員的媒合結果中（第三階段）；既有客戶的保單資料不受影響。</p>
      <div className="co-grid">
        {data.map((p) => (
          <article key={p.id} className={`co${p.active ? "" : " off"}`}>
            <div className="co-h">
              <Icon name="building" size={22} /><b>{p.name}</b>
              <button className="switch" aria-pressed={p.active} aria-label={`${p.name} 合作中`} disabled={!isAdmin} onClick={() => toggle(p)} />
            </div>
            <dl><dt>類型</dt><dd>{p.kind}</dd><dt>合約到期</dt><dd>{p.contract_expiry ? fmtDate(p.contract_expiry) : "—"}</dd></dl>
          </article>
        ))}
      </div>
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "登入", "auth.mfa_enabled": "啟用 MFA", "client.view": "查看客戶", "client.create": "新增客戶",
  "client.update": "修改客戶", "client.delete": "刪除客戶", "user.invite": "邀請成員", "user.update": "修改成員",
  "partner.enable": "開啟合作", "partner.disable": "關閉合作",
};

export function AuditPage() {
  const { data, error } = useLoad(() => api.get<AuditEntry[]>("/api/admin/audit?limit=200"), []);
  if (!data) return <Loading error={error} />;
  return (
    <section className="panel">
      <header className="panel-h"><h2>最近 200 筆存取紀錄</h2></header>
      <div className="table-wrap">
        <table>
          <thead><tr><th>時間</th><th>成員</th><th>動作</th><th>對象</th><th>IP</th></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="num small">{new Date(a.at).toLocaleString("zh-TW", { hour12: false })}</td>
                <td>{a.user_name ?? "—"}</td>
                <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="small muted">{a.entity ? `${a.entity} ${a.entity_id?.slice(0, 8) ?? ""}` : "—"}</td>
                <td className="small muted num">{a.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
