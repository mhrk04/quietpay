export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";
export const PROXY_TIMEOUT_MS = 10_000;

export const REQUIRED_QUOTE_FIELDS = [
  "depositType",
  "refundType",
  "recipientType",
  "slippageTolerance",
  "deadline",
] as const;

export interface ProxyResult {
  status: number;
  body: unknown;
}

export interface ProxyOptions {
  jwt?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Removes every occurrence of the JWT from a string. */
export function scrub(text: string, jwt?: string): string {
  if (!jwt) return text;
  return text.split(jwt).join("[redacted]");
}

function errorResult(status: number, message: string): ProxyResult {
  return { status, body: { message } };
}

/**
 * Forwards a request to the 1Click API with a 10 s timeout.
 * Never throws. Never returns the JWT in the result.
 */
export async function proxyFetch(
  path: string,
  init: RequestInit = {},
  opts: ProxyOptions = {},
): Promise<ProxyResult> {
  const { jwt, fetchImpl = fetch, baseUrl = ONECLICK_BASE_URL, timeoutMs = PROXY_TIMEOUT_MS } = opts;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (jwt) headers.set("X-API-Key", jwt);

  try {
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const text = await res.text();

    let parsed: unknown;
    try {
      parsed = text.length ? JSON.parse(text) : undefined;
    } catch {
      return errorResult(502, "Unexpected response from payment service");
    }

    if (res.ok) {
      if (parsed === undefined) return errorResult(502, "Unexpected response from payment service");
      // Scrub the serialized body so the JWT cannot leak through any field.
      const serialized = scrub(JSON.stringify(parsed), jwt);
      return { status: res.status, body: JSON.parse(serialized) };
    }

    const rawMessage =
      parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : "Request failed";
    return errorResult(res.status, scrub(rawMessage, jwt));
  } catch (err) {
    if (timedOut || (err instanceof Error && err.name === "AbortError")) {
      return errorResult(504, "Request timed out");
    }
    return errorResult(502, "Could not reach payment service");
  } finally {
    clearTimeout(timer);
  }
}

export type QuoteValidation = { ok: true } | { ok: false; status: 400; message: string };

/** Validates a client quote body: required fields present and swapType EXACT_OUTPUT. */
export function validateQuoteBody(body: unknown): QuoteValidation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, message: "Missing required fields: " + REQUIRED_QUOTE_FIELDS.join(", ") };
  }
  const obj = body as Record<string, unknown>;
  const problems: string[] = [];

  const missing = REQUIRED_QUOTE_FIELDS.filter((f) => {
    const v = obj[f];
    return v === undefined || v === null || v === "";
  });
  if (missing.length) problems.push(`Missing required fields: ${missing.join(", ")}`);
  if (obj.swapType !== "EXACT_OUTPUT") problems.push("swapType must be EXACT_OUTPUT");

  if (problems.length) return { ok: false, status: 400, message: problems.join(". ") };
  return { ok: true };
}
