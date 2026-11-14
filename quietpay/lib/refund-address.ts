import { isValidNearAccount } from "./near-account";

const EVM_CHAINS = new Set([
  "eth", "arb", "base", "op", "pol", "bsc", "avax", "gnosis", "bera", "monad", "xlayer", "plasma",
]);
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Format check per chain family. The API remains the final check for unknown chains. */
export function isValidRefundAddress(chain: string, addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0 || /\s/.test(addr)) return false;
  const c = (chain ?? "").toLowerCase();
  if (EVM_CHAINS.has(c)) return EVM_RE.test(addr);
  if (c === "near") return isValidNearAccount(addr);
  if (c === "sol") return SOLANA_RE.test(addr);
  return true;
}
