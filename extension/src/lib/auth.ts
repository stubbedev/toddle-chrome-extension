export interface ToddleAuth {
  token: string;
  source: "userInfo" | "cookies";
  detail: string;
  expiresAt: number | null;
  orgRegion: string | null;
  userId: string | null;
  name: string | null;
  email: string | null;
}

const TODDLE_COOKIE_DOMAINS = ["toddleapp.com", "toddleapp.cn"];
const TODDLE_WEB_URLS = [
  "https://web.toddleapp.com/*",
  "https://web.toddleapp.cn/*",
];

// lhst = "<header>.<payload>", rhst = "<payload>.<signature>"
const SPLIT_COOKIE_LEFT = "lhst";
const SPLIT_COOKIE_RIGHT = "rhst";

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export const TODDLE_LOGIN_URL = "https://web.toddleapp.com/";

interface JwtPayload {
  exp?: number;
  sub?: string;
  id?: string;
  name?: string;
  email?: string;
  region?: string;
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

interface UserInfo {
  jwt: string | null;
  orgRegion: string | null;
  userId: string | null;
  name: string | null;
  email: string | null;
}

function parseUserInfo(raw: string | null): UserInfo | null {
  if (!raw) return null;
  try {
    const info = JSON.parse(raw) as Record<string, unknown>;
    const token = info.jwt ?? info.token ?? info.parentToken;
    if (typeof token !== "string" || !token) return null;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      jwt: token,
      orgRegion: str(info.orgRegion),
      userId: str(info.id) ?? str(info.identityId),
      name: str(info.name) ?? str(info.userName),
      email: str(info.email),
    };
  } catch {
    return null;
  }
}

function readUserInfoLocally(): string | null {
  return localStorage.getItem("userInfo");
}

/**
 * Find the toddle session JWT.
 *
 * The web client keeps the Bearer token in localStorage.userInfo under `jwt`
 * (with orgRegion etc. alongside). When no toddle tab is open, the token can
 * be rebuilt from the split cookies toddle sets: lhst = "<header>.<payload>"
 * and rhst = "<payload>.<signature>".
 */
export async function getToddleAuth(): Promise<ToddleAuth | null> {
  const fromTabs = await fromUserInfo();
  if (fromTabs) return fromTabs;
  return await fromSplitCookies();
}

async function fromUserInfo(): Promise<ToddleAuth | null> {
  const tabs = await chrome.tabs.query({ url: TODDLE_WEB_URLS });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readUserInfoLocally,
      });
      const info = parseUserInfo(results[0]?.result ?? null);
      if (!info?.jwt) continue;
      const payload = isUsableJwt(info.jwt);
      if (!payload) continue;
      return {
        token: info.jwt,
        source: "userInfo",
        detail: `localStorage.userInfo @ ${new URL(tab.url!).host}`,
        expiresAt: typeof payload.exp === "number" ? payload.exp : null,
        orgRegion: strField(payload, ["region"]) ?? info.orgRegion,
        userId: info.userId ?? strField(payload, ["sub", "id"]),
        name: info.name ?? strField(payload, ["name"]),
        email: info.email ?? strField(payload, ["email"]),
      };
    } catch {
      // tab not ready; try the next one
    }
  }
  return null;
}

function strField(payload: JwtPayload, keys: string[]): string | null {
  for (const key of keys) {
    const v = payload[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function fromSplitCookies(): Promise<ToddleAuth | null> {
  interface Halves {
    lhst: string[];
    rhst: string[];
  }
  const halves: Record<string, Halves> = {};
  for (const domain of TODDLE_COOKIE_DOMAINS) {
    for (const cookie of await chrome.cookies.getAll({ domain })) {
      const bucket = (halves[cookie.domain] ??= { lhst: [], rhst: [] });
      if (cookie.name === SPLIT_COOKIE_LEFT) bucket.lhst.push(cookie.value);
      if (cookie.name === SPLIT_COOKIE_RIGHT) bucket.rhst.push(cookie.value);
    }
  }
  for (const [domain, { lhst, rhst }] of Object.entries(halves)) {
    if (!lhst.length || !rhst.length) continue;
    for (const left of lhst) {
      for (const right of rhst) {
        const token = reassembleJwt(left, right);
        if (!token) continue;
        const payload = isUsableJwt(token);
        if (!payload) continue;
        return {
          token,
          source: "cookies",
          detail: `${SPLIT_COOKIE_LEFT}+${SPLIT_COOKIE_RIGHT} @ ${domain}`,
          expiresAt: typeof payload.exp === "number" ? payload.exp : null,
          orgRegion: strField(payload, ["region"]),
          userId: strField(payload, ["sub", "id"]),
          name: strField(payload, ["name"]),
          email: strField(payload, ["email"]),
        };
      }
    }
  }
  return null;
}

function reassembleJwt(lhst: string, rhst: string): string | null {
  // lhst = "<header>.<payload>", rhst = "<payload>.<signature>"
  const signature = rhst.split(".").pop();
  if (!signature || !lhst.includes(".")) return null;
  return `${lhst}.${signature}`;
}
