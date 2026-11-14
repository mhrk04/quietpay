import { test, expect, type Page, type Route } from "@playwright/test";

import { encodeInvoice } from "../../lib/link-codec";

const ORIGIN = "http://localhost:3100";
const INVOICE_CODE = encodeInvoice({ amount: "1", account: "shop.near", description: "Coffee order", createdAt: 1700000000000 });
const PAYMENT = {
  depositAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  depositMemo: null,
  amountIn: "1010224",
  minAmountIn: "1000121",
  origin: { symbol: "USDC", blockchain: "eth", decimals: 6, assetId: "x" },
  deadline: "2030-01-01T00:30:00.000Z",
  createdAt: "2030-01-01T00:00:00.000Z",
  invoiceCode: INVOICE_CODE,
  description: "Coffee order",
  amount: "1",
};
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockSignedIn(page: Page) {
  await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: "shop.near" }));
  await page.route("**/api/my-payments", (r) => json(r, 200, { accountId: "shop.near", payments: [PAYMENT] }));
  await page.route("**/api/status**", (r) => json(r, 200, { status: "SUCCESS" }));
}

test("signed in: shows account, payment list with readable chain, status and link; sign out works", async ({ page }) => {
  await mockSignedIn(page);
  let loggedOut = false;
  await page.route("**/api/auth/logout", (r) => {
    loggedOut = true;
    return json(r, 200, { ok: true });
  });
  await page.goto("/payments");
  await expect(page.getByText("shop.near").first()).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Coffee order" });
  await expect(item).toContainText("1 USDC requested");
  await expect(item).toContainText("1.010224 USDC on Ethereum");
  await expect(item).not.toContainText("on eth ");
  await expect(item).toContainText("Payment complete");
  const href = await item.getByRole("link", { name: "View payment status" }).getAttribute("href");
  expect(href).toContain("/status?a=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(href).toContain("&d=");
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with NEAR" })).toBeVisible();
  expect(loggedOut).toBe(true);
});

test("signed in with no payments and with a load error", async ({ page }) => {
  await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: "shop.near" }));
  await page.route("**/api/my-payments", (r) => json(r, 200, { accountId: "shop.near", payments: [] }));
  await page.goto("/payments");
  await expect(page.getByText("No payments yet.")).toBeVisible();
  await page.unroute("**/api/my-payments");
  await page.route("**/api/my-payments", (r) => json(r, 502, { message: "Payments could not be loaded" }));
  await page.reload();
  await expect(page.locator(".create-error")).toContainText("Payments could not be loaded");
});

test("signed out, and sign-in not set up", async ({ page }) => {
  await page.route("**/api/auth/me", (r) => json(r, 401, { message: "Not signed in" }));
  await page.goto("/payments");
  await expect(page.getByRole("button", { name: "Sign in with NEAR" })).toBeVisible();
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (r) => json(r, 503, { message: "Sign-in is not set up" }));
  await page.reload();
  await expect(page.getByText("Sign-in is not set up")).toBeVisible();
});

test("Create page links to My payments", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "My payments (sign in with NEAR)" }).click();
  await expect(page).toHaveURL(/\/payments$/);
});

test("CSP: /payments allows the wallet selector with 0 CSP errors; / and /pay stay strict", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.route("**/api/auth/me", (r) => json(r, 401, { message: "Not signed in" }));
  await page.route("**/api/auth/challenge", (r) =>
    json(r, 200, { message: "Sign in to QuietPay", recipient: "localhost:3100", nonce: Buffer.alloc(32, 7).toString("base64") }),
  );
  const res = await page.goto("/payments");
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("raw.githubusercontent.com");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toMatch(/(connect|img)-src[^;]*\s\*/);
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  await page.getByRole("button", { name: "Sign in with NEAR" }).click();
  // The connector fetches its wallet list from GitHub (real network) and shows the selector.
  await expect(page.locator(".connect-item").first()).toBeVisible({ timeout: 20_000 });
  expect(problems).toEqual([]);
  // Choose each wallet so its sandboxed script is fetched and started under the policy.
  for (const id of ["hot-wallet", "meteor-wallet", "mynearwallet", "intear-wallet", "near-mobile", "nightly-wallet"]) {
    await page.reload();
    await page.getByRole("button", { name: "Sign in with NEAR" }).click();
    await page.locator(`.connect-item[data-type="${id}"]`).click();
    await page.waitForTimeout(4000);
    expect(problems, `CSP errors after opening ${id}`).toEqual([]);
  }

  for (const path of ["/", `/pay?i=${INVOICE_CODE}`, "/status"]) {
    const r = await page.goto(path);
    const h = r!.headers()["content-security-policy"];
    expect(h).toContain("connect-src 'self';");
    expect(h).not.toContain("githubusercontent");
    expect(h).toContain("img-src 'self' data:;");
  }
  void ORIGIN;
});
