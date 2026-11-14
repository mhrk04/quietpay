import { describe, it, expect } from "vitest";
import { buildReceiptShareUrl, buildWhatsappUrl } from "@/lib/whatsapp";

describe("whatsapp", () => {
  it("encodes text and caps receipt URL length", () => {
    expect(decodeURIComponent(buildWhatsappUrl("a b&c").split("text=")[1])).toBe("a b&c");
    const inv = { amount: "5", account: "bob.near", description: "😀".repeat(500) };
    const url = buildReceiptShareUrl(inv, "https://x.test/status?a=1");
    expect(url.length).toBeLessThanOrEqual(2000);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("…");
    expect(text).toContain("bob.near");
    expect(text).toContain("https://x.test/status?a=1");
  });
});
