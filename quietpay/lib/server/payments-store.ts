import { createHash } from "node:crypto";

/** One recorded live deposit. Deliberately has no refund address, key, IP or personal data. */
export interface DepositRecord {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  minAmountIn: string;
  origin: { symbol: string; blockchain: string; decimals: number; assetId: string };
  deadline: string;
  createdAt: string;
}

export interface PaymentsStore {
  record(invoiceKey: string, deposit: DepositRecord): Promise<void>;
  list(invoiceKey: string): Promise<DepositRecord[]>;
  recordForAccount(accountKey: string, deposit: AccountRecord): Promise<void>;
  listForAccount(accountKey: string): Promise<AccountRecord[]>;
}

/** A deposit as listed for the merchant account: the deposit plus the invoice it belongs to. */
export interface AccountRecord extends DepositRecord {
  invoiceCode: string;
  description: string;
  amount: string;
}

export const MAX_RECORDS_PER_INVOICE = 20;
export const MAX_RECORDS_PER_ACCOUNT = 200;
const ADDRESS_RE = /^[A-Za-z0-9._-]{1,200}$/;
const KEY_RE = /^[0-9a-f]{64}$/;

export const invoiceKeyFor = (code: string): string => createHash("sha256").update(code).digest("hex");
export const isSafeAddress = (a: unknown): a is string => typeof a === "string" && ADDRESS_RE.test(a) && a !== "." && a !== "..";
export const accountKeyFor = (accountId: string): string => createHash("sha256").update(accountId).digest("hex");
export const accountDepositPath = (accountKey: string, address: string): string => `accounts/${accountKey}/${address}.json`;
export const depositPath = (invoiceKey: string, address: string): string => `invoices/${invoiceKey}/${address}.json`;

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Rebuilds a record from untrusted data with only the allowed fields; null if invalid. */
export function sanitizeRecord(raw: unknown): DepositRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const o = r.origin as Record<string, unknown> | null;
  if (!isSafeAddress(r.depositAddress) || !str(r.amountIn) || !str(r.minAmountIn)) return null;
  if (!str(r.deadline) || !str(r.createdAt) || !o || typeof o !== "object") return null;
  if (!str(o.symbol) || !str(o.blockchain) || typeof o.decimals !== "number" || !str(o.assetId)) return null;
  return {
    depositAddress: r.depositAddress,
    depositMemo: str(r.depositMemo) ? r.depositMemo : null,
    amountIn: r.amountIn,
    minAmountIn: r.minAmountIn,
    origin: { symbol: o.symbol, blockchain: o.blockchain, decimals: o.decimals, assetId: o.assetId },
    deadline: r.deadline,
    createdAt: r.createdAt,
  };
}

/** Same as sanitizeRecord, plus the invoice fields; null if invalid. */
export function sanitizeAccountRecord(raw: unknown): AccountRecord | null {
  const base = sanitizeRecord(raw);
  const r = raw as Record<string, unknown> | null;
  if (!base || !r || !str(r.invoiceCode) || typeof r.description !== "string" || !str(r.amount)) return null;
  return { ...base, invoiceCode: r.invoiceCode, description: r.description, amount: r.amount };
}
const newestFirst = (a: DepositRecord, b: DepositRecord) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function createMemoryStore(): PaymentsStore {
  const data = new Map<string, Map<string, DepositRecord>>();
  const accounts = new Map<string, Map<string, AccountRecord>>();
  return {
    async recordForAccount(accountKey, deposit) {
      const rec = sanitizeAccountRecord(deposit);
      if (!rec || !KEY_RE.test(accountKey)) throw new Error("invalid record");
      const m = accounts.get(accountKey) ?? new Map<string, AccountRecord>();
      if (m.has(rec.depositAddress) || m.size >= MAX_RECORDS_PER_ACCOUNT) return;
      m.set(rec.depositAddress, rec);
      accounts.set(accountKey, m);
    },
    async listForAccount(accountKey) {
      return [...(accounts.get(accountKey)?.values() ?? [])].sort(newestFirst);
    },
    async record(invoiceKey, deposit) {
      const rec = sanitizeRecord(deposit);
      if (!rec || !KEY_RE.test(invoiceKey)) throw new Error("invalid record");
      const m = data.get(invoiceKey) ?? new Map<string, DepositRecord>();
      if (m.has(rec.depositAddress) || m.size >= MAX_RECORDS_PER_INVOICE) return;
      m.set(rec.depositAddress, rec);
      data.set(invoiceKey, m);
    },
    async list(invoiceKey) {
      return [...(data.get(invoiceKey)?.values() ?? [])].sort(newestFirst);
    },
  };
}

