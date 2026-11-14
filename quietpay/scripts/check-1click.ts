// Real-API check for the 1Click service. Usage:
//   npx tsx scripts/check-1click.ts <depositAddress>
// Sends only a dry:true quote and read-only GETs. Never creates a Live_Quote.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://1click.chaindefuser.com";
const TIMEOUT_MS = 10_000;
// Must be an existing NEAR account: a nonexistent one gives 400 "Internal server error".
const PLACEHOLDER_RECIPIENT = "near";
const PLACEHOLDER_REFUND = "0x0000000000000000000000000000000000000001";

function loadDotEnv(): void {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadDotEnv();
const JWT = (process.env.ONECLICK_JWT ?? "").trim();

function scrub(s: string): string {
  return JWT ? s.split(JWT).join("[JWT]") : s;
}

type Call = { name: string; status: number | null; ok: boolean; body: unknown };

async function call(name: string, path: string, init: RequestInit = {}): Promise<Call> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body) headers["Content-Type"] = "application/json";
  if (JWT) headers.Authorization = `Bearer ${JWT}`;
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    return { name, status: res.status, ok: res.status >= 200 && res.status < 300, body };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { name, status: null, ok: false, body: `request failed: ${msg}` };
  }
}

function print(c: Call): void {
  const body = typeof c.body === "string" ? c.body : JSON.stringify(c.body, null, 2);
  console.log(`\n=== ${c.name} ===\nHTTP ${c.status ?? "no response"}\n${scrub(body)}`);
}

type Token = { assetId: string; symbol: string; blockchain: string; decimals: number };

async function main(): Promise<number> {
  const depositAddress = process.argv[2];
  if (!depositAddress) {
    console.error("Usage: npx tsx scripts/check-1click.ts <depositAddress>");
    return 2;
  }
  console.log(`JWT: ${JWT ? "set (confidentiality basic)" : "not set (confidentiality omitted)"}`);

  const tokens = await call("GET /v0/tokens", "/v0/tokens");
  const list = Array.isArray(tokens.body) ? (tokens.body as Token[]) : [];
  console.log(`\n=== ${tokens.name} ===\nHTTP ${tokens.status ?? "no response"}\n${list.length} tokens`);
  if (!tokens.ok || list.length === 0) {
    print(tokens);
    return 1;
  }

  const dest = list.find((t) => t.symbol === "USDC" && t.blockchain === "near");
  const origin =
    list.find((t) => t.symbol === "USDC" && t.blockchain === "eth") ??
    list.find((t) => t.symbol === "USDC" && t.blockchain === "arb");
  if (!dest || !origin) {
    console.error("Could not find USDC on NEAR and an EVM chain in the token list");
    return 1;
  }
  console.log(`origin: ${origin.blockchain} ${origin.assetId}\ndestination: ${dest.blockchain} ${dest.assetId}`);

  const amount = (10n ** BigInt(dest.decimals)).toString(); // 1 USDC
  const quoteBody: Record<string, unknown> = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: dest.assetId,
    amount,
    refundTo: PLACEHOLDER_REFUND,
    refundType: "ORIGIN_CHAIN",
    recipient: PLACEHOLDER_RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  if (JWT) quoteBody.confidentiality = "basic";

  const quote = await call("POST /v0/quote (dry)", "/v0/quote", {
    method: "POST",
    body: JSON.stringify(quoteBody),
  });
  print(quote);
  if (quote.ok && quote.body && typeof quote.body === "object") {
    const q = (quote.body as { quote?: Record<string, unknown> }).quote ?? {};
    for (const f of ["timeEstimate", "deadline", "depositMemo", "depositAddress", "minAmountIn", "maxAmountIn"]) {
      console.log(`quote.${f}: ${f in q ? `present (${JSON.stringify(q[f])})` : "absent"}`);
    }
  }

  const status = await call(
    "GET /v0/status",
    `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  print(status);

  const failed = [quote, status].filter((c) => !c.ok);
  if (failed.length === 0) return 0;
  for (const c of failed) console.error(`FAILED: ${c.name} -> HTTP ${c.status ?? "no response"}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(scrub(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  },
);
