import { describe, expect, it } from "vitest";
import { isValidNearAccount } from "../../lib/near-account";

describe("isValidNearAccount", () => {
  it("accepts a valid id", () => {
    expect(isValidNearAccount("alice.testnet")).toBe(true);
  });
  it("rejects invalid ids", () => {
    expect(isValidNearAccount("Alice.near")).toBe(false);
    expect(isValidNearAccount("a")).toBe(false);
    expect(isValidNearAccount("a..b")).toBe(false);
  });
});
