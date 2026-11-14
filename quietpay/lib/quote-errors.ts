const RATE = "Too many requests. Please wait a moment and try again.";
const DOWN = "The payment service is not responding. Try again in a moment.";

/** Fixed payer-facing text for a failed quote request. Never shows upstream text. */
export function quoteErrorMessage(status: number | "network"): string {
  if (status === "network") return "Connection problem. Try again.";
  if (status === 400) return "We could not prepare this payment. Check the details and try again.";
  if (status === 401) return "Private payments are unavailable right now.";
  if (status === 413 || status === 429) return RATE;
  if (status >= 500) return DOWN;
  return "We could not prepare this payment. Try again in a moment.";
}
