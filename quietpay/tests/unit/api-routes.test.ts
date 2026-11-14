import { afterEach, describe, expect, it, vi } from "vitest";
// connection() only works inside a Next request scope.
vi.mock("next/server", () => ({ connection: async () => {} }));
import { POST as quotePost } from "@/app/api/quote/route";
import { GET as tokensGet } from "@/app/api/tokens/route";
import { GET as statusGet } from "@/app/api/status/route";
import { POST as submitPost } from "@/app/api/deposit-submit/route";

const validBody = {
  swapType: "EXACT_OUTPUT",
  depositType: "ORIGIN_CHAIN",
  refundType: "ORIGIN_CHAIN",
  recipientType: "DESTINATION_CHAIN",
  slippageTolerance: 100,
  deadline: "2030-01-01T00:00:00Z",
  dry: true,
  confidentiality: "public",
};

function req(body: unknown) {
  return new Request("http://localhost/api/quote", { method: "POST", body: JSON.stringify(body) });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/quote", () => {
  it("returns 500 and makes no upstream call when unconfigured", async () => {
    vi.stubEnv("ONECLICK_JWT", "");
    vi.stubEnv("QUIETPAY_ALLOW_PUBLIC_FALLBACK", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await quotePost(req(validBody));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("Server is not configured");
    expect(f).not.toHaveBeenCalled();
  });

  it("overwrites confidentiality, passes 201 through, never leaks the JWT", async () => {
    vi.stubEnv("ONECLICK_JWT", "secret-jwt");
    const f = vi.fn(async () => new Response(JSON.stringify({ quote: { depositAddress: "x" } }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    const res = await quotePost(req(validBody));
    expect(res.status).toBe(201);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.confidentiality).toBe("basic");
    expect(JSON.stringify(await res.json())).not.toContain("secret-jwt");
  });

  it("rejects invalid body with 400 before any upstream call", async () => {
    vi.stubEnv("ONECLICK_JWT", "secret-jwt");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await quotePost(req({ swapType: "EXACT_INPUT" }));
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("unconfigured server guard", () => {
  function unconfigured() {
    vi.stubEnv("ONECLICK_JWT", "");
    vi.stubEnv("QUIETPAY_ALLOW_PUBLIC_FALLBACK", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    return f;
  }
  async function expectGuarded(res: Response, f: ReturnType<typeof vi.fn>) {
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Server is not configured" });
    expect(f).not.toHaveBeenCalled();
  }
  it("/api/tokens", async () => {
    const f = unconfigured();
    await expectGuarded(await tokensGet(new Request("http://localhost/api/tokens")), f);
  });
  it("/api/status", async () => {
    const f = unconfigured();
    await expectGuarded(await statusGet(new Request("http://localhost/api/status?depositAddress=abc")), f);
  });
  it("/api/deposit-submit", async () => {
    const f = unconfigured();
    const r = new Request("http://localhost/api/deposit-submit", { method: "POST", body: JSON.stringify({ txHash: "x" }) });
    await expectGuarded(await submitPost(r), f);
  });
});
