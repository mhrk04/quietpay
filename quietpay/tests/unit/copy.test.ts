import { describe, expect, it } from "vitest";
import { copyText, formatCountdown } from "@/lib/copy";

describe("copyText", () => {
  it("returns true and writes the exact value", async () => {
    let written = "";
    const ok = await copyText("abc 123", { writeText: async (t) => void (written = t) });
    expect(ok).toBe(true);
    expect(written).toBe("abc 123");
  });
  it("returns false when the clipboard rejects or is missing", async () => {
    expect(await copyText("x", { writeText: async () => { throw new Error("denied"); } })).toBe(false);
    expect(await copyText("x", undefined)).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("formats minutes and seconds", () => {
    expect(formatCountdown(125_000)).toBe("2:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
    expect(formatCountdown(3_600_000)).toBe("60:00");
  });
});
