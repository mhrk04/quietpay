import { afterEach, describe, expect, it, vi } from "vitest";
// connection() only works inside a Next request scope.
vi.mock("next/server", () => ({ connection: async () => {} }));
import { POST as quotePost } from "@/app/api/quote/route";
import { GET as tokensGet } from "@/app/api/tokens/route";
import { GET as statusGet } from "@/app/api/status/route";
import { POST as submitPost } from "@/app/api/deposit-submit/route";
import { GET as invoiceGet } from "@/app/api/invoice/route";
import { encodeInvoice } from "@/lib/link-codec";
import { createMemoryStore, invoiceKeyFor, setPaymentsStoreForTests } from "@/lib/server/payments-store";

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

describe("quote recording and /api/invoice", () => {
  const invoice = { amount: "1", account: "shop.near", description: "x", createdAt: 1700000000000 };
  const code = encodeInvoice(invoice);
  const ASSET = "nep141:eth-usdc.omft.near";
  const liveBody = {
    ...validBody,
    dry: false,
    originAsset: ASSET,
    amount: "1000000",
    recipient: "shop.near",
    refundTo: "0xrefund",
    depositAddress: "evil-client-address",
  };
  const upstreamQuote = {
    quote: { depositAddress: "0xdeposit", amountIn: "1010224", minAmountIn: "1000121", deadline: "2030-01-01T00:30:00Z" },
  };
  function setup(upstreamStatus = 201, upstreamBody: unknown = upstreamQuote) {
    vi.stubEnv("ONECLICK_JWT", "secret-jwt");
    const store = createMemoryStore();
    setPaymentsStoreForTests(store);
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v0/tokens")) {
        return new Response(JSON.stringify([{ assetId: ASSET, symbol: "USDC", blockchain: "eth", decimals: 6 }]), { status: 200 });
      }
      return new Response(JSON.stringify(upstreamBody), { status: upstreamStatus });
    });
    vi.stubGlobal("fetch", f);
    return store;
  }
  const post = (body: unknown, c: string | null = code) =>
    quotePost(
      new Request("http://localhost/api/quote", {
        method: "POST",
        headers: c ? { "x-quietpay-invoice": c } : {},
        body: JSON.stringify(body),
      }),
    );
  const key = invoiceKeyFor(code);
  afterEach(() => setPaymentsStoreForTests(null));

  it("records a matching live quote using the upstream deposit address, without refund data", async () => {
    const store = setup();
    expect((await post(liveBody)).status).toBe(201);
    const list = await store.list(key);
    expect(list).toHaveLength(1);
    expect(list[0].depositAddress).toBe("0xdeposit");
    expect(list[0].origin.symbol).toBe("USDC");
    expect(JSON.stringify(list)).not.toMatch(/refund|evil-client|secret-jwt/);
  });
  it("does not record dry quotes", async () => {
    const store = setup();
    await post({ ...liveBody, dry: true });
    expect(await store.list(key)).toEqual([]);
  });
  it("does not record on recipient or amount mismatch", async () => {
    const store = setup();
    await post({ ...liveBody, recipient: "other.near" });
    await post({ ...liveBody, amount: "2000000" });
    expect(await store.list(key)).toEqual([]);
  });
  it("does not record without a valid invoice header", async () => {
    const store = setup();
    await post(liveBody, null);
    await post(liveBody, "not-a-code");
    expect(await store.list(key)).toEqual([]);
  });
  it("does not record on upstream error or missing deposit address", async () => {
    let store = setup(400, { message: "bad" });
    expect((await post(liveBody)).status).toBe(400);
    expect(await store.list(key)).toEqual([]);
    store = setup(201, { quote: { amountIn: "1", minAmountIn: "1" } });
    await post(liveBody);
    expect(await store.list(key)).toEqual([]);
  });
  it("a failing store does not change the quote response", async () => {
    setup();
    setPaymentsStoreForTests({
      record: async () => {
        throw new Error("boom");
      },
      list: async () => [],
    });
    const res = await post(liveBody);
    expect(res.status).toBe(201);
    expect((await res.json()).quote.depositAddress).toBe("0xdeposit");
  });

  it("GET /api/invoice: 400 for invalid code", async () => {
    const res = await invoiceGet(new Request("http://localhost/api/invoice?i=garbage"));
    expect(res.status).toBe(400);
    expect((await invoiceGet(new Request("http://localhost/api/invoice"))).status).toBe(400);
  });
  it("GET /api/invoice: returns deposits, no-store", async () => {
    const store = setup();
    await post(liveBody);
    const res = await invoiceGet(new Request(`http://localhost/api/invoice?i=${encodeURIComponent(code)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.deposits).toHaveLength(1);
    expect(body.deposits[0].depositAddress).toBe("0xdeposit");
    expect(await store.list(key)).toHaveLength(1);
  });
  it("GET /api/invoice returns an empty list when the store is not configured", async () => {
    setPaymentsStoreForTests(null);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = await invoiceGet(new Request(`http://localhost/api/invoice?i=${encodeURIComponent(code)}`));
    expect(await res.json()).toEqual({ deposits: [] });
  });
});
