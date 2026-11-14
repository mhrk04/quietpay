import { describe, expect, it } from "vitest";
import {
  buildPayLink,
  buildStatusLink,
  decodeInvoice,
  encodeInvoice,
  parseStatusLink,
  validateInvoice,
  type Invoice,
} from "../../lib/link-codec";

const inv: Invoice = { amount: "12.5", account: "alice.near", description: "Café ☕ 😀 日本", createdAt: 1700000000000 };

describe("link-codec", () => {
  it("round trips unicode and emoji descriptions", () => {
    expect(decodeInvoice(encodeInvoice(inv))).toEqual({ ok: true, value: inv });
    expect(encodeInvoice(inv)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never throws on garbage", () => {
    for (const s of ["", "!!!", "a", "e30", "bnVsbA", "W10", "%%%"]) {
      expect(decodeInvoice(s).ok).toBe(false);
    }
  });

  it("validates amount, description and account", () => {
    const bad = (p: Partial<Invoice>) => validateInvoice({ ...inv, ...p }).ok;
    expect(bad({ amount: "999999999.999999" })).toBe(true);
    expect(bad({ amount: "1000000000" })).toBe(false);
    expect(bad({ amount: "1.50" })).toBe(false);
    expect(bad({ amount: "01" })).toBe(false);
    expect(bad({ amount: "0" })).toBe(false);
    expect(bad({ description: "x".repeat(140) })).toBe(true);
    expect(bad({ description: "x".repeat(141) })).toBe(false);
    expect(bad({ description: "😀".repeat(140) })).toBe(true);
    expect(bad({ account: "Bad Account" })).toBe(false);
  });

  it("builds pay and status links and parses status links", () => {
    expect(buildPayLink("https://x.app/", inv)).toBe(`https://x.app/pay?i=${encodeInvoice(inv)}`);
    const link = buildStatusLink("https://x.app", "0xabc", inv, { refund: "0xdef", deadline: 1700000100000 });
    expect(parseStatusLink(link)).toEqual({
      ok: true,
      value: { address: "0xabc", invoice: inv, refund: "0xdef", deadline: 1700000100000 },
    });
    const plain = parseStatusLink(buildStatusLink("https://x.app", "addr1", inv));
    expect(plain).toEqual({ ok: true, value: { address: "addr1", invoice: inv } });
  });

  it("rejects status links with missing or bad invoice", () => {
    expect(parseStatusLink("https://x.app/status?a=addr").ok).toBe(false);
    expect(parseStatusLink("https://x.app/status?a=addr&i=zzz").ok).toBe(false);
    expect(parseStatusLink(`https://x.app/status?i=${encodeInvoice(inv)}`).ok).toBe(false);
  });
});
