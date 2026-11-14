/** Free public mainnet RPC listed at https://docs.near.org/api/rpc/providers. Override with NEAR_RPC_URL. */
export const DEFAULT_NEAR_RPC_URL = "https://free.rpc.fastnear.com";
export const RPC_TIMEOUT_MS = 8000;

export class RpcError extends Error {}

export type KeyCheck = "full" | "not-full" | "missing";

export interface RpcOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Asks NEAR mainnet whether `publicKey` is an access key of `accountId`, and of which kind. */
export async function checkAccessKey(accountId: string, publicKey: string, opts: RpcOptions = {}): Promise<KeyCheck> {
  const url = opts.url || process.env.NEAR_RPC_URL || DEFAULT_NEAR_RPC_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? RPC_TIMEOUT_MS);
  let json: unknown;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "quietpay",
        method: "query",
        params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
      }),
    });
    if (!res.ok) throw new RpcError(`RPC status ${res.status}`);
    json = await res.json();
  } catch (e) {
    throw e instanceof RpcError ? e : new RpcError("RPC request failed");
  } finally {
    clearTimeout(timer);
  }
  const body = obj(json);
  const err = obj(body?.error);
  if (err) {
    const cause = obj(err.cause)?.name;
    if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return "missing";
    throw new RpcError("RPC returned an error");
  }
  const result = obj(body?.result);
  // Some nodes report an unknown key as result.error (a string) instead of a JSON-RPC error.
  if (typeof result?.error === "string") return /does not exist/i.test(result.error) ? "missing" : fail();
  const permission = result?.permission;
  if (permission === "FullAccess") return "full";
  if (obj(permission)?.FunctionCall) return "not-full";
  return fail();
}

function fail(): never {
  throw new RpcError("Unexpected RPC response");
}
