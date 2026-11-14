export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED"
  | "INCOMPLETE_DEPOSIT";

const MESSAGES: Record<SwapStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your payment",
  KNOWN_DEPOSIT_TX: "Payment seen, confirming",
  PROCESSING: "Converting and sending",
  SUCCESS: "Payment complete",
  REFUNDED: "Payment returned to you",
  FAILED: "Payment failed",
  INCOMPLETE_DEPOSIT: "Not enough was sent",
};

const TERMINAL: ReadonlySet<string> = new Set(["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"]);

export const FALLBACK_STATUS_MESSAGE = "Checking payment";

export function isTerminal(s: string): boolean {
  return TERMINAL.has(s);
}

export function statusMessage(s: string): string {
  return Object.prototype.hasOwnProperty.call(MESSAGES, s)
    ? MESSAGES[s as SwapStatus]
    : FALLBACK_STATUS_MESSAGE;
}

const REFUND_REASONS: Record<string, string> = {
  PARTIAL_DEPOSIT: "Not enough was sent",
  INCOMPLETE_DEPOSIT: "Not enough was sent",
  INSUFFICIENT_DEPOSIT: "Not enough was sent",
  DEADLINE_EXCEEDED: "The payment window closed",
  EXPIRED: "The payment window closed",
  SLIPPAGE: "The price moved too much",
  PRICE_MOVED: "The price moved too much",
};

/** Plain-language refund reason. Avoids exposing internal terms. */
export function refundReasonText(r?: string): string {
  if (!r || !r.trim()) return "The payment could not be completed";
  const key = r.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (REFUND_REASONS[key]) return REFUND_REASONS[key];
  // Unknown code: humanize e.g. SOME_REASON -> "Some reason"
  if (/^[A-Z0-9_]+$/.test(key) && key.length <= 60) {
    const words = key.toLowerCase().replace(/_+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return "The payment could not be completed";
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";
/** Dashboard grouping: paid, still moving, or returned/failed. */
export type StatusCategory = "paid" | "progress" | "returned";
export interface StatusBadgeInfo {
  label: string;
  tone: StatusTone;
  category: StatusCategory;
}

const BADGES: Record<SwapStatus, StatusBadgeInfo> = {
  PENDING_DEPOSIT: { label: "Waiting for payment", tone: "warning", category: "progress" },
  KNOWN_DEPOSIT_TX: { label: "Confirming", tone: "info", category: "progress" },
  PROCESSING: { label: "Processing", tone: "info", category: "progress" },
  SUCCESS: { label: "Paid", tone: "success", category: "paid" },
  REFUNDED: { label: "Returned", tone: "neutral", category: "returned" },
  FAILED: { label: "Failed", tone: "danger", category: "returned" },
  INCOMPLETE_DEPOSIT: { label: "Not enough sent", tone: "danger", category: "returned" },
};

/** Short badge text, color tone and dashboard group. Unknown or unavailable statuses count as in progress. */
export function statusBadge(s: string | null): StatusBadgeInfo {
  if (s !== null && Object.prototype.hasOwnProperty.call(BADGES, s)) return BADGES[s as SwapStatus];
  return { label: "Status unavailable", tone: "neutral", category: "progress" };
}
