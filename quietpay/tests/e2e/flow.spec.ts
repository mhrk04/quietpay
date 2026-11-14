import { test, expect, type Page, type Route } from "@playwright/test";
import { buildStatusLink } from "../../lib/link-codec";

const ORIGIN = "http://localhost:3100";
const EVM = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const DEPOSIT = "0x1111111111111111111111111111111111111111".replace(/1/g, "a");
const INVOICE = { amount: "1", account: "near", description: "Coffee order", createdAt: 1700000000000 };

const TOKENS = [
  {
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    decimals: 6,
    blockchain: "eth",
    symbol: "USDC",
    price: 1,
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  {
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    decimals: 6,
    blockchain: "near",
    symbol: "USDC",
    price: 1,
    contractAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  },
];

type Api = {
  unmocked: string[];
  quotes: Array<Record<string, unknown>>;
  apiCalls: string[];
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Blocks everything API-related by default; tests then add specific mocks (later routes win). */
async function guard(page: Page): Promise<Api> {
  const api: Api = { unmocked: [], quotes: [], apiCalls: [] };
  await page.route("**/api/**", (route) => {
    api.unmocked.push(route.request().url());
    return route.abort();
  });
  await page.route(/1click\.chaindefuser\.com/, (route) => {
    api.unmocked.push(route.request().url());
    return route.abort();
  });
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/")) api.apiCalls.push(p);
  });
  return api;
}

async function mockSetup(page: Page, api: Api, mode: "public" | "confidential" = "public") {
  await page.route("**/api/config", (r) => json(r, 200, { mode }));
  await page.route("**/api/tokens", (r) => json(r, 200, TOKENS));
  void api;
}

async function noOverflow(page: Page) {
  const ok = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
  expect(ok).toBe(true);
}

function liveBody(amountIn = "1010224", deadline = new Date(Date.now() + 25 * 60_000).toISOString()) {
  return {
    quote: {
      amountIn,
      minAmountIn: "1000121",
      amountOut: "1000000",
      timeEstimate: 45,
      depositAddress: DEPOSIT,
      deadline,
    },
    quoteRequest: { deadline },
  };
}

async function mockQuote(page: Page, api: Api, live: () => unknown) {
  await page.route("**/api/quote", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    api.quotes.push(body);
    if (body.dry) {
      return json(route, 201, {
        quote: { amountIn: "1010224", minAmountIn: "1000121", amountOut: "1000000", timeEstimate: 45 },
        quoteRequest: { deadline: body.deadline },
      });
    }
    const r = live();
    if (typeof r === "number") return json(route, r, { message: "Unauthorized" });
    return json(route, 201, r);
  });
}

const payUrl = () => buildStatusLink(ORIGIN, "x", INVOICE).replace(/\/status\?a=x&/, "/pay?");
const statusUrl = (extra?: { refund?: string; deadline?: number }) =>
  buildStatusLink(ORIGIN, DEPOSIT, INVOICE, extra);

async function toDry(page: Page) {
  await page.goto(payUrl());
  await page.getByRole("option", { name: /USDC\s*eth/i }).click();
  await page.getByLabel("Refund address").fill(EVM);
  await page.getByRole("button", { name: "See what I will pay" }).click();
  await expect(page.getByText("Your quote")).toBeVisible();
}

test.afterEach(async ({}, info) => {
  // Attached by tests that use guard(); fail loudly if anything leaked.
  const leaked = (info as unknown as { api?: Api }).api?.unmocked ?? [];
  expect(leaked).toEqual([]);
});

function track(info: unknown, api: Api) {
  (info as { api?: Api }).api = api;
}

