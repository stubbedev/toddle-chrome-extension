/**
 * toddle gateway URLs, built the way the web client's getBackendUrl does:
 *   https://<region>-<env>-apis.toddleapp.com<path>
 * where <region> is read from the JWT payload's `region` claim (falling back
 * to eu-west-1, cn-north-1 for China), and cn-* regions use toddleapp.cn.
 */

const API_ENV = "production";
const CHINA_HOST = "apis.toddleapp.cn";
const DEFAULT_REGIONS = { com: "eu-west-1", cn: "cn-north-1" };
const CHINA_REGIONS = new Set(["cn-north-1", "cn-northwest-1"]);
const REGION_REMAPS: Record<string, string> = { "me-central-1": "eu-central-1" };

function hostForRegion(region: string): string {
  return CHINA_REGIONS.has(region) ? CHINA_HOST : "apis.toddleapp.com";
}

export function apiEndpointForRegion(
  region: string | null | undefined,
  path = "/graphql",
): string {
  const fallback = DEFAULT_REGIONS.com;
  const raw = region?.trim() || fallback;
  const mapped = REGION_REMAPS[raw] ?? raw;
  return `https://${mapped}-${API_ENV}-${hostForRegion(mapped)}${path}`;
}

function regionFromToken(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const region = (JSON.parse(json) as { region?: unknown }).region;
    return typeof region === "string" && region ? region : null;
  } catch {
    return null;
  }
}

export interface GqlResponse<T> {
  data?: T;
  errors?: {
    message: string;
    path?: (string | number)[];
    extensions?: { code?: string };
  }[];
}

/**
 * Run a GraphQL operation against the toddle API, mirroring the web client:
 * `Authorization: Bearer <jwt>` plus the X-Tod-* headers it sends. The
 * gateway is picked from the token's `region` claim, like getBackendUrl.
 */
export async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GqlResponse<T>> {
  const endpoint = apiEndpointForRegion(regionFromToken(token));
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Tod-Source": "WEB",
      "X-Tod-Lang":
        typeof navigator !== "undefined" ? navigator.language || "en" : "en",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `toddle API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 500)}` : ""}`,
    );
  }
  return (await res.json()) as GqlResponse<T>;
}
