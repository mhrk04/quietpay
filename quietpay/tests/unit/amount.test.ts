import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "../../lib/amount";

describe("amount", () => {
  it("converts a valid amount", () => {
    expect(toBaseUnits("12.5")).toEqual({ ok: true, value: "12500000" });
    expect(fromBaseUnits("12500000")).toBe("12.5");
  });
  it("rejects 7 decimal places, zero, and decimals != 6", () => {
    expect(toBaseUnits("1.1234567").ok).toBe(false);
    expect(toBaseUnits("0").ok).toBe(false);
    expect(toBaseUnits("1", 18).ok).toBe(false);
  });
});
