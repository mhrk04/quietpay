import { describe, expect, it, vi, afterEach } from "vitest";
import { generateKeyPairSync, sign as edSign, createHash, randomBytes } from "node:crypto";
import { base58Decode, base58Encode } from "@/lib/server/base58";
import { buildNep413Hash, verifyNep413 } from "@/lib/server/nep413";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  getSessionSecret,
  readCookie,
  readSession,
  setCookie,
  signToken,
  verifyToken,
} from "@/lib/server/session";
import { checkAccessKey, RpcError } from "@/lib/server/near-rpc";
import { GET as challengeGet } from "@/app/api/auth/challenge/route";
import { POST as verifyPost } from "@/app/api/auth/verify/route";
import { GET as meGet } from "@/app/api/auth/me/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as myPaymentsGet } from "@/app/api/my-payments/route";
import { createMemoryStore, setPaymentsStoreForTests, accountKeyFor, type DepositRecord } from "@/lib/server/payments-store";

const SECRET = "s".repeat(40);

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { privateKey, publicKey: `ed25519:${base58Encode(raw)}` };
}
function signPayload(privateKey: ReturnType<typeof keypair>["privateKey"], message: string, recipient: string, nonce: Buffer) {
  return edSign(null, buildNep413Hash({ message, recipient, nonce }), privateKey).toString("base64");
}

describe("base58", () => {
  it("round trips and handles leading zeros", () => {
    const b = Buffer.from([0, 0, 1, 2, 3, 255]);
    expect(Buffer.from(base58Decode(base58Encode(b)) ?? [])).toEqual(b);
    expect(base58Decode("0OIl")).toBeNull();
  });
});

describe("signed tokens", () => {
  const now = 1_000_000;
  it("accepts a valid token", () => {
    const t = signToken({ a: 1, exp: now + 1000 }, SECRET);
    expect(verifyToken<{ a: number }>(t, SECRET, now)?.a).toBe(1);
  });
  it("rejects tampered payload, tampered mac, wrong secret, expiry, junk", () => {
    const t = signToken({ a: 1, exp: now + 1000 }, SECRET);
    const [p, m] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ a: 2, exp: now + 1000 })).toString("base64url");
    expect(verifyToken(`${forged}.${m}`, SECRET, now)).toBeNull();
    expect(verifyToken(`${p}.${m[0] === "A" ? "B" : "A"}${m.slice(1)}`, SECRET, now)).toBeNull();
    expect(verifyToken(t, "x".repeat(40), now)).toBeNull();
    expect(verifyToken(t, SECRET, now + 1001)).toBeNull();
    expect(verifyToken("junk", SECRET, now)).toBeNull();
    expect(verifyToken("a.b.c", SECRET, now)).toBeNull();
    expect(verifyToken(`${p}.`, SECRET, now)).toBeNull();
  });
  it("secret must be at least 32 chars", () => {
    expect(getSessionSecret({ QUIETPAY_SESSION_SECRET: "short" })).toBeNull();
    expect(getSessionSecret({})).toBeNull();
    expect(getSessionSecret({ QUIETPAY_SESSION_SECRET: SECRET })).toBe(SECRET);
  });
  it("cookie helpers", () => {
    const c = setCookie("n", "v", { path: "/api/auth", maxAgeSeconds: 300, secure: true });
    expect(c).toBe("n=v; Path=/api/auth; Max-Age=300; HttpOnly; SameSite=Lax; Secure");
    expect(clearCookie("n", "/", false)).toContain("Max-Age=0");
    expect(readCookie("a=1; n=v; b=2", "n")).toBe("v");
    expect(readCookie("a=1", "n")).toBeNull();
    expect(readCookie(null, "n")).toBeNull();
  });
});

