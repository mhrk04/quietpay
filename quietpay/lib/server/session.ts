import { createHmac, timingSafeEqual } from "node:crypto";

export const CHALLENGE_COOKIE = "qp_challenge";
export const SESSION_COOKIE = "qp_session";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 8 * 60 * 60_000;
export const SIGN_IN_MESSAGE = "Sign in to QuietPay";
export const NOT_SET_UP = { message: "Sign-in is not set up" } as const;

/** The session secret, or null when it is missing or shorter than 32 characters. */
export function getSessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.QUIETPAY_SESSION_SECRET;
  return typeof s === "string" && s.length >= 32 ? s : null;
}

const mac = (payload: string, secret: string): Buffer => createHmac("sha256", secret).update(payload).digest();

/** `base64url(json).base64url(hmac-sha256)`. `exp` (ms since epoch) is required in the payload. */
export function signToken(payload: { exp: number } & Record<string, unknown>, secret: string): string {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${mac(p, secret).toString("base64url")}`;
}

/** Returns the payload when the MAC matches and `exp` is in the future; otherwise null. */
export function verifyToken<T extends object>(token: string, secret: string, now: number = Date.now()): (T & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const given = Buffer.from(parts[1], "base64url");
  const expected = mac(parts[0], secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { exp?: unknown };
    if (!payload || typeof payload !== "object" || typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload as T & { exp: number };
  } catch {
    return null;
  }
}

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

export function setCookie(name: string, value: string, o: { path: string; maxAgeSeconds: number; secure: boolean }): string {
  return `${name}=${value}; Path=${o.path}; Max-Age=${o.maxAgeSeconds}; HttpOnly; SameSite=Lax${o.secure ? "; Secure" : ""}`;
}

export function clearCookie(name: string, path: string, secure: boolean): string {
  return setCookie(name, "", { path, maxAgeSeconds: 0, secure });
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export interface Session {
  accountId: string;
  exp: number;
}

/** The signed-in account from the request's session cookie, or null. */
export function readSession(req: Request): Session | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const s = verifyToken<{ accountId?: unknown }>(token, secret);
  return s && typeof s.accountId === "string" ? { accountId: s.accountId, exp: s.exp } : null;
}

export interface Challenge {
  nonce: string;
  recipient: string;
  message: string;
  exp: number;
}

/** Recipient shown in the wallet: QUIETPAY_AUTH_RECIPIENT, else the request host. */
export function authRecipient(req: Request): string {
  const env = process.env.QUIETPAY_AUTH_RECIPIENT;
  if (env) return env;
  return req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
}
