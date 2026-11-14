import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/server", () => ({ connection: async () => {} }));
import { RateLimiter, clientIp } from "@/lib/server/rate-limit";
import { guardRequest, readJsonCapped, MAX_BODY_BYTES } from "@/lib/server/guard";
import { quoteErrorMessage } from "@/lib/quote-errors";
import nextConfig from "@/next.config";
import { POST as quotePost } from "@/app/api/quote/route";
import { POST as submitPost } from "@/app/api/deposit-submit/route";
import { GET as statusGet } from "@/app/api/status/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RateLimiter", () => {
  it("allows up to the limit then blocks with retryAfter, and resets after the window", () => {
    let t = 0;
    const rl = new RateLimiter({ now: () => t });
    for (let i = 0; i < 3; i++) expect(rl.check("k", 3, 60_000).allowed).toBe(true);
    const blocked = rl.check("k", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    t = 30_000;
    expect(rl.check("k", 3, 60_000).retryAfterSeconds).toBe(30);
    t = 60_001;
    expect(rl.check("k", 3, 60_000).allowed).toBe(true);
  });
  it("keeps separate counters per key and caps map size", () => {
    let t = 0;
    const rl = new RateLimiter({ now: () => t, maxKeys: 100 });
    for (let i = 0; i < 500; i++) rl.check(`ip${i}`, 1, 60_000);
    expect(rl.size()).toBeLessThanOrEqual(100);
    t = 120_000;
    rl.check("fresh", 1, 60_000);
    expect(rl.size()).toBe(1); // expired entries evicted
  });
});

describe("clientIp", () => {
  it("prefers first x-forwarded-for entry, then x-real-ip, then unknown", () => {
    expect(clientIp(new Request("http://a/", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))).toBe("1.1.1.1");
    expect(clientIp(new Request("http://a/", { headers: { "x-real-ip": "3.3.3.3" } }))).toBe("3.3.3.3");
    expect(clientIp(new Request("http://a/"))).toBe("unknown");
  });
});

describe("guardRequest", () => {
  const mk = (headers: Record<string, string> = {}) =>
    new Request("http://app.example/api/status", { headers });
  it("403 for cross-site Origin, allows same host, allows no Origin", async () => {
    const bad = guardRequest(mk({ origin: "https://evil.com", host: "app.example" }), "other", new RateLimiter());
    expect(bad?.status).toBe(403);
    expect(await bad?.json()).toEqual({ message: "Forbidden" });
    expect(guardRequest(mk({ origin: "https://app.example", host: "app.example" }), "other", new RateLimiter())).toBeNull();
    expect(guardRequest(mk(), "other", new RateLimiter())).toBeNull();
  });
  it("uses x-forwarded-host when present", () => {
    const r = mk({ origin: "https://public.example", host: "internal", "x-forwarded-host": "public.example" });
    expect(guardRequest(r, "other", new RateLimiter())).toBeNull();
  });
  it("429 with Retry-After once the quote limit (30) is exceeded; other kind allows 120", async () => {
    const rl = new RateLimiter();
    const r = () => mk({ "x-forwarded-for": "9.9.9.9" });
    for (let i = 0; i < 30; i++) expect(guardRequest(r(), "quote", rl)).toBeNull();
    const res = guardRequest(r(), "quote", rl);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res?.json()).message).toBe("Too many requests. Please wait a moment and try again.");
    for (let i = 0; i < 120; i++) expect(guardRequest(r(), "other", rl)).toBeNull();
    expect(guardRequest(r(), "other", rl)?.status).toBe(429);
  });
});

describe("readJsonCapped", () => {
  it("413 on large content-length and on actual large body without content-length", async () => {
    const big = JSON.stringify({ x: "a".repeat(MAX_BODY_BYTES + 1) });
    const withLen = new Request("http://a/", { method: "POST", body: big, headers: { "content-length": String(big.length) } });
    const r1 = await readJsonCapped(withLen);
    expect(r1.ok === false && r1.response.status).toBe(413);
    const lying = new Request("http://a/", { method: "POST", body: big, headers: { "content-length": "10" } });
    const r2 = await readJsonCapped(lying);
    expect(r2.ok === false && r2.response.status).toBe(413);
  });
  it("parses small JSON and 400s invalid JSON", async () => {
    const ok = await readJsonCapped(new Request("http://a/", { method: "POST", body: '{"a":1}' }));
    expect(ok).toEqual({ ok: true, body: { a: 1 } });
    const bad = await readJsonCapped(new Request("http://a/", { method: "POST", body: "{" }));
    expect(bad.ok === false && bad.response.status).toBe(400);
  });
});

describe("routes apply the guard", () => {
  it("quote and deposit-submit return 413 for oversized bodies, no upstream call", async () => {
    vi.stubEnv("ONECLICK_JWT", "jwt");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const big = JSON.stringify({ x: "a".repeat(MAX_BODY_BYTES + 1) });
    for (const post of [quotePost, submitPost]) {
      const res = await post(new Request("http://localhost/api/x", { method: "POST", body: big }));
      expect(res.status).toBe(413);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("routes return 403 for cross-site Origin", async () => {
    vi.stubEnv("ONECLICK_JWT", "jwt");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await statusGet(
      new Request("http://localhost/api/status?depositAddress=x", { headers: { origin: "https://evil.com" } }),
    );
    expect(res.status).toBe(403);
    const q = await quotePost(
      new Request("http://localhost/api/quote", { method: "POST", body: "{}", headers: { origin: "https://evil.com" } }),
    );
    expect(q.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("quoteErrorMessage", () => {
  it("maps statuses to fixed messages", () => {
    expect(quoteErrorMessage(400)).toBe("We could not prepare this payment. Check the details and try again.");
    expect(quoteErrorMessage(401)).toBe("Private payments are unavailable right now.");
    expect(quoteErrorMessage(413)).toMatch(/too many requests/i);
    expect(quoteErrorMessage(429)).toMatch(/too many requests/i);
    expect(quoteErrorMessage(500)).toBe("The payment service is not responding. Try again in a moment.");
    expect(quoteErrorMessage(504)).toBe("The payment service is not responding. Try again in a moment.");
    expect(quoteErrorMessage("network")).toBe("Connection problem. Try again.");
    expect(quoteErrorMessage(404)).not.toMatch(/upstream|raw/);
  });
});

describe("security headers config", () => {
  it("sets the required headers for all routes", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/(.*)")!;
    const strictRule = rules.find((r) => r.source === "/((?!payments$).*)")!;
    const payments = rules.find((r) => r.source === "/payments")!;
    const h = Object.fromEntries([...all.headers, ...strictRule.headers].map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(h["Content-Security-Policy"]).toContain("connect-src 'self';");
    expect(h["Content-Security-Policy"]).not.toContain("githubusercontent");
    const p = payments.headers.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(p).toContain("connect-src 'self' https://raw.githubusercontent.com");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).not.toMatch(/(connect|img|frame|script)-src[^;]*(\s\*|https:(\s|;|$))/);
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).toContain("img-src 'self' data:");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });
});
