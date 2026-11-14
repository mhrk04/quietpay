import { describe, it, expect } from "vitest";
import { getConfig } from "@/lib/server/config";
import { proxyFetch, scrub, validateQuoteBody } from "@/lib/server/proxy";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("getConfig", () => {
  it("modes", () => {
    expect(getConfig({ ONECLICK_JWT: "x" }).mode).toBe("confidential");
    expect(getConfig({ QUIETPAY_ALLOW_PUBLIC_FALLBACK: "true" }).mode).toBe("public");
    expect(getConfig({ ONECLICK_JWT: "", QUIETPAY_ALLOW_PUBLIC_FALLBACK: "TRUE" }).mode).toBe("unconfigured");
    expect(getConfig({}).mode).toBe("unconfigured");
  });
});

describe("proxyFetch", () => {
  it("sends X-API-Key and passes through 2xx", async () => {
    let key: string | null = null;
    const r = await proxyFetch("/v0/tokens", {}, {
      jwt: "SECRET",
      fetchImpl: ((_u: string, i: RequestInit) => {
        key = new Headers(i.headers).get("X-API-Key");
        return json(200, [1]);
      }) as unknown as typeof fetch,
    });
    expect(key).toBe("SECRET");
    expect(r).toEqual({ status: 200, body: [1] });
  });

  it("passes status and scrubbed message", async () => {
    const r = await proxyFetch("/v0/quote", {}, {
      jwt: "SECRET",
      fetchImpl: (() => json(401, { message: "bad key SECRET" })) as unknown as typeof fetch,
    });
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
  });

  it("maps malformed JSON to 502", async () => {
    const r = await proxyFetch("/x", {}, {
      fetchImpl: (() => Promise.resolve(new Response("<html>", { status: 200 }))) as unknown as typeof fetch,
    });
    expect(r.status).toBe(502);
  });

  it("aborts to 504", async () => {
    const r = await proxyFetch("/x", {}, {
      timeoutMs: 20,
      fetchImpl: ((_u: string, i: RequestInit) =>
        new Promise((_res, rej) =>
          i.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))),
        )) as unknown as typeof fetch,
    });
    expect(r.status).toBe(504);
  });
});

describe("scrub", () => {
  it("removes all occurrences", () => {
    expect(scrub("a SECRET b SECRET", "SECRET")).not.toContain("SECRET");
  });
});

describe("validateQuoteBody", () => {
  const ok = {
    swapType: "EXACT_OUTPUT",
    depositType: "ORIGIN_CHAIN",
    refundType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    slippageTolerance: 100,
    deadline: "2026-01-01T00:00:00Z",
  };
  it("accepts a full body", () => expect(validateQuoteBody(ok).ok).toBe(true));
  it("names each missing field", () => {
    const { depositType, deadline, ...rest } = ok;
    void depositType; void deadline;
    const r = validateQuoteBody(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toContain("depositType");
      expect(r.message).toContain("deadline");
    }
  });
  it("rejects non EXACT_OUTPUT", () => {
    expect(validateQuoteBody({ ...ok, swapType: "EXACT_INPUT" }).ok).toBe(false);
  });
  it("treats slippageTolerance 0 as present", () => {
    expect(validateQuoteBody({ ...ok, slippageTolerance: 0 }).ok).toBe(true);
  });
});
