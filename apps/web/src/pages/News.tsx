import { useState } from "react";
import { api, type Me, type NewsItem } from "../api";
import { Avatar, catClass, fmtDate, Icon, Loading, Modal, useLoad, useToast } from "../ui";

const CATS = ["全部", "健康", "投資", "保險"] as const;
const INVESTMENT_DISCLAIMER = "以上內容僅供參考，非投資建議。";

export function NewsPage({ me }: { me: Me }) {
  const [cat, setCat] = useState<(typeof CATS)[number]>("全部");
  const [sharing, setSharing] = useState<NewsItem | null>(null);
  const { data, error } = useLoad(
    () => api.get<{ date: string | null; items: NewsItem[] }>(`/api/news${cat === "全部" ? "" : `?category=${encodeURIComponent(cat)}`}`),
    [cat],
  );
  const isAgent = me.role === "agent";

  return (
    <>
      <div className="panel-h">
        <div className="chips" role="group" aria-label="新聞分類">
          {CATS.map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <span className="mock-note" style={{ marginLeft: "auto" }}>
          {data?.date ? `${fmtDate(data.date)} 彙整 · ` : ""}僅保留 AI 摘要與原文連結
        </span>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.items.length === 0 ? (
        <p className="empty">目前沒有新聞</p>
      ) : (
        <div className="news-grid">
          {data.items.map((n) => (
            <article className="news-card" key={n.id}>
              <div className="news-meta">
                <span className={`pill ${catClass(n.category)}`}>{n.category}</span>
                {n.source_name}
              </div>
              <h3>{n.title}</h3>
              <p className="small muted">{n.summary}</p>
              <p className="angle sensitive"><b>聊天切入點</b>{n.angle}</p>
              {n.is_investment && <p className="disclaim">分享給客戶時會自動附上「{INVESTMENT_DISCLAIMER}」</p>}
              <div className="news-foot">
                {isAgent && (
                  <span className="match sensitive">
                    {n.matched_clients.slice(0, 4).map((c) => <Avatar key={c.id} name={c.name} />)}
                    <span>&nbsp;{n.matched_clients.length} 位客戶可能感興趣</span>
                  </span>
                )}
                <a className="btn small" href={n.url} target="_blank" rel="noopener noreferrer">原文</a>
                {isAgent && (
                  <button className="btn small line" onClick={() => setSharing(n)}>
                    <Icon name="share" size={16} />分享
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {sharing && <ShareDialog news={sharing} me={me} onClose={() => setSharing(null)} />}
    </>
  );
}

function ShareDialog({ news, me, onClose }: { news: NewsItem; me: Me; onClose: () => void }) {
  const toast = useToast();
  const [clientId, setClientId] = useState(news.matched_clients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const clientText = `${news.title}\n${news.summary}${news.is_investment ? `\n（${INVESTMENT_DISCLAIMER}）` : ""}`;

  const share = async (via: "line" | "copy") => {
    setBusy(true);
    // 先開視窗再填網址，避免被 iPad Safari 的彈出視窗阻擋
    const win = via === "line" ? window.open("about:blank", "_blank") : null;
    try {
      const r = await api.post<{ url: string; lineUrl: string }>(`/api/news/${news.id}/shares`, {
        clientId: clientId || null,
      });
      if (win) {
        win.location.href = r.lineUrl;
      } else {
        await navigator.clipboard.writeText(`${clientText}\n${r.url}`);
      }
      toast(clientId ? "已分享，並記錄到客戶互動紀錄" : via === "copy" ? "已複製分享文字與連結" : "已開啟 LINE 分享");
      onClose();
    } catch (e) {
      win?.close();
      toast((e as Error).message || "分享失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="客戶看到的分享卡片" onClose={onClose}>
      <div className="line-card">
        <div className="lc-top">{news.title}</div>
        <div className="lc-body">
          <p>{news.summary}</p>
          {news.is_investment && <p className="disclaim">{INVESTMENT_DISCLAIMER}</p>}
          <p className="lc-from">來源：{news.source_name}（點擊閱讀原文）<br />由 {me.name} · {me.org_name} 分享</p>
        </div>
      </div>
      <p className="small muted">客戶版會自動拿掉「聊天切入點」等內部內容。</p>
      <label className="field">分享給哪位客戶（記錄到互動紀錄）
        <ClientSelect value={clientId} onChange={setClientId} suggested={news.matched_clients} />
      </label>
      <div className="form-actions">
        <button className="btn" disabled={busy} onClick={() => share("copy")}><Icon name="copy" size={16} />複製文字</button>
        <button className="btn line" disabled={busy} onClick={() => share("line")}><Icon name="share" size={16} />分享到 LINE</button>
      </div>
    </Modal>
  );
}

function ClientSelect({ value, onChange, suggested }: {
  value: string; onChange: (v: string) => void; suggested: { id: string; name: string }[];
}) {
  const { data } = useLoad(() => api.get<{ id: string; name: string }[]>("/api/clients"), []);
  const suggestedIds = new Set(suggested.map((c) => c.id));
  const others = (data ?? []).filter((c) => !suggestedIds.has(c.id));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">不指定客戶</option>
      {suggested.length > 0 && (
        <optgroup label="可能感興趣">
          {suggested.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="其他客戶">
          {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}
