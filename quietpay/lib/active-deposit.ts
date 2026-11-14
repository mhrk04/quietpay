/** Persists the active deposit for an invoice so the pay link can resume it. No secrets are stored. */
export interface ActiveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ActiveDeposit {
  address: string;
  memo?: string;
  /** Base units of the origin token. */
  amountIn: string;
  origin: { symbol: string; blockchain: string; decimals: number; assetId: string };
  refund: string;
  deadlineMs: number;
  statusHref: string;
}
export const ACTIVE_PREFIX = "quietpay:active:";
export const activeKey = (code: string): string => ACTIVE_PREFIX + code;
function defaultStorage(): ActiveStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
function parse(raw: unknown): ActiveDeposit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const o = r.origin as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (!nonEmpty(r.address) || /\s/.test(r.address)) return null;
  if (r.memo !== undefined && !nonEmpty(r.memo)) return null;
  if (typeof r.amountIn !== "string" || !/^\d+$/.test(r.amountIn)) return null;
  if (!nonEmpty(r.refund) || !nonEmpty(r.statusHref)) return null;
  if (typeof r.deadlineMs !== "number" || !Number.isFinite(r.deadlineMs)) return null;
  if (!nonEmpty(o.symbol) || !nonEmpty(o.blockchain) || !nonEmpty(o.assetId)) return null;
  if (typeof o.decimals !== "number" || !Number.isInteger(o.decimals) || o.decimals < 0 || o.decimals > 36) return null;
  return {
    address: r.address,
    ...(r.memo !== undefined ? { memo: r.memo as string } : {}),
    amountIn: r.amountIn,
    origin: { symbol: o.symbol, blockchain: o.blockchain, decimals: o.decimals, assetId: o.assetId },
    refund: r.refund,
    deadlineMs: r.deadlineMs,
    statusHref: r.statusHref,
  };
}
export function saveActiveDeposit(
  code: string,
  dep: ActiveDeposit,
  storage: ActiveStorage | undefined = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(activeKey(code), JSON.stringify(dep));
    return true;
  } catch {
    return false;
  }
}
export function clearActiveDeposit(code: string, storage: ActiveStorage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(activeKey(code));
  } catch {
    /* ignore */
  }
}
/** Returns a valid, non-expired entry or null. Expired and malformed entries are removed. */
export function loadActiveDeposit(
  code: string,
  storage: ActiveStorage | undefined = defaultStorage(),
  now: () => number = Date.now,
): ActiveDeposit | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(activeKey(code));
    if (raw === null) return null;
    let dep: ActiveDeposit | null = null;
    try {
      dep = parse(JSON.parse(raw));
    } catch {
      dep = null;
    }
    if (!dep || dep.deadlineMs <= now()) {
      clearActiveDeposit(code, storage);
      return null;
    }
    return dep;
  } catch {
    return null;
  }
}
