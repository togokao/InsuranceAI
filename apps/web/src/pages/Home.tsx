import { api, type HomeData, type Me } from "../api";
import { navigate } from "../App";
import { Avatar, catClass, Loading, useLoad } from "../ui";

const WEEKDAYS = "日一二三四五六";

function greeting(h: number) {
  return h < 11 ? "早安" : h < 18 ? "午安" : "晚安";
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export function HomePage({ me }: { me: Me }) {
  const { data, error } = useLoad(() => api.get<HomeData>("/api/home"), []);
  const now = new Date();
  const dateLabel = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${WEEKDAYS[now.getDay()]}`;

  return (
    <>
      <section className="hello">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h2 className="h1">{greeting(now.getHours())}，{me.name.slice(-2)}</h2>
        </div>
        {data && (
          <div className="todo-strip">
            <button className="todo" onClick={() => data.birthdays[0] && navigate("clients", data.birthdays[0].id)}>
              <span className="todo-n">{data.birthdays.length}</span><span>位客戶 7 天內生日</span>
            </button>
            <button className="todo ok" onClick={() => navigate("news")}>
              <span className="todo-n">{data.newsCount}</span><span>則今日新聞</span>
            </button>
          </div>
        )}
      </section>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="grid-2">
          <section className="panel">
            <header className="panel-h">
              <h2>今日新聞</h2>
              {data.newsDate && <span className="mock-note">每日 06:00 自動彙整</span>}
              <button className="link" onClick={() => navigate("news")}>全部 {data.newsCount} 則</button>
            </header>
            {data.news.length === 0 ? (
              <p className="empty">今天的新聞還沒產生</p>
            ) : (
              <div>
                {data.news.map((n) => (
                  <article className="news-row" key={n.id}>
                    <div className="news-meta">
                      <span className={`pill ${catClass(n.category)}`}>{n.category}</span>
                      {n.source_name}{n.published_at && ` · ${time(n.published_at)}`}
                    </div>
                    <h3>{n.title}</h3>
                    <p className="angle sensitive"><b>聊天切入點</b>{n.angle}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
          <div className="stack">
            <section className="panel sensitive">
              <header className="panel-h"><h2>近期生日</h2></header>
              {data.birthdays.length === 0 ? (
                <p className="empty">7 天內沒有客戶生日</p>
              ) : (
                <ul className="list">
                  {data.birthdays.map((b) => (
                    <li key={b.id}>
                      <button className="row" onClick={() => navigate("clients", b.id)}>
                        <Avatar name={b.name} />
                        <span className="row-main"><b>{b.name}</b><small>將滿 {b.turning} 歲</small></span>
                        <span className="pill accent">{b.days_left === 0 ? "今天" : `${b.days_left} 天後`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel sensitive">
              <header className="panel-h"><h2>待追蹤客戶</h2></header>
              {data.followups.length === 0 ? (
                <p className="empty">目前沒有待辦事項</p>
              ) : (
                <ul className="list">
                  {data.followups.map((c) => (
                    <li key={c.id}>
                      <button className="row" onClick={() => navigate("clients", c.id)}>
                        <Avatar name={c.name} />
                        <span className="row-main"><b>{c.name}</b><small>{c.next_action}</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
