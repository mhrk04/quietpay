import { toBaseUnits, type Result } from "./amount";
import type { Invoice } from "./link-codec";
import type { TokenInfo } from "./tokens";

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  confidentiality?: "public" | "basic";
}

export interface QuoteResponse {
  quote: {
    amountIn: string;
    amountInFormatted?: string;
    amountInUsd?: string;
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted?: string;
    amountOutUsd?: string;
    timeEstimate?: number;
    depositAddress?: string;
    depositMemo?: string | null;
    deadline?: string;
  };
  quoteRequest?: { deadline?: string };
}

export interface PartialQuoteResponse {
  quote?: Partial<QuoteResponse["quote"]>;
  quoteRequest?: { deadline?: string };
}

export const QUOTE_WINDOW_MS = 30 * 60 * 1000;

export function buildQuoteRequest(p: {
  invoice: Invoice;
  origin: TokenInfo;
  refundTo: string;
  destination: TokenInfo;
  dry: boolean;
  deadlineIso?: string;
  now?: number;
}): QuoteRequest {
  const base = toBaseUnits(p.invoice.amount);
  if (!base.ok) throw new Error(base.error);
  const deadline =
    p.deadlineIso ?? new Date((p.now ?? Date.now()) + QUOTE_WINDOW_MS).toISOString();
  return {
    dry: p.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: p.origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destination.assetId,
    amount: base.value,
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.invoice.account,
    recipientType: "DESTINATION_CHAIN",
    deadline,
  };
}

export function assertExactOutput(req: { swapType?: unknown }): void {
  if (req.swapType !== "EXACT_OUTPUT") {
    throw new Error("Only exact-amount payments are supported");
  }
}

/** Guards and serializes a quote request. Never throws; the error text is user-facing. */
export function prepareQuoteBody(
  req: QuoteRequest,
): { ok: true; body: string } | { ok: false; error: string } {
  try {
    assertExactOutput(req);
  } catch {
    return { ok: false, error: "This payment could not be prepared." };
  }
  return { ok: true, body: JSON.stringify(req) };
}
export function checkQuoteAmountOut(
  invoice: Invoice,
  quote: { amountOut?: unknown } | undefined | null,
): Result<true> {
  const expected = toBaseUnits(invoice.amount);
  if (!expected.ok) return { ok: false, error: expected.error };
  if (!quote || quote.amountOut !== expected.value) {
    return { ok: false, error: "Amount mismatch" };
  }
  return { ok: true, value: true };
}

export function amountInChanged(
  a: { amountIn?: unknown } | undefined | null,
  b: { amountIn?: unknown } | undefined | null,
): boolean {
  return String(a?.amountIn ?? "") !== String(b?.amountIn ?? "");
}

// Defensive readers: absent or malformed fields are reported as undefined.
export function readTimeEstimate(r: PartialQuoteResponse | null | undefined): number | undefined {
  const v = r?.quote?.timeEstimate;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export function readDepositMemo(r: PartialQuoteResponse | null | undefined): string | undefined {
  const v = r?.quote?.depositMemo;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function readDepositAddress(r: PartialQuoteResponse | null | undefined): string | undefined {
  const v = r?.quote?.depositAddress;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** quote.deadline, falling back to quoteRequest.deadline. Returns an ISO string or undefined. */
export function readDeadline(r: PartialQuoteResponse | null | undefined): string | undefined {
  for (const v of [r?.quote?.deadline, r?.quoteRequest?.deadline]) {
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return v;
  }
  return undefined;
}
