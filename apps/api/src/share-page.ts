/** 客戶版分享頁：純 HTML，所有內容都經過跳脫。不含聊天切入點等內部資訊。 */

export interface SharePageData {
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  category: string;
  disclaimer: string | null;
  agentName: string;
  orgName: string;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 只允許 http(s) 原文連結，避免 javascript: 等協定 */
function safeUrl(u: string): string | null {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const STYLE = `
:root{--bg:#EDF1F0;--card:#fff;--ink:#15252A;--muted:#58696E;--brand:#0E5961;--line:#D2DBD8;--warn:#946410;--warn-soft:#F6EACB}
@media (prefers-color-scheme:dark){:root{--bg:#0E1618;--card:#162126;--ink:#E3ECEA;--muted:#93A6AA;--brand:#5DB2B8;--line:#2A3B40;--warn:#E0B65A;--warn-soft:#3A2F14}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;line-height:1.7}
main{max-width:560px;margin:0 auto;padding:24px 16px 40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.top{background:var(--brand);color:#fff;padding:18px 20px}
.cat{font-size:13px;opacity:.85}
h1{font-size:20px;line-height:1.45;margin:4px 0 0}
.body{padding:18px 20px}
p{margin:0 0 12px}
.disclaim{background:var(--warn-soft);color:var(--warn);padding:8px 12px;border-radius:8px;font-size:14px}
a.src{display:inline-block;color:var(--brand);font-weight:600;text-decoration:none;margin:4px 0 12px}
.from{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:12px;margin:0}
`;

export function renderSharePage(d: SharePageData | null): string {
  if (!d) {
    return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>連結已失效</title><style>${STYLE}</style></head><body><main><div class="card"><div class="body"><p>此分享連結不存在或已失效。</p></div></div></main></body></html>`;
  }
  const src = safeUrl(d.url);
  const t = escapeHtml(d.title);
  const s = escapeHtml(d.summary);
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<meta property="og:title" content="${t}">
<meta property="og:description" content="${s}">
<meta property="og:type" content="article">
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
  <article class="card">
    <header class="top"><div class="cat">${escapeHtml(d.category)}新知</div><h1>${t}</h1></header>
    <div class="body">
      <p>${s}</p>
      ${d.disclaimer ? `<p class="disclaim">${escapeHtml(d.disclaimer)}</p>` : ""}
      ${src ? `<a class="src" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">閱讀原文：${escapeHtml(d.sourceName)} →</a>` : `<p>來源：${escapeHtml(d.sourceName)}</p>`}
      <p class="from">由 ${escapeHtml(d.agentName)} · ${escapeHtml(d.orgName)} 分享<br>摘要由 AI 協助整理，內容以原文為準。</p>
    </div>
  </article>
</main>
</body>
</html>`;
}
