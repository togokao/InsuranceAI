import { useState, type FormEvent } from "react";
import { api, ApiError, type Me } from "../api";
import { Icon } from "../ui";

function Brand({ sub }: { sub: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">保</div>
      <div><b>業務員 AI 工作台</b><small>{sub}</small></div>
    </div>
  );
}

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password, otp: needOtp ? otp : undefined });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") {
        setNeedOtp(true);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Brand sub="請登入以繼續" />
        <label className="field">Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">密碼
          <input type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {needOtp && (
          <label className="field">驗證碼（驗證器 App 上的 6 位數字）
            <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
          </label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
        {import.meta.env.DEV && (
          <p className="small muted">開發示範帳號：agent@demo.tw／admin@demo.tw／supervisor@demo.tw，密碼 demo1234</p>
        )}
      </form>
    </div>
  );
}

export function MfaSetupPage({ me, onDone }: { me: Me; onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      setSetup(await api.post("/api/auth/mfa/setup"));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/auth/mfa/enable", { otp });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand sub={me.org_name} />
        <h2 style={{ fontSize: 18, display: "flex", gap: 8, alignItems: "center" }}><Icon name="lock" />設定多因素驗證</h2>
        <p className="small muted">
          系統存有客戶個人資料，{me.org_name} 要求所有成員啟用多因素驗證。請在手機安裝驗證器 App
          （例如 Google Authenticator、Microsoft Authenticator），再依下列步驟設定。
        </p>
        {!setup ? (
          <button className="btn primary" onClick={start}>開始設定</button>
        ) : (
          <form onSubmit={enable} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="small">1. 在驗證器 App 選擇「手動輸入金鑰」，帳號填 {me.email}，金鑰如下：</p>
            <code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            <a className="small" href={setup.otpauthUri}>在這台裝置上的驗證器 App 開啟</a>
            <label className="field">2. 輸入 App 顯示的 6 位數驗證碼
              <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="btn primary">啟用</button>
          </form>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="link small" onClick={() => api.post("/api/auth/logout").then(() => location.reload())}>
          登出
        </button>
      </div>
    </div>
  );
}
