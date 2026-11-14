import { describe, expect, it } from "vitest";
import {
  MAX_RECORDS_PER_ACCOUNT,
  MAX_RECORDS_PER_INVOICE,
  accountDepositPath,
  accountKeyFor,
  sanitizeAccountRecord,
  createMemoryStore,
  depositPath,
  getPaymentsStore,
  invoiceKeyFor,
  isSafeAddress,
  sanitizeRecord,
  type DepositRecord,
} from "@/lib/server/payments-store";

const rec = (address: string, createdAt = "2030-01-01T00:00:00.000Z"): DepositRecord => ({
  depositAddress: address,
  depositMemo: null,
  amountIn: "1010224",
  minAmountIn: "1000121",
  origin: { symbol: "USDC", blockchain: "eth", decimals: 6, assetId: "nep141:x" },
  deadline: "2030-01-01T00:30:00.000Z",
  createdAt,
});
const KEY = invoiceKeyFor("code-1");

describe("payments-store", () => {
  it("invoiceKey is sha256 hex and path is invoices/<key>/<address>.json", () => {
    expect(KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(depositPath(KEY, "abc.DEF-1_2")).toBe(`invoices/${KEY}/abc.DEF-1_2.json`);
  });

  it("rejects unsafe addresses", () => {
    for (const bad of ["", "../x", "a/b", "a b", "..", ".", "a\u0000b", "x".repeat(201)]) {
      expect(isSafeAddress(bad)).toBe(false);
    }
    expect(isSafeAddress("0xabc.near-1_x")).toBe(true);
  });

  it("memory store records, lists newest first, ignores duplicates", async () => {
    const s = createMemoryStore();
    await s.record(KEY, rec("a", "2030-01-01T00:00:00.000Z"));
    await s.record(KEY, rec("b", "2030-01-02T00:00:00.000Z"));
    await s.record(KEY, rec("a", "2031-01-01T00:00:00.000Z"));
    expect((await s.list(KEY)).map((d) => d.depositAddress)).toEqual(["b", "a"]);
    expect(await s.list(invoiceKeyFor("other"))).toEqual([]);
  });

  it("memory store rejects unsafe addresses", async () => {
    await expect(createMemoryStore().record(KEY, rec("../x"))).rejects.toThrow();
  });

  it("caps records per invoice", async () => {
    const s = createMemoryStore();
    for (let i = 0; i < MAX_RECORDS_PER_INVOICE + 5; i++) await s.record(KEY, rec(`addr${i}`));
    expect(await s.list(KEY)).toHaveLength(MAX_RECORDS_PER_INVOICE);
  });

  it("drops unknown fields such as a refund address", () => {
    const withExtra = { ...rec("a"), refundTo: "0xsecret", jwt: "j", ip: "1.2.3.4" };
    const clean = sanitizeRecord(withExtra);
    expect(Object.keys(clean!).sort()).toEqual(
      ["amountIn", "createdAt", "deadline", "depositAddress", "depositMemo", "minAmountIn", "origin"].sort(),
    );
    expect(JSON.stringify(clean)).not.toContain("secret");
  });

  it("account index: path uses sha256 of the account, lists newest first, ignores duplicates, caps at 200", async () => {
    const AK = accountKeyFor("shop.near");
    expect(AK).toBe(accountKeyFor("shop.near"));
    expect(AK).toMatch(/^[0-9a-f]{64}$/);
    expect(AK).not.toContain("shop");
    expect(accountDepositPath(AK, "abc")).toBe(`accounts/${AK}/abc.json`);
    const extra = { invoiceCode: "c", description: "d", amount: "1" };
    const s = createMemoryStore();
    await s.recordForAccount(AK, { ...rec("a", "2030-01-01T00:00:00.000Z"), ...extra });
    await s.recordForAccount(AK, { ...rec("b", "2030-01-02T00:00:00.000Z"), ...extra });
    await s.recordForAccount(AK, { ...rec("a", "2031-01-01T00:00:00.000Z"), ...extra });
    expect((await s.listForAccount(AK)).map((d) => d.depositAddress)).toEqual(["b", "a"]);
    const c = createMemoryStore();
    for (let i = 0; i < MAX_RECORDS_PER_ACCOUNT + 5; i++) await c.recordForAccount(AK, { ...rec(`addr${i}`), ...extra });
    expect(await c.listForAccount(AK)).toHaveLength(MAX_RECORDS_PER_ACCOUNT);
    await expect(c.recordForAccount(AK, { ...rec("../x"), ...extra })).rejects.toThrow();
    expect(sanitizeAccountRecord(rec("a"))).toBeNull();
    expect(Object.keys(sanitizeAccountRecord({ ...rec("a"), ...extra, refundTo: "x" })!)).not.toContain("refundTo");
  });
  it("is a no-op without Blob env", async () => {
    const s = getPaymentsStore({});
    await s.record(KEY, rec("a"));
    expect(await s.list(KEY)).toEqual([]);
    await s.recordForAccount(accountKeyFor("a.near"), { ...rec("a"), invoiceCode: "c", description: "", amount: "1" });
    expect(await s.listForAccount(accountKeyFor("a.near"))).toEqual([]);
  });
});
