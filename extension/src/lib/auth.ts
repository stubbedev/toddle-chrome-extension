export interface ToddleAuth {
  token: string;
  source: "cookie" | "localStorage";
  detail: string;
  expiresAt: number | null;
}

const TODDLE_COOKIE_DOMAINS = ["toddleapp.com", "toddleapp.cn"];
const TODDLE_WEB_URLS = [
  "https://web.toddleapp.com/*",
  "https://web.toddleapp.cn/*",
];

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export const TODDLE_LOGIN_URL = "https://web.toddleapp.com/";

interface JwtPayload {
  exp?: number;
  [key: string]: unknown;
}

function decodeJwtPayload(value: string): JwtPayload | null {
  const parts = value.split(".");
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function isUsableJwt(value: string): JwtPayload | null {
  if (!JWT_RE.test(value)) return null;
  const payload = decodeJwtPayload(value);
  if (!payload) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    return null;
  }
  return payload;
}

function tokenFromUserInfo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const info = JSON.parse(raw) as Record<string, unknown>;
    const token = info.token ?? info.parentToken;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Find the toddle session JWT.
 *
 * toddle's web client authenticates GraphQL calls to apigw.toddleapp.com with
 * `Authorization: Bearer <jwt>` (token stored in localStorage.userInfo). We
 * prefer a JWT sitting in the cookie jar; otherwise read localStorage from an
 * open toddle tab via chrome.scripting.
 */
export async function getToddleAuth(): Promise<ToddleAuth | null> {
  const fromCookies = await fromCookieJar();
  if (fromCookies) return fromCookies;
  return await fromLocalStorage();
}

async function fromCookieJar(): Promise<ToddleAuth | null> {
  const seen = new Set<string>();
  let best: ToddleAuth | null = null;
  for (const domain of TODDLE_COOKIE_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const cookie of cookies) {
      const key = `${cookie.domain}:${cookie.name}:${cookie.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const payload = isUsableJwt(cookie.value);
      if (!payload) continue;
      const candidate: ToddleAuth = {
        token: cookie.value,
        source: "cookie",
        detail: `${cookie.name} @ ${cookie.domain}`,
        expiresAt: typeof payload.exp === "number" ? payload.exp : null,
      };
      if (!best || (candidate.expiresAt ?? 0) > (best.expiresAt ?? 0)) {
        best = candidate;
      }
    }
  }
  return best;
}

function readUserInfoLocally(): string | null {
  return localStorage.getItem("userInfo");
}

async function fromLocalStorage(): Promise<ToddleAuth | null> {
  const tabs = await chrome.tabs.query({ url: TODDLE_WEB_URLS });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readUserInfoLocally,
      });
      const raw = results[0]?.result ?? null;
      const token = tokenFromUserInfo(raw);
      if (!token) continue;
      const payload = isUsableJwt(token);
      if (!payload) continue;
      return {
        token,
        source: "localStorage",
        detail: `userInfo @ ${new URL(tab.url!).host}`,
        expiresAt: typeof payload.exp === "number" ? payload.exp : null,
      };
    } catch {
      // tab not ready or no permission; try the next one
    }
  }
  return null;
}
