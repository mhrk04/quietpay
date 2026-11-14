import type { AccountRecord } from "@/lib/server/payments-store";

export type { AccountRecord };

export type AuthResult<T> = { ok: true; value: T } | { ok: false; message: string; notSetUp?: boolean };

async function call(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const msg = (b: Record<string, unknown>, fallback: string) => (typeof b.message === "string" ? b.message : fallback);

/** Current session: the account, "signed-out", or an error (including "sign-in is not set up"). */
export async function fetchMe(): Promise<AuthResult<string | null>> {
  const r = await call("/api/auth/me");
  if (!r) return { ok: false, message: "Could not reach the server. Try again in a moment." };
  if (r.status === 200 && typeof r.body.accountId === "string") return { ok: true, value: r.body.accountId };
  if (r.status === 200 && r.body.accountId === null) return { ok: true, value: null };
  if (r.status === 503) return { ok: false, message: "Sign-in is not set up", notSetUp: true };
  return { ok: false, message: msg(r.body, "Could not check your sign-in. Try again in a moment.") };
}

export async function fetchMyPayments(): Promise<AuthResult<AccountRecord[]>> {
  const r = await call("/api/my-payments");
  if (!r) return { ok: false, message: "Could not reach the server. Try again in a moment." };
  if (r.status === 401) return { ok: false, message: "Please sign in again." };
  if (r.status !== 200 || !Array.isArray(r.body.payments)) {
    return { ok: false, message: msg(r.body, "Could not load payments. Try again in a moment.") };
  }
  return { ok: true, value: r.body.payments as AccountRecord[] };
}

export async function signOut(): Promise<void> {
  await call("/api/auth/logout", { method: "POST" });
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Asks the server for a challenge, has the wallet sign it (NEP-413, no transaction),
 * and sends the signature back. Returns the signed-in account.
 */
export async function signInWithWallet(): Promise<AuthResult<string>> {
  const ch = await call("/api/auth/challenge");
  if (!ch) return { ok: false, message: "Could not reach the server. Try again in a moment." };
  if (ch.status === 503) return { ok: false, message: "Sign-in is not set up", notSetUp: true };
  const { message, recipient, nonce } = ch.body;
  if (ch.status !== 200 || typeof message !== "string" || typeof recipient !== "string" || typeof nonce !== "string") {
    return { ok: false, message: msg(ch.body, "Could not start sign-in. Try again in a moment.") };
  }
  let signed: { accountId: string; publicKey: string; signature: string };
  const { NearConnector } = await import("@hot-labs/near-connect");
  const connector = new NearConnector({ network: "mainnet", features: { signMessage: true } });
  try {
    const wallet = await connector.connect();
    signed = await wallet.signMessage({ message, recipient, nonce: decodeBase64(nonce) });
  } catch {
    return { ok: false, message: "Sign-in was cancelled or the wallet could not sign. Try again." };
  } finally {
    connector.disconnect().catch(() => {});
  }
  const v = await call("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature }),
  });
  if (!v) return { ok: false, message: "Could not reach the server. Try again in a moment." };
  if (v.status === 200 && typeof v.body.accountId === "string") return { ok: true, value: v.body.accountId };
  if (v.status === 503) return { ok: false, message: "Sign-in is not set up", notSetUp: true };
  return { ok: false, message: msg(v.body, "Sign-in failed. Try again.") };
}
