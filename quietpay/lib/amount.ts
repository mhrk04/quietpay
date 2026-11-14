export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const DECIMAL_RE = /^\d+(\.\d{1,6})?$/;
const MAX_LENGTH = 30;

/** Convert a decimal USDC string to a base-unit integer string. BigInt only, never rounds. */
export function toBaseUnits(decimal: string, decimals = 6): Result<string> {
  if (decimals !== 6) {
    return { ok: false, error: "Unsupported decimals: must be 6" };
  }
  if (typeof decimal !== "string" || decimal.length === 0) {
    return { ok: false, error: "Amount is empty" };
  }
  if (decimal.length > MAX_LENGTH) {
    return { ok: false, error: "Amount is longer than 30 characters" };
  }
  if (!DECIMAL_RE.test(decimal)) {
    return {
      ok: false,
      error: "Amount must be digits with an optional '.' and at most 6 decimal places",
    };
  }
  const [whole, frac = ""] = decimal.split(".");
  const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0"));
  if (base <= 0n) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  return { ok: true, value: base.toString() };
}

/** Convert a base-unit integer string to a canonical decimal string (trailing zeros trimmed). */
export function fromBaseUnits(base: string, decimals = 6): string {
  if (typeof base !== "string" || !/^\d+$/.test(base)) {
    throw new Error("Base units must be a non-negative integer string");
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Invalid decimals");
  }
  const n = BigInt(base);
  const unit = 10n ** BigInt(decimals);
  const whole = n / unit;
  const frac = (n % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
