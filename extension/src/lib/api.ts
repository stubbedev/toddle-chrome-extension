export const API_ENDPOINTS = {
  production: "https://apigw.toddleapp.com/graphql",
  china: "https://apigw.toddleapp.cn/graphql",
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;

const ENDPOINT_STORAGE_KEY = "toddleApiEndpoint";

export async function getApiEndpoint(): Promise<string> {
  const stored = await chrome.storage.local.get(ENDPOINT_STORAGE_KEY);
  const key = stored[ENDPOINT_STORAGE_KEY] as ApiEndpointKey | undefined;
  return API_ENDPOINTS[key ?? "production"];
}

export async function setApiEndpoint(key: ApiEndpointKey): Promise<void> {
  await chrome.storage.local.set({ [ENDPOINT_STORAGE_KEY]: key });
}

export interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Run a GraphQL operation against the toddle API, mirroring the web client:
 * `Authorization: Bearer <jwt>` plus the X-Tod-* headers it sends.
 */
export async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GqlResponse<T>> {
  const endpoint = await getApiEndpoint();
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
    throw new Error(`toddle API ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GqlResponse<T>;
}
