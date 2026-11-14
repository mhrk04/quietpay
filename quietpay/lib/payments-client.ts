import type { DepositRecord } from "@/lib/server/payments-store";

export type { DepositRecord };

const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<{ status: number; body: unknown } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Recorded deposits for an invoice code, newest first. null when the call failed. */
export async function fetchInvoiceDeposits(code: string): Promise<DepositRecord[] | null> {
  const r = await getJson(`/api/invoice?i=${encodeURIComponent(code)}`);
  const list = (r?.body as { deposits?: unknown } | null)?.deposits;
  if (!r || r.status !== 200 || !Array.isArray(list)) return null;
  return list as DepositRecord[];
}

/** Current swap status string for a deposit address, or null when unknown. */
export async function fetchDepositStatus(address: string): Promise<string | null> {
  const r = await getJson(`/api/status?depositAddress=${encodeURIComponent(address)}`);
  const s = (r?.body as { status?: unknown } | null)?.status;
  return r && r.status === 200 && typeof s === "string" ? s : null;
}

export type Classified =
  | { kind: "paid"; deposit: DepositRecord }
  | { kind: "pending"; deposit: DepositRecord }
  | { kind: "none" };

const IN_FLIGHT = new Set(["KNOWN_DEPOSIT_TX", "PROCESSING"]);

/** Newest-first scan: any SUCCESS wins, otherwise the newest still-usable pending deposit. */
export async function classifyDeposits(deposits: DepositRecord[], now: number = Date.now()): Promise<Classified> {
  const statuses = await Promise.all(deposits.map((d) => fetchDepositStatus(d.depositAddress)));
  const paid = deposits.findIndex((_, i) => statuses[i] === "SUCCESS");
  if (paid >= 0) return { kind: "paid", deposit: deposits[paid] };
  const pending = deposits.findIndex((d, i) => {
    const s = statuses[i];
    if (s === null) return false;
    if (IN_FLIGHT.has(s)) return true;
    return s === "PENDING_DEPOSIT" && Date.parse(d.deadline) > now;
  });
  return pending >= 0 ? { kind: "pending", deposit: deposits[pending] } : { kind: "none" };
}