describe("NEP-413 verification", () => {
  const nonce = randomBytes(32);
  const message = "Sign in to QuietPay";
  const recipient = "quietpay.example";
  it("payload hash matches the spec layout", () => {
    const h = buildNep413Hash({ message: "hi", recipient: "myapp.com", nonce: Buffer.from(Array.from({ length: 32 }, (_, i) => i)) });
    const expected = Buffer.concat([
      Buffer.from([0x9d, 0x01, 0x00, 0x80]), // 2^31 + 413 little endian
      Buffer.from([2, 0, 0, 0]), Buffer.from("hi"),
      Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
      Buffer.from([9, 0, 0, 0]), Buffer.from("myapp.com"),
      Buffer.from([0]),
    ]);
    expect(h.equals(createHash("sha256").update(expected).digest())).toBe(true);
  });
  it("accepts a valid signature", () => {
    const k = keypair();
    const signature = signPayload(k.privateKey, message, recipient, nonce);
    expect(verifyNep413({ publicKey: k.publicKey, signature, message, recipient, nonce })).toBe(true);
  });
  it("rejects wrong message, recipient, nonce, key and bad encodings", () => {
    const k = keypair();
    const other = keypair();
    const signature = signPayload(k.privateKey, message, recipient, nonce);
    const base = { publicKey: k.publicKey, signature, message, recipient, nonce };
    expect(verifyNep413({ ...base, message: "Sign in to Evil" })).toBe(false);
    expect(verifyNep413({ ...base, recipient: "evil.example" })).toBe(false);
    expect(verifyNep413({ ...base, nonce: randomBytes(32) })).toBe(false);
    expect(verifyNep413({ ...base, publicKey: other.publicKey })).toBe(false);
    expect(verifyNep413({ ...base, signature: "not base64 !!" })).toBe(false);
    expect(verifyNep413({ ...base, signature: Buffer.alloc(10).toString("base64") })).toBe(false);
    expect(verifyNep413({ ...base, publicKey: "secp256k1:abc" })).toBe(false);
    expect(verifyNep413({ ...base, publicKey: "ed25519:0OIl" })).toBe(false);
  });
});

