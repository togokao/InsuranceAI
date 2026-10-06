import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type Me, type Role } from "./api";
import { Icon, type IconName } from "./ui";
import { LoginPage, MfaSetupPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { NewsPage } from "./pages/News";
import { ClientsPage } from "./pages/Clients";
import { AuditPage, PartnersPage, TeamPage } from "./pages/Admin";
import { ComingSoon } from "./pages/ComingSoon";

type View = "home" | "news" | "clients" | "proposal" | "needs" | "partners" | "team" | "audit";

const TITLES: Record<View, string> = {
  home: "今日", news: "新聞彙整", clients: "客戶", proposal: "建議書簡化", needs: "需求與媒合",
  partners: "合作保險公司", team: "業務員與用量", audit: "稽核紀錄",
};

const NAV: Record<Role, [View, IconName][]> = {
  agent: [["home", "home"], ["news", "news"], ["clients", "users"], ["proposal", "file"], ["needs", "clip"]],
  org_admin: [["team", "chart"], ["partners", "building"], ["audit", "shield"], ["news", "news"]],
  supervisor: [["team", "chart"], ["news", "news"]],
  platform_admin: [["news", "news"]],
};

const ROLE_LABEL: Record<Role, string> = {
  agent: "一般業務", org_admin: "保經公司管理者", supervisor: "主管／督導", platform_admin: "平台管理員",
};

// ---------- 路由（hash） ----------
export interface Route { view: View; id?: string }

function parseHash(): Route {
  const [view, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { view: (view && view in TITLES ? view : "home") as View, id: id || undefined };
}

export function navigate(view: View, id?: string) {
  location.hash = `/${view}${id ? `/${id}` : ""}`;
}

// ---------- 客戶展示模式 ----------
const PresentCtx = createContext(false);
export const usePresent = () => useContext(PresentCtx);

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(parseHash);
  const [present, setPresent] = useState(false);

  const loadMe = useCallback(() => {
    api.get<Me>("/api/me").then(setMe, () => setMe(null));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    loadMe();
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadMe]);

  if (me === undefined) return null;
  if (me === null) return <LoginPage onDone={loadMe} />;
  if (me.mfa_setup_required) return <MfaSetupPage me={me} onDone={loadMe} />;

  const nav = NAV[me.role];
  const view = nav.some(([v]) => v === route.view) ? route.view : nav[0]![0];

  const logout = async () => {
    await api.post("/api/auth/logout");
    setPresent(false);
    setMe(null);
  };

  return (
    <PresentCtx.Provider value={present}>
      <div className={`app${present ? " present" : ""}`}>
        <nav className="nav" aria-label="主選單">
          <div className="brand">
            <div className="brand-mark">保</div>
            <div><b>業務員 AI 工作台</b><small>{me.org_name}</small></div>
          </div>
          <ul>
            {nav.map(([v, icon]) => (
              <li key={v}>
                <button className="nav-btn" onClick={() => navigate(v)} aria-current={view === v ? "page" : undefined}>
                  <Icon name={icon} size={22} /><span>{TITLES[v]}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="nav-foot sensitive">
            <div>{me.name} · {ROLE_LABEL[me.role]}</div>
            <button className="link small" onClick={logout}><Icon name="logout" size={14} /> 登出</button>
          </div>
        </nav>
        <div className="main">
          {present && (
            <div className="present-banner">
              <Icon name="eye" />
              客戶展示模式：已隱藏佣金、內部備註、話術與其他客戶資料
              <button onClick={() => setPresent(false)}>結束展示</button>
            </div>
          )}
          <header className="topbar">
            <h1>{TITLES[view]}</h1>
            {me.role === "agent" && !present && (
              <button className="btn" onClick={() => setPresent(true)}><Icon name="eye" size={18} />客戶展示模式</button>
            )}
            {!present && (
              <button className="icon-btn narrow-only" onClick={logout} aria-label={`登出（${me.name}）`} title={`${me.name} · 登出`}>
                <Icon name="logout" />
              </button>
            )}
          </header>
          <main className="content">
            {view === "home" && <HomePage me={me} />}
            {view === "news" && <NewsPage me={me} />}
            {view === "clients" && <ClientsPage selectedId={route.id} />}
            {view === "proposal" && <ComingSoon phase="二" title="建議書簡化" />}
            {view === "needs" && <ComingSoon phase="三" title="需求問卷與保單媒合" />}
            {view === "team" && <TeamPage me={me} />}
            {view === "partners" && <PartnersPage me={me} />}
            {view === "audit" && <AuditPage />}
          </main>
        </div>
      </div>
    </PresentCtx.Provider>
  );
}
