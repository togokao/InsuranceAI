export type Role = "platform_admin" | "org_admin" | "supervisor" | "agent";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  mfa_enabled: boolean;
  org_name: string;
  org_kind: string;
  require_mfa: boolean;
  mfa_setup_required: boolean;
}

export interface ClientSummary {
  id: string;
  name: string;
  gender: string | null;
  birthday: string | null;
  age: number | null;
  occupation: string | null;
  family: string | null;
  tags: string[];
  next_action: string | null;
  policy_count: number;
  last_contact: string | null;
}

export interface Policy {
  id: string;
  insurer: string;
  product_name: string;
  category: string;
  annual_premium: number;
  status: string;
  commission: number | null;
  start_date: string | null;
}

export interface Interaction {
  id: string;
  kind: string;
  content: string;
  news_id: string | null;
  occurred_at: string;
}

export interface ClientDetail extends Omit<ClientSummary, "policy_count" | "last_contact"> {
  phone: string | null;
  email: string | null;
  line_id: string | null;
  note: string | null;
  policies: Policy[];
  interactions: Interaction[];
}

export interface NewsItem {
  id: string;
  digest_date: string;
  category: "健康" | "投資" | "保險";
  title: string;
  source_name: string;
  url: string;
  published_at: string | null;
  summary: string;
  angle: string;
  tags: string[];
  is_investment: boolean;
  matched_clients: { id: string; name: string }[];
}

export interface HomeData {
  birthdays: { id: string; name: string; next_bday: string; days_left: number; turning: number }[];
  followups: { id: string; name: string; next_action: string; tags: string[] }[];
  news: Pick<NewsItem, "id" | "category" | "title" | "source_name" | "published_at" | "angle" | "is_investment">[];
  newsDate: string | null;
  newsCount: number;
}

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mfa_enabled: boolean;
  client_count: string;
  share_count_30d: string;
  interaction_count_30d: string;
}

export interface Partner {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  contract_expiry: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  ip: string | null;
  at: string;
  user_name: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** 收到 401 時通知 App 回到登入頁 */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.error ?? `請求失敗（${res.status}）`, data.code);
    if (res.status === 401 && !url.startsWith("/api/auth/login")) onUnauthorized();
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: (url: string) => request<void>("DELETE", url),
};

export const fmt = (n: number) => n.toLocaleString("zh-TW");