test("create -> pay -> dry quote -> confirm -> deposit view -> status success", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);

  // 1. Create page
  await page.goto("/");
  await noOverflow(page);
  await page.getByLabel("Amount (USDC)").fill("1");
  await page.getByLabel("Merchant NEAR account").fill("near");
  await page.getByLabel(/Description/).fill("Coffee order");
  await page.getByRole("button", { name: "Create payment link" }).click();
  const result = page.getByRole("region", { name: "Your payment link" });
  await expect(result).toBeVisible();
  await expect(result.getByAltText("QR code for the payment link")).toBeVisible();
  const wa = result.getByRole("link", { name: "Share on WhatsApp" });
  await expect(wa).toBeVisible();
  expect(await wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\//);
  const link = (await result.locator(".create-break").innerText()).trim();
  expect(link).toContain("/pay?i=");
  await noOverflow(page);

  // 2. Pay page
  await mockSetup(page, api);
  await mockQuote(page, api, () => liveBody());
  await page.goto(link);
  await expect(page.getByText("Standard payment (not private)")).toBeVisible();
  await page.getByRole("option", { name: /USDC\s*eth/i }).click();
  await page.getByLabel("Refund address").fill(EVM);
  await page.getByRole("button", { name: "See what I will pay" }).click();
  await expect(page.getByText("Your quote")).toBeVisible();
  await expect(page.getByText("1.010224 USDC")).toBeVisible();
  expect(api.quotes).toHaveLength(1);
  expect(api.quotes[0]).toMatchObject({ dry: true, swapType: "EXACT_OUTPUT", refundTo: EVM, amount: "1000000" });
  await expect(page.getByText("Payment address", { exact: true })).toHaveCount(0);
  expect(api.quotes.filter((q) => q.dry === false)).toHaveLength(0);
  await noOverflow(page);

  // 3. Confirm
  await page.getByRole("button", { name: "Confirm and get payment address" }).click();
  const dep = page.getByRole("region", { name: "Payment instructions" });
  await expect(dep.getByText(DEPOSIT)).toBeVisible();
  expect(api.quotes.filter((q) => q.dry === false)).toHaveLength(1);
  await expect(dep.getByAltText("QR code of the payment address")).toBeVisible();
  await expect(dep.getByRole("button", { name: "Copy address" })).toBeVisible();
  await expect(dep.getByRole("button", { name: "Copy amount" })).toBeVisible();
  await expect(dep.getByLabel("Time left to pay")).toHaveText(/^\d+:\d{2}$/);
  await noOverflow(page);

  // 5. Status page via the Track link
  const track1 = dep.getByRole("link", { name: "Track this payment" });
  const href = await track1.getAttribute("href");
  expect(href).toContain("/status?a=" + DEPOSIT);
  let n = 0;
  const seq = ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"];
  await page.route("**/api/status**", (route) => {
    api.apiCalls.push("status-mock");
    const status = seq[Math.min(n++, seq.length - 1)];
    const body: Record<string, unknown> = { status, updatedAt: "2025-01-02T03:04:05Z", swapDetails: {} };
    if (status === "SUCCESS") {
      body.swapDetails = {
        destinationChainTxHashes: [{ hash: "9xAbCdEf1234567890", explorerUrl: "https://nearblocks.io/txns/9xAbCdEf1234567890" }],
      };
    }
    return json(route, 200, body);
  });
  await page.clock.install();
  await page.goto(href!);
  await expect(page.getByText("Waiting for your payment").first()).toBeVisible();
  await noOverflow(page);
  await page.clock.runFor(3100);
  await expect(page.getByText("Converting and sending").first()).toBeVisible();
  await page.clock.runFor(3100);
  await expect(page.getByText("Payment complete").first()).toBeVisible();
  const receipt = page.getByRole("region", { name: "Receipt" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("Coffee order")).toBeVisible();
  const tx = receipt.getByRole("link", { name: /View transaction/ });
  await expect(tx).toHaveAttribute("href", "https://nearblocks.io/txns/9xAbCdEf1234567890");
  const share = page.getByRole("link", { name: "Share receipt on WhatsApp" });
  const shareHref = (await share.getAttribute("href"))!;
  expect(shareHref).toMatch(/^https:\/\/wa\.me\/\?text=/);
  const text = decodeURIComponent(shareHref.slice("https://wa.me/?text=".length));
  expect(text).toContain("Receipt: Coffee order\n1 USDC");
  expect(text).toContain("Paid to: near");
  expect(text).toContain("/status?a=" + DEPOSIT);
  await noOverflow(page);
});

test("a changed live amount forces a second confirmation", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await mockSetup(page, api);
  await mockQuote(page, api, () => liveBody("1020000"));
  await toDry(page);
  await page.getByRole("button", { name: "Confirm and get payment address" }).click();
  await expect(page.getByText("The price changed")).toBeVisible();
  await expect(page.getByText("Payment address", { exact: true })).toHaveCount(0);
  expect(api.quotes.filter((q) => q.dry === false)).toHaveLength(1);
  await noOverflow(page);
});

