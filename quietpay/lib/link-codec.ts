import { fromBaseUnits, toBaseUnits, type Result } from "./amount";
import { isValidNearAccount } from "./near-account";

export interface Invoice {
  amount: string;
  account: string;
  description: string;
  createdAt: number;
}

export interface StatusLinkExtra {
  /** Refund address (query param `r`). */
  refund?: string;
  /** Quote deadline in epoch milliseconds (query param `d`). */
  deadline?: number;
}

export interface ParsedStatusLink {
  address: string;
  invoice: Invoice;
  refund?: string;
  deadline?: number;
}

const MAX_BASE_UNITS = 999_999_999_999_999n; // 999,999,999.999999 * 10^6
const MAX_DESCRIPTION_CHARS = 140;
const MAX_ENCODED_LENGTH = 4096;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validateInvoice(x: unknown): Result<Invoice> {
  if (typeof x !== "object" || x === null) return fail("Invoice must be an object");
  const o = x as Record<string, unknown>;

  if (typeof o.amount !== "string") return fail("amount: must be a string");
  const base = toBaseUnits(o.amount);
  if (!base.ok) return fail(`amount: ${base.error}`);
  if (BigInt(base.value) > MAX_BASE_UNITS) {
    return fail("amount: must be at most 999999999.999999");
  }
  if (fromBaseUnits(base.value) !== o.amount) {
    return fail("amount: must be in canonical form (no leading or trailing zeros)");
  }

  if (typeof o.account !== "string" || !isValidNearAccount(o.account)) {
    return fail("account: not a valid NEAR account");
  }

  if (typeof o.description !== "string") return fail("description: must be a string");
  if (Array.from(o.description).length > MAX_DESCRIPTION_CHARS) {
    return fail("description: must be at most 140 characters");
  }

  const createdAt = o.createdAt;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return fail("createdAt: must be a number");
  }

  return {
    ok: true,
    value: { amount: o.amount, account: o.account, description: o.description, createdAt },
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("bad base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** base64url(UTF-8 JSON {a,n,d,t}). Never throws. */
export function encodeInvoice(inv: Invoice): string {
  try {
    return toBase64Url(
      JSON.stringify({ a: inv.amount, n: inv.account, d: inv.description, t: inv.createdAt }),
    );
  } catch {
    return "";
  }
}

/** Decode and validate. Never throws. */
export function decodeInvoice(s: string): Result<Invoice> {
  try {
    if (typeof s !== "string" || s.length === 0) return fail("Invoice is missing");
    if (s.length > MAX_ENCODED_LENGTH) return fail("Invoice is too long");
    const parsed: unknown = JSON.parse(fromBase64Url(s));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("Invoice is malformed");
    }
    const p = parsed as Record<string, unknown>;
    return validateInvoice({ amount: p.a, account: p.n, description: p.d, createdAt: p.t });
  } catch {
    return fail("Invoice is malformed");
  }
}

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function buildPayLink(origin: string, inv: Invoice): string {
  return `${trimOrigin(origin)}/pay?i=${encodeInvoice(inv)}`;
}

export function buildStatusLink(
  origin: string,
  addr: string,
  inv: Invoice,
  extra?: StatusLinkExtra,
): string {
  const params = new URLSearchParams();
  params.set("a", addr);
  params.set("i", encodeInvoice(inv));
  if (extra?.refund) params.set("r", extra.refund);
  if (extra?.deadline !== undefined && Number.isFinite(extra.deadline)) {
    params.set("d", String(Math.trunc(extra.deadline)));
  }
  return `${trimOrigin(origin)}/status?${params.toString()}`;
}

/** Parse a status link (full URL, query string, or URLSearchParams). Never throws. */
export function parseStatusLink(input: string | URLSearchParams): Result<ParsedStatusLink> {
  try {
    let params: URLSearchParams;
    if (typeof input === "string") {
      const q = input.indexOf("?");
      params = new URLSearchParams(q >= 0 ? input.slice(q + 1).split("#")[0] : input);
    } else {
      params = input;
    }
    const address = params.get("a");
    if (!address || /\s/.test(address)) return fail("Deposit address is missing");
    const encoded = params.get("i");
    if (!encoded) return fail("Invoice is missing");
    const inv = decodeInvoice(encoded);
    if (!inv.ok) return inv;

    const out: ParsedStatusLink = { address, invoice: inv.value };
    const refund = params.get("r");
    if (refund) out.refund = refund;
    const d = params.get("d");
    if (d !== null && /^\d{1,16}$/.test(d)) out.deadline = Number(d);
    return { ok: true, value: out };
  } catch {
    return fail("Link is malformed");
  }
}