describe("checkAccessKey (mocked RPC)", () => {
  const rpc = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const run = (f: ReturnType<typeof rpc>) =>
    checkAccessKey("alice.near", "ed25519:abc", { url: "https://rpc.test", fetchImpl: f as unknown as typeof fetch });
  it("FullAccess", async () => {
    const f = rpc({ result: { nonce: 1, permission: "FullAccess" } });
    expect(await run(f)).toBe("full");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rpc.test");
    expect(JSON.parse(init.body as string).params).toEqual({
      request_type: "view_access_key",
      finality: "final",
      account_id: "alice.near",
      public_key: "ed25519:abc",
    });
  });
  it("FunctionCall is not full", async () => {
    expect(await run(rpc({ result: { nonce: 1, permission: { FunctionCall: { allowance: "1", receiver_id: "x", method_names: [] } } } }))).toBe("not-full");
  });
  it("missing key (result.error string, or UNKNOWN_ACCESS_KEY)", async () => {
    expect(await run(rpc({ result: { error: "access key ed25519:abc does not exist while viewing" } }))).toBe("missing");
    expect(await run(rpc({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCESS_KEY" } } }))).toBe("missing");
    expect(await run(rpc({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } }))).toBe("missing");
  });
  it("RPC errors throw RpcError", async () => {
    await expect(run(rpc({ error: { name: "INTERNAL_ERROR", cause: { name: "INTERNAL_ERROR" } } }))).rejects.toBeInstanceOf(RpcError);
    await expect(run(rpc({}, 500))).rejects.toBeInstanceOf(RpcError);
    await expect(run(rpc({ result: { nonsense: true } }))).rejects.toBeInstanceOf(RpcError);
    const boom = vi.fn(async () => {
      throw new Error("net");
    });
    await expect(run(boom as never)).rejects.toBeInstanceOf(RpcError);
  });
});

describe("auth routes", () => {
  const HOST = "pay.example.com";
  const url = (p: string) => `https://${HOST}${p}`;
  const ACCOUNT = "alice.near";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setPaymentsStoreForTests(null);
  });

  const cookiesFrom = (res: Response) =>
    res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));
  const header = (res: Response) => cookiesFrom(res).join("; ");

  async function challenge(host = HOST) {
    const res = await challengeGet(new Request(url("/api/auth/challenge"), { headers: { host } }));
    return { res, body: await res.json(), cookie: header(res) };
  }
  function verifyReq(body: unknown, cookie: string) {
    return new Request(url("/api/auth/verify"), {
      method: "POST",
      headers: { host: HOST, cookie },
      body: JSON.stringify(body),
    });
  }
  function stubRpc(permission: unknown | "missing" | "fail") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (permission === "fail") return new Response("nope", { status: 500 });
        if (permission === "missing") return new Response(JSON.stringify({ result: { error: "access key x does not exist while viewing" } }));
        return new Response(JSON.stringify({ result: { nonce: 1, permission } }));
      }),
    );
  }
  async function signedBody(k = keypair(), opts: { account?: string; message?: string; recipient?: string; nonce?: Buffer } = {}) {
    const { body, cookie } = await challenge();
    const nonce = opts.nonce ?? Buffer.from(body.nonce, "base64");
    const signature = signPayload(k.privateKey, opts.message ?? body.message, opts.recipient ?? body.recipient, nonce);
    return { cookie, body: { accountId: opts.account ?? ACCOUNT, publicKey: k.publicKey, signature }, challenge: body };
  }

  it("503 when the secret is missing", async () => {
    vi.stubEnv("QUIETPAY_SESSION_SECRET", "");
    for (const res of [
      await challengeGet(new Request(url("/api/auth/challenge"))),
      await verifyPost(verifyReq({}, "")),
      await meGet(new Request(url("/api/auth/me"))),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: "Sign-in is not set up" });
    }
  });

  describe("with secret", () => {
    const setup = () => {
      vi.stubEnv("QUIETPAY_SESSION_SECRET", SECRET);
      vi.stubEnv("QUIETPAY_AUTH_RECIPIENT", "");
    };

    it("challenge: random nonce, message, host recipient, httpOnly cookie", async () => {
      setup();
      const a = await challenge();
      const b = await challenge();
      expect(a.res.status).toBe(200);
      expect(a.body.message).toBe("Sign in to QuietPay");
      expect(a.body.recipient).toBe(HOST);
      expect(Buffer.from(a.body.nonce, "base64")).toHaveLength(32);
      expect(a.body.nonce).not.toBe(b.body.nonce);
      expect(a.res.headers.get("cache-control")).toBe("no-store");
      const sc = a.res.headers.getSetCookie()[0];
      expect(sc).toMatch(new RegExp(`^${CHALLENGE_COOKIE}=`));
      expect(sc).toMatch(/HttpOnly/);
      expect(sc).toMatch(/SameSite=Lax/);
      expect(sc).toMatch(/Path=\/api\/auth/);
      const tok = verifyToken<{ nonce: string; recipient: string; exp: number }>(readCookie(a.cookie, CHALLENGE_COOKIE)!, SECRET);
      expect(tok?.nonce).toBe(a.body.nonce);
      expect(tok!.exp - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    });

    it("challenge: recipient from env when set", async () => {
      setup();
      vi.stubEnv("QUIETPAY_AUTH_RECIPIENT", "quietpay.app");
      expect((await challenge()).body.recipient).toBe("quietpay.app");
    });

    it("verify: success sets session, clears challenge", async () => {
      setup();
      stubRpc("FullAccess");
      const { cookie, body } = await signedBody();
      const res = await verifyPost(verifyReq(body, cookie));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accountId: ACCOUNT });
      const sets = res.headers.getSetCookie();
      const sess = sets.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
      expect(sess).toMatch(/HttpOnly/);
      expect(sess).toMatch(/SameSite=Lax/);
      expect(sess).toMatch(/Path=\//);
      expect(sess).toMatch(/Max-Age=28800/);
      expect(sets.find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`))).toMatch(/Max-Age=0/);
      const me = await meGet(new Request(url("/api/auth/me"), { headers: { cookie: header(res) } }));
      expect(await me.json()).toEqual({ accountId: ACCOUNT });
    });

    it("verify: rejects without cookie, tampered cookie, expired cookie", async () => {
      setup();
      stubRpc("FullAccess");
      const { cookie, body } = await signedBody();
      expect((await verifyPost(verifyReq(body, ""))).status).toBe(400);
      const at = cookie.indexOf("=") + 6;
      const tampered = `${cookie.slice(0, at)}${cookie[at] === "A" ? "B" : "A"}${cookie.slice(at + 1)}`;
      expect((await verifyPost(verifyReq(body, tampered))).status).toBe(400);
      const expired = `${CHALLENGE_COOKIE}=${signToken({ nonce: "x", recipient: HOST, message: "Sign in to QuietPay", exp: Date.now() - 1 }, SECRET)}`;
      expect((await verifyPost(verifyReq(body, expired))).status).toBe(400);
    });

    it("verify: rejects wrong message, recipient, nonce (signature over other values)", async () => {
      setup();
      stubRpc("FullAccess");
      for (const opts of [{ message: "Sign in to Evil" }, { recipient: "evil.example" }, { nonce: randomBytes(32) }]) {
        const { cookie, body } = await signedBody(keypair(), opts);
        const res = await verifyPost(verifyReq(body, cookie));
        expect(res.status).toBe(401);
        expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0"))).toBe(false);
      }
    });

    it("verify: ignores message/recipient/nonce sent by the client", async () => {
      setup();
      stubRpc("FullAccess");
      const k = keypair();
      const nonce = randomBytes(32);
      const signature = signPayload(k.privateKey, "Sign in to Evil", "evil.example", nonce);
      const { cookie } = await signedBody(k);
      const res = await verifyPost(
        verifyReq({ accountId: ACCOUNT, publicKey: k.publicKey, signature, message: "Sign in to Evil", recipient: "evil.example", nonce: nonce.toString("base64") }, cookie),
      );
      expect(res.status).toBe(401);
    });

    it("verify: invalid account id and bad body", async () => {
      setup();
      stubRpc("FullAccess");
      const { cookie, body } = await signedBody(keypair(), { account: "Not Valid!" });
      expect((await verifyPost(verifyReq(body, cookie))).status).toBe(400);
      expect((await verifyPost(verifyReq({ accountId: ACCOUNT }, cookie))).status).toBe(400);
      expect((await verifyPost(verifyReq("x", cookie))).status).toBe(400);
    });

    it("verify: FunctionCall key and missing key rejected, RPC error is 502", async () => {
      setup();
      const fc = { FunctionCall: { allowance: "1", receiver_id: "x", method_names: [] } };
      stubRpc(fc);
      let s = await signedBody();
      let res = await verifyPost(verifyReq(s.body, s.cookie));
      expect(res.status).toBe(401);
      expect((await res.json()).message).toMatch(/full-access/i);
      stubRpc("missing");
      s = await signedBody();
      expect((await verifyPost(verifyReq(s.body, s.cookie))).status).toBe(401);
      stubRpc("fail");
      s = await signedBody();
      res = await verifyPost(verifyReq(s.body, s.cookie));
      expect(res.status).toBe(502);
      expect(typeof (await res.json()).message).toBe("string");
    });

    it("verify: does not call the RPC when the signature is invalid", async () => {
      setup();
      stubRpc("FullAccess");
      const f = globalThis.fetch as ReturnType<typeof vi.fn>;
      const { cookie, body } = await signedBody(keypair(), { message: "other" });
      await verifyPost(verifyReq(body, cookie));
      expect(f).not.toHaveBeenCalled();
    });

    it("me: 200 with a null account without or with a bad/expired session (no-store); logout clears", async () => {
      setup();
      const old = signToken({ accountId: ACCOUNT, exp: Date.now() - 1 }, SECRET);
      for (const headers of [undefined, { cookie: `${SESSION_COOKIE}=bad` }, { cookie: `${SESSION_COOKIE}=${old}` }]) {
        const res = await meGet(new Request(url("/api/auth/me"), { headers }));
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ accountId: null });
      }
      const out = await logoutPost(new Request(url("/api/auth/logout"), { method: "POST" }));
      expect(out.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=; .*Max-Age=0`));
    });

    it("readSession reads the account", () => {
      setup();
      const t = signToken({ accountId: ACCOUNT, exp: Date.now() + 1000 }, SECRET);
      expect(readSession(new Request(url("/"), { headers: { cookie: `${SESSION_COOKIE}=${t}` } }))?.accountId).toBe(ACCOUNT);
    });
  });

  describe("/api/my-payments", () => {
    const dep = (address: string, createdAt: string): DepositRecord & { invoiceCode: string; description: string; amount: string } => ({
      depositAddress: address,
      depositMemo: null,
      amountIn: "1010224",
      minAmountIn: "1000121",
      origin: { symbol: "USDC", blockchain: "eth", decimals: 6, assetId: "nep141:x" },
      deadline: "2030-01-01T00:30:00.000Z",
      createdAt,
      invoiceCode: "code",
      description: "Coffee",
      amount: "1",
    });
    it("401 without a session, 401 with a bad one", async () => {
      vi.stubEnv("QUIETPAY_SESSION_SECRET", SECRET);
      const a = await myPaymentsGet(new Request(url("/api/my-payments")));
      expect(a.status).toBe(401);
      const b = await myPaymentsGet(new Request(url("/api/my-payments"), { headers: { cookie: `${SESSION_COOKIE}=x.y` } }));
      expect(b.status).toBe(401);
    });
    it("lists only the session account's records, newest first, no-store; ignores an account parameter", async () => {
      vi.stubEnv("QUIETPAY_SESSION_SECRET", SECRET);
      const store = createMemoryStore();
      setPaymentsStoreForTests(store);
      await store.recordForAccount(accountKeyFor(ACCOUNT), dep("a", "2030-01-01T00:00:00.000Z"));
      await store.recordForAccount(accountKeyFor(ACCOUNT), dep("b", "2030-01-02T00:00:00.000Z"));
      await store.recordForAccount(accountKeyFor("bob.near"), dep("c", "2030-01-03T00:00:00.000Z"));
      const t = signToken({ accountId: ACCOUNT, exp: Date.now() + 1000 }, SECRET);
      const res = await myPaymentsGet(
        new Request(url("/api/my-payments?account=bob.near&accountId=bob.near"), { headers: { cookie: `${SESSION_COOKIE}=${t}` } }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.payments.map((p: { depositAddress: string }) => p.depositAddress)).toEqual(["b", "a"]);
      expect(body.payments[0].description).toBe("Coffee");
      expect(body.accountId).toBe(ACCOUNT);
    });
  });
});
