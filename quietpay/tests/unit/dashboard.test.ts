import { describe, expect, it } from "vitest";
import { statusBadge, statusMessage } from "@/lib/status";
import { shortAccount } from "@/lib/session-store";

describe("statusBadge", () => {
  it("maps every swap status to a label, tone and dashboard group", () => {
    expect(statusBadge("SUCCESS")).toEqual({ label: "Paid", tone: "success", category: "paid" });
    for (const s of ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING"]) expect(statusBadge(s).category).toBe("progress");
    for (const s of ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"]) expect(statusBadge(s).category).toBe("returned");
    expect(statusBadge("FAILED").tone).toBe("danger");
  });
  it("treats unknown or unavailable status as in progress with a text label", () => {
    expect(statusBadge(null)).toMatchObject({ label: "Status unavailable", category: "progress" });
    expect(statusBadge("toString").category).toBe("progress");
  });
  it("keeps the long status messages unchanged", () => {
    expect(statusMessage("SUCCESS")).toBe("Payment complete");
  });
});

describe("shortAccount", () => {
  it("keeps normal accounts and shortens 64-character implicit accounts", () => {
    expect(shortAccount("mhrk7676.near")).toBe("mhrk7676.near");
    const implicit = "a".repeat(60) + "beef";
    expect(shortAccount(implicit)).toBe("aaaaaaaa…aabeef");
    expect(shortAccount(implicit).length).toBeLessThan(20);
  });
});
