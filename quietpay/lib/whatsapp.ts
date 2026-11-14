import { statusMessage } from "./status";

/** Minimal local shape; structurally compatible with lib/link-codec Invoice. */
export interface WhatsappInvoice {
  amount: string;
  account: string;
  description: string;
}

export const WHATSAPP_URL_MAX = 2000;
const ELLIPSIS = "\u2026";
const BASE = "https://wa.me/?text=";

export function buildWhatsappUrl(text: string): string {
  return BASE + encodeURIComponent(text);
}

function line(inv: WhatsappInvoice, description: string): string {
  return description ? `${description}\n${inv.amount} USDC` : `${inv.amount} USDC`;
}

export function paymentRequestMessage(inv: WhatsappInvoice, payLink: string): string {
  return `Payment request: ${line(inv, inv.description)}\nPay here: ${payLink}`;
}

function receiptWith(inv: WhatsappInvoice, statusUrl: string, description: string): string {
  return `Receipt: ${line(inv, description)}\nPaid to: ${inv.account}\nDetails: ${statusUrl}`;
}

export function receiptMessage(inv: WhatsappInvoice, statusUrl: string): string {
  return receiptWith(inv, statusUrl, inv.description);
}

export function statusOnlyMessage(statusUrl: string, status: string): string {
  return `${statusMessage(status)}\n${statusUrl}`;
}

export function buildReceiptShareUrl(inv: WhatsappInvoice, statusUrl: string): string {
  const build = (d: string) => buildWhatsappUrl(receiptWith(inv, statusUrl, d));
  const full = build(inv.description);
  if (full.length <= WHATSAPP_URL_MAX) return full;

  const cps = Array.from(inv.description);
  // Largest n such that first n code points + ellipsis fits. Length is monotonic in n.
  let lo = 0;
  let hi = cps.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (build(cps.slice(0, mid).join("") + ELLIPSIS).length <= WHATSAPP_URL_MAX) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Even an empty description does not fit: return it empty (status URL is bounded in practice).
  if (best < 0) return build("");
  return build(cps.slice(0, best).join("") + ELLIPSIS);
}
export function trackingMessage(inv: WhatsappInvoice, statusUrl: string): string {
  const what = inv.description ? `${inv.amount} USDC for ${inv.description}` : `${inv.amount} USDC`;
  return `I have started paying ${what}. Track it here: ${statusUrl}`;
}