test("a changed live amount is confirmed once, then shows the deposit view without another live quote", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await mockSetup(page, api);
  await mockQuote(page, api, () => liveBody("1020000"));
  await toDry(page);
  const confirm = page.getByRole("button", { name: "Confirm and get payment address" });
  await confirm.click();
  await expect(page.getByText("The price changed")).toBeVisible();
  await expect(page.getByText("1.02 USDC").first()).toBeVisible();
  await confirm.click();
  const dep = page.getByRole("region", { name: "Payment instructions" });
  await expect(dep.getByText(DEPOSIT)).toBeVisible();
  await expect(dep.getByText("1.02 USDC").first()).toBeVisible();
  expect(api.quotes.filter((q) => q.dry === false)).toHaveLength(1);
  expect(api.quotes.filter((q) => q.dry === true)).toHaveLength(1);
});
test("401 on a private quote keeps inputs and retries the same private request", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await mockSetup(page, api, "confidential");
  let n = 0;
  await page.route("**/api/quote", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    api.quotes.push(body);
    if (n++ === 0) return json(route, 401, { message: "Unauthorized" });
    return json(route, 201, {
      quote: { amountIn: "1010224", minAmountIn: "1000121", amountOut: "1000000" },
      quoteRequest: { deadline: body.deadline },
    });
  });
  await page.goto(payUrl());
  await page.getByRole("option", { name: /USDC\s*eth/i }).click();
  await page.getByLabel("Refund address").fill(EVM);
  await page.getByRole("button", { name: "See what I will pay" }).click();
  await expect(page.getByText("Private payments are unavailable")).toBeVisible();
  await expect(page.getByLabel("Refund address")).toHaveValue(EVM);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Your quote")).toBeVisible();
  expect(api.quotes).toHaveLength(2);
  for (const q of api.quotes) expect(q.confidentiality).toBeUndefined();
  expect(api.quotes[1]).toMatchObject({ dry: true, refundTo: EVM, amount: "1000000" });
});
test("401 on quote in confidential mode shows unavailable message", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await mockSetup(page, api, "confidential");
  await page.route("**/api/quote", (r) => json(r, 401, { message: "Unauthorized" }));
  await page.goto(payUrl());
  await page.getByRole("option", { name: /USDC\s*eth/i }).click();
  await page.getByLabel("Refund address").fill(EVM);
  await page.getByRole("button", { name: "See what I will pay" }).click();
  await expect(page.getByText("Private payments are unavailable")).toBeVisible();
});

test("401 on the live quote shows unavailable message", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await mockSetup(page, api, "confidential");
  await mockQuote(page, api, () => 401);
  // dry mock returns 201 for dry requests; only live is rejected
  await toDry(page);
  await page.getByRole("button", { name: "Confirm and get payment address" }).click();
  await expect(page.getByText("Private payments are unavailable")).toBeVisible();
  await expect(page.getByText("Payment address", { exact: true })).toHaveCount(0);
});

test("invalid pay link makes no API calls", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await page.goto("/pay?i=bad");
  await expect(page.getByRole("heading", { name: "Invalid link" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(api.apiCalls).toEqual([]);
  await noOverflow(page);
});

async function statusScenario(
  page: Page,
  api: Api,
  body: unknown,
  httpStatus = 200,
  url = statusUrl({ refund: EVM }),
) {
  await page.route("**/api/status**", (route) => {
    api.apiCalls.push("status-mock");
    return json(route, httpStatus, body);
  });
  await page.goto(url);
}

test("status REFUNDED", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await statusScenario(page, api, {
    status: "REFUNDED",
    swapDetails: { refundedAmountFormatted: "1.01", refundReason: "DEADLINE_EXCEEDED" },
  });
  await expect(page.getByText("Payment returned to you").first()).toBeVisible();
  await expect(page.getByText("Refunded amount: 1.01")).toBeVisible();
  await expect(page.getByText("Reason: The payment window closed")).toBeVisible();
  await expect(page.getByText(EVM)).toBeVisible();
  await noOverflow(page);
});

test("status INCOMPLETE_DEPOSIT", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await statusScenario(page, api, {
    status: "INCOMPLETE_DEPOSIT",
    swapDetails: { depositedAmountFormatted: "0.5", amountInFormatted: "1.01" },
  });
  await expect(page.getByText("Not enough was sent").first()).toBeVisible();
  await expect(page.getByText("Amount received: 0.5")).toBeVisible();
  await expect(page.getByText("Amount needed: 1.01")).toBeVisible();
  await noOverflow(page);
});

test("status 404 shows Payment not found", async ({ page }, info) => {
  const api = await guard(page);
  track(info, api);
  await statusScenario(page, api, { message: "not found" }, 404);
  await expect(page.getByText("Payment not found")).toBeVisible();
  await noOverflow(page);
});
