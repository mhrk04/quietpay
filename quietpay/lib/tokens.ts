export interface TokenInfo {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  price?: number;
  contractAddress?: string;
}

export const TOKEN_CACHE_KEY = "quietpay:tokens";
export const TOKEN_CACHE_TTL_MS = 300_000;

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function groupByChain(tokens: TokenInfo[]): Map<string, TokenInfo[]> {
  const groups = new Map<string, TokenInfo[]>();
  for (const t of tokens) {
    const list = groups.get(t.blockchain);
    if (list) list.push(t);
    else groups.set(t.blockchain, [t]);
  }
  return groups;
}

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum", near: "NEAR", sol: "Solana", base: "Base", arb: "Arbitrum", btc: "Bitcoin",
  bsc: "BNB Chain", pol: "Polygon", op: "Optimism", avax: "Avalanche", ton: "TON", tron: "Tron",
  sui: "Sui", doge: "Dogecoin", xrp: "XRP Ledger", zec: "Zcash",
};
/** Human chain name for a blockchain code; falls back to the code itself. */
export function chainName(blockchain: string): string {
  return CHAIN_NAMES[blockchain] ?? blockchain;
}
export function filterTokens(tokens: TokenInfo[], query: string): TokenInfo[] {
  const q = query.toLowerCase();
  if (!q) return tokens;
  return tokens.filter(
    (t) => t.symbol.toLowerCase().includes(q) || t.blockchain.toLowerCase().includes(q) ||
      chainName(t.blockchain).toLowerCase().includes(q),
  );
}

function defaultStorage(): TokenStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Returns the cached list when younger than 300 s, otherwise null (caller refetches). */
export function getCachedTokens(
  storage: TokenStorage | null = defaultStorage(),
  now: number = Date.now(),
): TokenInfo[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; tokens?: unknown };
    if (typeof parsed.at !== "number" || !Array.isArray(parsed.tokens)) return null;
    const age = now - parsed.at;
    if (age < 0 || age >= TOKEN_CACHE_TTL_MS) return null;
    return parsed.tokens as TokenInfo[];
  } catch {
    return null;
  }
}

export function setCachedTokens(
  tokens: TokenInfo[],
  storage: TokenStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ at: now, tokens }));
  } catch {
    // storage full or unavailable: caching is optional
  }
}

/** The payout asset: NEAR USDC, always taken from the fetched token list. */
export function findDestinationToken(tokens: TokenInfo[]): TokenInfo | undefined {
  return tokens.find(
    (t) => t.blockchain === "near" && t.symbol === "USDC" && t.decimals === 6,
  );
}
