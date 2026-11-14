import { describe, it, expect } from "vitest";
import {
  activeKey,
  clearActiveDeposit,
  loadActiveDeposit,
  saveActiveDeposit,
  type ActiveDeposit,
  type ActiveStorage,
} from "@/lib/active-deposit";
import { trackingMessage } from "@/lib/whatsapp";

function memStore(): ActiveStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
const throwing: ActiveStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};
const NOW = 1_700_000_000_000;
const dep: ActiveDeposit = {
  address: "0xabc",
  memo: "m1",
  amountIn: "1010224",
  origin: { symbol: "USDC", blockchain: "eth", decimals: 6, assetId: "nep141:eth-0xa0.omft.near" },
  refund: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
  deadlineMs: NOW + 60_000,
  statusHref: "https://x.test/status?a=0xabc",
};

describe("active-deposit", () => {
  it("round-trips a saved deposit and uses the invoice code in the key", () => {
    const s = memStore();
    expect(saveActiveDeposit("CODE", dep, s)).toBe(true);
    expect(s.map.has("quietpay:active:CODE")).toBe(true);
    expect(activeKey("CODE")).toBe("quietpay:active:CODE");
    expect(loadActiveDeposit("CODE", s, () => NOW)).toEqual(dep);
  });
  it("drops and returns null for expired entries", () => {
    const s = memStore();
    saveActiveDeposit("C", dep, s);
    expect(loadActiveDeposit("C", s, () => dep.deadlineMs)).toBeNull();
    expect(s.map.size).toBe(0);
  });
  it("drops malformed entries", () => {
    const s = memStore();
    for (const bad of ["not json", "[]", JSON.stringify({ ...dep, address: "" }), JSON.stringify({ ...dep, origin: 1 })]) {
      s.setItem(activeKey("C"), bad);
      expect(loadActiveDeposit("C", s, () => NOW)).toBeNull();
      expect(s.map.size).toBe(0);
    }
  });
  it("clear removes the entry", () => {
    const s = memStore();
    saveActiveDeposit("C", dep, s);
    clearActiveDeposit("C", s);
    expect(loadActiveDeposit("C", s, () => NOW)).toBeNull();
  });
  it("never throws when storage throws", () => {
    expect(saveActiveDeposit("C", dep, throwing)).toBe(false);
    expect(loadActiveDeposit("C", throwing, () => NOW)).toBeNull();
    expect(() => clearActiveDeposit("C", throwing)).not.toThrow();
  });
});

describe("trackingMessage", () => {
  it("names the amount, description and status link", () => {
    const m = trackingMessage({ amount: "5", account: "a.near", description: "Coffee" }, "https://x.test/status?a=1");
    expect(m).toBe("I have started paying 5 USDC for Coffee. Track it here: https://x.test/status?a=1");
  });
  it("omits the description when empty", () => {
    const m = trackingMessage({ amount: "5", account: "a.near", description: "" }, "https://x.test/s");
    expect(m).toBe("I have started paying 5 USDC. Track it here: https://x.test/s");
  });
});
