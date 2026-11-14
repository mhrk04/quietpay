// Takes the redesign screenshots against a running `next start` (default http://localhost:3500).
// All /api calls are mocked, so no real quote is requested. Run: npx tsx scripts/redesign-shots.ts
import { chromium, type Route } from "@playwright/test";
import { buildPayLink, buildStatusLink, encodeInvoice } from "../lib/link-codec";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3500";
const OUT = process.env.SHOT_OUT ?? "../.specship/artifacts/screenshots";
const ACCOUNT = "mhrk7676.near";
const EVM = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const tokens = [
  ["eth", "USDC"], ["eth", "USDT"], ["eth", "ETH"], ["base", "USDC"], ["sol", "USDC"], ["sol", "SOL"],
  ["btc", "BTC"], ["arb", "USDC"], ["near", "USDC"], ["near", "wNEAR"],
].map(([blockchain, symbol], i) => ({ assetId: `asset-${i}`, decimals: 6, blockchain, symbol, price: 1 }));

const inv = { amount: "25", account: ACCOUNT, description: "Logo design deposit", createdAt: 1_700_000_000_000 };
const deposit = "0x" + "ab".repeat(20);

function payment(n: number, amount: string, description: string, createdAt: string, blockchain: string, symbol: string) {
  return {
    depositAddress: `0x${String(n).repeat(40)}`, depositMemo: null, amountIn: String(Math.round(Number(amount) * 1_004_000)),
    minAmountIn: "1", origin: { symbol, blockchain, decimals: 6, assetId: "x" }, deadline: "2030-01-01T00:30:00.000Z", createdAt,
    invoiceCode: encodeInvoice({ amount, account: ACCOUNT, description, createdAt: 1_700_000_000_000 + n }), description, amount,
  };
}
const payments = [
  payment(1, "25", "Logo design deposit", "2026-05-04T10:12:00.000Z", "eth", "USDC"),
  payment(2, "120", "Website hosting, 6 months", "2026-05-03T16:40:00.000Z", "sol", "SOL"),
  payment(3, "10.5", "QA coffee", "2026-05-03T09:05:00.000Z", "base", "USDC"),
  payment(4, "300", "Brand guidelines", "2026-05-02T14:30:00.000Z", "btc", "BTC"),
  payment(5, "45", "Sticker pack", "2026-05-01T08:20:00.000Z", "eth", "USDT"),
  payment(6, "80", "Consulting call", "2026-04-30T11:00:00.000Z", "arb", "USDC"),
];
const statuses = ["SUCCESS", "PROCESSING", "SUCCESS", "PENDING_DEPOSIT", "REFUNDED", "SUCCESS"];

async function main() {
  const browser = await chromium.launch();
  for (const [label, width, height] of [["360", 360, 740], ["1280", 1280, 800]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: null }));
    await page.route("**/api/config", (r) => json(r, 200, { mode: "confidential" }));
    await page.route("**/api/tokens", (r) => json(r, 200, tokens));
    await page.route("**/api/invoice**", (r) => json(r, 200, { deposits: [] }));
    await page.route("**/api/quote", (r) => {
      const body = r.request().postDataJSON() as { deadline: string };
      return json(r, 201, {
        quote: { amountIn: "25100400", minAmountIn: "24850000", amountOut: "25000000", timeEstimate: 45 },
        quoteRequest: { deadline: body.deadline },
      });
    });
    const shot = async (name: string, fullPage = true) => {
      if (fullPage) await page.evaluate(() => window.scrollTo(0, 0)); // sticky headers misrender in fullPage shots when scrolled
      return page.screenshot({ path: `${OUT}/redesign-${name}-${label}.png`, fullPage });
    };

    // Create: empty, then with a link and a saved invoice.
    await page.goto(`${BASE}/`);
    await page.waitForSelector("text=Connect wallet");
    await shot("home");
    await page.getByLabel("Amount (USDC)").fill("25");
    await page.getByLabel("Merchant NEAR account").fill(ACCOUNT);
    await page.getByLabel(/Description/).fill("Logo design deposit");
    await page.getByRole("button", { name: "Create payment link" }).click();
    await page.waitForSelector('img[alt="QR code for the payment link"]');
    await shot("home-link");

    // Pay: choose token, quote state.
    await page.goto(buildPayLink(BASE, inv));
    await page.waitForSelector('[role="option"]');
    await shot("pay-select");
    await page.getByRole("option", { name: /USDC\s*Ethereum/ }).click();
    await page.getByLabel(/for refunds/).fill(EVM);
    await page.getByRole("button", { name: "See what I will pay" }).click();
    await page.waitForSelector("text=Your quote");
    await shot("pay-quote");
    if (label === "360") {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/redesign-pay-quote-360-viewport.png` });
      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/redesign-pay-quote-360-scrolled.png` });
    }

    // Status: success receipt.
    await page.route("**/api/status**", (r) =>
      json(r, 200, {
        status: "SUCCESS", updatedAt: "2026-05-04T10:20:00Z",
        swapDetails: { destinationChainTxHashes: [{ hash: "9xAbCdEf1234567890", explorerUrl: "https://nearblocks.io/txns/9xAbCdEf1234567890" }] },
      }),
    );
    await page.goto(buildStatusLink(BASE, deposit, inv));
    await page.waitForSelector("text=Receipt");
    await shot("status");

    // Payments: signed out, then signed in.
    await page.goto(`${BASE}/payments`);
    await page.waitForSelector("text=Sign in to see your payments");
    await shot("payments-signed-out");
    await page.unroute("**/api/auth/me");
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: ACCOUNT }));
    await page.route("**/api/my-payments", (r) => json(r, 200, { accountId: ACCOUNT, payments }));
    await page.unroute("**/api/status**");
    await page.route("**/api/status**", (r) => {
      const addr = new URL(r.request().url()).searchParams.get("depositAddress") ?? "";
      const i = payments.findIndex((p) => p.depositAddress === addr);
      return json(r, 200, { status: statuses[i] ?? "PENDING_DEPOSIT" });
    });
    await page.goto(`${BASE}/payments`);
    await page.waitForSelector("text=Sticker pack");
    await page.waitForFunction(() => document.querySelectorAll(".skeleton--badge").length === 0);
    await shot("payments");
    await ctx.close();
  }
  await browser.close();
}
main();
