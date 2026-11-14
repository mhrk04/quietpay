import { RateLimiter, clientIp, sharedLimiter } from "@/lib/server/rate-limit";

export const MAX_BODY_BYTES = 10 * 1024;
const WINDOW_MS = 60_000;
const LIMITS = { quote: 30, other: 120 } as const;

export type GuardKind = keyof typeof LIMITS;

function json(status: number, message: string, headers?: Record<string, string>): Response {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Cross-site Origin check, then per-IP rate limit. Returns a Response to send, or null to continue. */
export function guardRequest(req: Request, kind: GuardKind, limiter: RateLimiter = sharedLimiter): Response | null {
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== host) return json(403, "Forbidden");
  }
  const r = limiter.check(`${kind}:${clientIp(req)}`, LIMITS[kind], WINDOW_MS);
  if (!r.allowed) {
    return json(429, "Too many requests. Please wait a moment and try again.", {
      "Retry-After": String(r.retryAfterSeconds),
    });
  }
  return null;
}

export type CappedJson = { ok: true; body: unknown } | { ok: false; response: Response };

/** Reads a JSON body of at most MAX_BODY_BYTES; checks content-length and the bytes actually read. */
export async function readJsonCapped(req: Request, max: number = MAX_BODY_BYTES): Promise<CappedJson> {
  const tooBig = (): CappedJson => ({ ok: false, response: json(413, "Request body too large") });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return tooBig();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return tooBig();
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: json(400, "Invalid JSON body") };
  }
}
