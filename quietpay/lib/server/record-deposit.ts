import { toBaseUnits } from "@/lib/amount";
import { decodeInvoice } from "@/lib/link-codec";
import {
  accountKeyFor,
  getPaymentsStore,
  invoiceKeyFor,
  isSafeAddress,
  type AccountRecord,
  type DepositRecord,
} from "@/lib/server/payments-store";
import { proxyFetch } from "@/lib/server/proxy";
import type { TokenInfo } from "@/lib/tokens";

export const INVOICE_HEADER = "x-quietpay-invoice";
export const RECORD_TIMEOUT_MS = 2000;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

async function findOrigin(assetId: string, jwt?: string): Promise<TokenInfo | undefined> {
  const r = await proxyFetch("/v0/tokens", { method: "GET", cache: "no-store" }, { jwt, timeoutMs: RECORD_TIMEOUT_MS });
  if (r.status < 200 || r.status >= 300 || !Array.isArray(r.body)) return undefined;
  return (r.body as TokenInfo[]).find((t) => t?.assetId === assetId);
}

/**
 * Builds the record to store, or null when the quote must not be recorded.
 * The deposit address is read only from the upstream (1Click) response.
 */
async function buildRecord(
  invoiceCode: string,
  clientBody: unknown,
  upstream: { status: number; body: unknown },
  jwt?: string,
): Promise<{ key: string; record: DepositRecord; accountKey: string; accountRecord: AccountRecord } | null> {
  if (upstream.status < 200 || upstream.status >= 300) return null;
  const req = obj(clientBody);
  if (!req || req.dry !== false || req.swapType !== "EXACT_OUTPUT") return null;
  const decoded = decodeInvoice(invoiceCode);
  if (!decoded.ok) return null;
  const inv = decoded.value;
  const base = toBaseUnits(inv.amount);
  if (!base.ok || req.recipient !== inv.account || req.amount !== base.value) return null;
  const resp = obj(upstream.body);
  const quote = obj(resp?.quote);
  const address = text(quote?.depositAddress);
  const amountIn = text(quote?.amountIn);
  const minAmountIn = text(quote?.minAmountIn);
  const assetId = text(req.originAsset);
  if (!quote || !isSafeAddress(address) || !amountIn || !minAmountIn || !assetId) return null;
  const deadline = text(quote.deadline) ?? text(obj(resp?.quoteRequest)?.deadline) ?? text(req.deadline);
  if (!deadline || !Number.isFinite(Date.parse(deadline))) return null;
  const token = await findOrigin(assetId, jwt);
  if (!token) return null;
  const record: DepositRecord = {
      depositAddress: address,
      depositMemo: text(quote.depositMemo) ?? null,
      amountIn,
      minAmountIn,
      origin: { symbol: token.symbol, blockchain: token.blockchain, decimals: token.decimals, assetId: token.assetId },
      deadline,
      createdAt: new Date().toISOString(),
  };
  // The account is the invoice recipient the server already matched against req.recipient above.
  return {
    key: invoiceKeyFor(invoiceCode),
    record,
    accountKey: accountKeyFor(inv.account),
    accountRecord: { ...record, invoiceCode, description: inv.description, amount: inv.amount },
  };
}

/** Records a live deposit. Waits at most RECORD_TIMEOUT_MS, never throws, logs nothing sensitive. */
export async function recordLiveDeposit(
  invoiceCode: string | null,
  clientBody: unknown,
  upstream: { status: number; body: unknown },
  jwt?: string,
): Promise<void> {
  if (!invoiceCode) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const built = await buildRecord(invoiceCode, clientBody, upstream, jwt);
      if (!built) return;
      const store = getPaymentsStore();
      await store.record(built.key, built.record);
      await store.recordForAccount(built.accountKey, built.accountRecord);
    })();
    work.catch(() => {});
    await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, RECORD_TIMEOUT_MS)))]);
  } catch {
    console.error("payment record failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