/** Private Vercel Blob implementation. Server-only. */
export function createBlobStore(): PaymentsStore {
  return {
    async recordForAccount(accountKey, deposit) {
      const rec = sanitizeAccountRecord(deposit);
      if (!rec || !KEY_RE.test(accountKey)) throw new Error("invalid record");
      const { put, list } = await import("@vercel/blob");
      const existing = await list({ prefix: `accounts/${accountKey}/`, limit: MAX_RECORDS_PER_ACCOUNT });
      if (existing.blobs.length >= MAX_RECORDS_PER_ACCOUNT) return;
      try {
        await put(accountDepositPath(accountKey, rec.depositAddress), JSON.stringify(rec), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
        });
      } catch (e) {
        if (!(e instanceof Error && /already exists/i.test(e.message))) throw e;
      }
    },
    async listForAccount(accountKey) {
      if (!KEY_RE.test(accountKey)) return [];
      const { get, list } = await import("@vercel/blob");
      const res = await list({ prefix: `accounts/${accountKey}/`, limit: MAX_RECORDS_PER_ACCOUNT });
      const rows = await Promise.all(
        res.blobs.slice(0, MAX_RECORDS_PER_ACCOUNT).map(async (b) => {
          try {
            const got = await get(b.pathname, { access: "private" });
            if (!got || got.statusCode !== 200) return null;
            return sanitizeAccountRecord(JSON.parse(await new Response(got.stream).text()));
          } catch {
            return null;
          }
        }),
      );
      return rows.filter((r): r is AccountRecord => r !== null).sort(newestFirst);
    },
    async record(invoiceKey, deposit) {
      const rec = sanitizeRecord(deposit);
      if (!rec || !KEY_RE.test(invoiceKey)) throw new Error("invalid record");
      const { put, list } = await import("@vercel/blob");
      const existing = await list({ prefix: `invoices/${invoiceKey}/`, limit: MAX_RECORDS_PER_INVOICE });
      if (existing.blobs.length >= MAX_RECORDS_PER_INVOICE) return;
      try {
        await put(depositPath(invoiceKey, rec.depositAddress), JSON.stringify(rec), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
        });
      } catch (e) {
        // Same deposit address already recorded: nothing to do.
        if (!(e instanceof Error && /already exists/i.test(e.message))) throw e;
      }
    },
    async list(invoiceKey) {
      if (!KEY_RE.test(invoiceKey)) return [];
      const { get, list } = await import("@vercel/blob");
      const res = await list({ prefix: `invoices/${invoiceKey}/`, limit: MAX_RECORDS_PER_INVOICE });
      const out: DepositRecord[] = [];
      for (const b of res.blobs.slice(0, MAX_RECORDS_PER_INVOICE)) {
        try {
          const got = await get(b.pathname, { access: "private" });
          if (!got || got.statusCode !== 200) continue;
          const rec = sanitizeRecord(JSON.parse(await new Response(got.stream).text()));
          if (rec) out.push(rec);
        } catch {
          // skip unreadable record
        }
      }
      return out.sort(newestFirst);
    },
  };
}

const noopStore: PaymentsStore = {
  async record() {},
  async list() { return []; },
  async recordForAccount() {},
  async listForAccount() { return []; },
};

let override: PaymentsStore | null = null;
let blobStore: PaymentsStore | null = null;

/** Test hook: pass a store to force it, or null to restore env-based selection. */
export function setPaymentsStoreForTests(s: PaymentsStore | null): void {
  override = s;
}

export function getPaymentsStore(env: Record<string, string | undefined> = process.env): PaymentsStore {
  if (override) return override;
  if (!env.BLOB_READ_WRITE_TOKEN) return noopStore;
  return (blobStore ??= createBlobStore());
}
