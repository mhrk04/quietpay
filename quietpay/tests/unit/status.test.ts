import { describe, it, expect } from "vitest";
import { isTerminal, statusMessage } from "@/lib/status";

describe("status", () => {
  it("maps statuses and terminal flags", () => {
    expect(statusMessage("SUCCESS")).toBe("Payment complete");
    expect(statusMessage("bogus")).toBe("Checking payment");
    expect(isTerminal("REFUNDED")).toBe(true);
    expect(isTerminal("PROCESSING")).toBe(false);
  });
});
