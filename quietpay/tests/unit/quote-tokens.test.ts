import { describe, expect, it } from "vitest";
import {
  chainName, filterTokens, findDestinationToken, getCachedTokens, groupByChain, setCachedTokens,
  type TokenInfo, type TokenStorage,
} from "@/lib/tokens";
import { isValidRefundAddress } from "@/lib/refund-address";
import {
  amountInChanged, assertExactOutput, prepareQuoteBody, buildQuoteRequest, checkQuoteAmountOut, readDeadline,
  readDepositMemo, readTimeEstimate,
} from "@/lib/quote";

const usdc: TokenInfo = { assetId: "a-near", symbol: "USDC", decimals: 6, blockchain: "near" };
const eth: TokenInfo = { assetId: "a-eth", symbol: "ETH", decimals: 18, blockchain: "eth" };
const inv = { amount: "12.5", account: "shop.near", description: "x", createdAt: 1 };

function mem(): TokenStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("tokens", () => {
  it("groups, filters, finds destination", () => {
    expect(groupByChain([usdc, eth]).get("eth")).toEqual([eth]);
    expect(filterTokens([usdc, eth], "ET")).toEqual([eth]);
    expect(findDestinationToken([eth, usdc])).toBe(usdc);
  });
  it("cache honours 300 s TTL", () => {
    const s = mem();
    setCachedTokens([eth], s, 1000);
    expect(getCachedTokens(s, 1000 + 299_999)).toEqual([eth]);
    expect(getCachedTokens(s, 1000 + 300_000)).toBeNull();
  });
});

describe("refund address", () => {
  it("validates per family", () => {
    expect(isValidRefundAddress("eth", "0x" + "a".repeat(40))).toBe(true);
    expect(isValidRefundAddress("eth", "0x123")).toBe(false);
    expect(isValidRefundAddress("near", "alice.near")).toBe(true);
    expect(isValidRefundAddress("sol", "11111111111111111111111111111111")).toBe(true);
    expect(isValidRefundAddress("btc", "bc1qabc")).toBe(true);
    expect(isValidRefundAddress("btc", "bc1 qabc")).toBe(false);
    expect(isValidRefundAddress("btc", "")).toBe(false);
  });
});

describe("quote", () => {
  it("builds a complete request", () => {
    const r = buildQuoteRequest({ invoice: inv, origin: eth, refundTo: "0x1", destination: usdc, dry: true, now: 0 });
    expect(r).toMatchObject({
      swapType: "EXACT_OUTPUT", slippageTolerance: 100, depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", amount: "12500000",
      recipient: "shop.near", dry: true, deadline: "1970-01-01T00:30:00.000Z",
    });
  });
  it("asserts and checks amounts", () => {
    expect(() => assertExactOutput({ swapType: "EXACT_INPUT" })).toThrow();
    expect(() => assertExactOutput({ swapType: "EXACT_OUTPUT" })).not.toThrow();
    expect(checkQuoteAmountOut(inv, { amountOut: "12500000" }).ok).toBe(true);
    expect(checkQuoteAmountOut(inv, { amountOut: "12500001" }).ok).toBe(false);
    expect(amountInChanged({ amountIn: "1" }, { amountIn: "2" })).toBe(true);
    expect(amountInChanged({ amountIn: "1" }, { amountIn: "1" })).toBe(false);
  });
  it("reads optional fields defensively", () => {
    const dry = { quote: { timeEstimate: 45 }, quoteRequest: { deadline: "2030-01-01T00:00:00Z" } };
    expect(readTimeEstimate(dry)).toBe(45);
    expect(readDepositMemo(dry)).toBeUndefined();
    expect(readDeadline(dry)).toBe("2030-01-01T00:00:00Z");
    expect(readDeadline({})).toBeUndefined();
  });
});

describe("prepareQuoteBody", () => {
  const good = buildQuoteRequest({ invoice: inv, origin: eth, refundTo: "0x1", destination: usdc, dry: true, now: 0 });
  it("serializes a valid EXACT_OUTPUT request", () => {
    const r = prepareQuoteBody(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.body).swapType).toBe("EXACT_OUTPUT");
  });
  it("refuses any other swap type with a user-facing message", () => {
    const r = prepareQuoteBody({ ...good, swapType: "EXACT_INPUT" } as unknown as typeof good);
    expect(r).toEqual({ ok: false, error: "This payment could not be prepared." });
  });
});
describe("chain names", () => {
  it("filterTokens matches a human chain name", () => {
    expect(chainName("eth")).toBe("Ethereum");
    expect(chainName("unknownchain")).toBe("unknownchain");
    expect(filterTokens([usdc, eth], "Ethereum")).toEqual([eth]);
    expect(filterTokens([usdc, eth], "near")).toEqual([usdc]);
  });
});
