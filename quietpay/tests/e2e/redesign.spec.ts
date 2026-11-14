import { test, expect, type Page, type Route } from "@playwright/test";
import { buildPayLink, encodeInvoice } from "../../lib/link-codec";

const ORIGIN = "http://localhost:3100";
const ACCOUNT = "mhrk7676.near";

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function payment(n: number, amount: string, description: string, createdAt: string) {
  const invoiceCode = encodeInvoice({ amount, account: ACCOUNT, description, createdAt: 1700000000000 + n });
  return {
    depositAddress: `0x${String(n).repeat(40)}`,
    depositMemo: null,
    amountIn: String(Math.round(Number(amount) * 1_010_000)),
    minAmountIn: "1",
    origin: n % 2 ? { symbol: "USDC", blockchain: "eth", decimals: 6, assetId: "x" } : { symbol: "SOL", blockchain: "sol", decimals: 6, assetId: "y" },
    deadline: "2030-01-01T00:30:00.000Z",
    createdAt,
    invoiceCode,
    description,
    amount,
  };
}

const PAYMENTS = [
  payment(1, "25", "Logo design deposit", "2030-01-04T10:00:00.000Z"),
  payment(2, "10.5", "QA coffee", "2030-01-03T10:00:00.000Z"),
  payment(3, "40", "Website hosting", "2030-01-02T10:00:00.000Z"),
  payment(4, "5", "Sticker pack", "2030-01-01T10:00:00.000Z"),
];
const STATUS_BY_ADDRESS: Record<string, string> = {
  [PAYMENTS[0].depositAddress]: "SUCCESS",
  [PAYMENTS[1].depositAddress]: "SUCCESS",
  [PAYMENTS[2].depositAddress]: "PROCESSING",
  [PAYMENTS[3].depositAddress]: "REFUNDED",
};

async function mockSignedInDashboard(page: Page, opts: { delayStatusMs?: number } = {}) {
  await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: ACCOUNT }));
  await page.route("**/api/my-payments", (r) => json(r, 200, { accountId: ACCOUNT, payments: PAYMENTS }));
  await page.route("**/api/status**", async (r) => {
    const addr = new URL(r.request().url()).searchParams.get("depositAddress") ?? "";
    if (opts.delayStatusMs) await new Promise((res) => setTimeout(res, opts.delayStatusMs));
    return json(r, 200, { status: STATUS_BY_ADDRESS[addr] ?? "PENDING_DEPOSIT" });
  });
}

test.describe("merchant header", () => {
  test("shows brand left, nav, and Connect wallet on the right of /", async ({ page }) => {
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: null }));
    await page.goto("/");
    const header = page.getByRole("banner");
    const brand = header.getByRole("link", { name: "QuietPay" });
    const connect = header.getByRole("button", { name: "Connect wallet" });
    await expect(brand).toBeVisible();
    await expect(connect).toBeVisible();
    await expect(header.getByRole("link", { name: "Create link" })).toHaveAttribute("aria-current", "page");
    await expect(header.getByRole("link", { name: "Payments" })).toBeVisible();
    const b = (await brand.boundingBox())!;
    const c = (await connect.boundingBox())!;
    expect(b.x).toBeLessThan(c.x);
  });

  test("Connect wallet on / navigates to /payments?connect=1", async ({ page }) => {
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: null }));
    await page.route("**/api/auth/challenge", (r) => json(r, 503, { message: "Sign-in is not set up" }));
    await page.goto("/");
    // Record every URL pushed to the history; the flag is stripped from the address bar once handled.
    await page.evaluate(() => {
      const w = window as unknown as { __pushed: string[] };
      w.__pushed = [];
      const push = history.pushState.bind(history);
      history.pushState = (data, unused, url) => {
        w.__pushed.push(String(url));
        push(data, unused, url);
      };
    });
    await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();
    await expect(page).toHaveURL(/\/payments/);
    const pushed = await page.evaluate(() => (window as unknown as { __pushed: string[] }).__pushed);
    expect(pushed.some((u) => u.includes("/payments?connect=1"))).toBe(true);
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  });

  test("/payments?connect=1 opens the wallet picker automatically (CSP allows it there)", async ({ page }) => {
    test.setTimeout(60_000);
    const problems: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
    });
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: null }));
    await page.route("**/api/auth/challenge", (r) =>
      json(r, 200, { message: "Sign in to QuietPay", recipient: "localhost:3100", nonce: Buffer.alloc(32, 7).toString("base64") }),
    );
    await page.goto("/payments?connect=1");
    await expect(page.locator(".connect-item").first()).toBeVisible({ timeout: 25_000 });
    // The flag is removed from the address bar once handled, so a reload does not reopen the picker.
    await expect(page).toHaveURL(/\/payments$/);
    expect(problems).toEqual([]);
  });

  test("signed in: the header shows the account with a My payments / Sign out menu", async ({ page }) => {
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: ACCOUNT }));
    let loggedOut = false;
    await page.route("**/api/auth/logout", (r) => {
      loggedOut = true;
      return json(r, 200, { ok: true });
    });
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
    const account = header.getByRole("button", { name: ACCOUNT });
    await expect(account).toBeVisible();
    await account.click();
    await expect(header.getByRole("link", { name: "My payments" })).toHaveAttribute("href", "/payments");
    await page.keyboard.press("Escape");
    await expect(header.getByRole("link", { name: "My payments" })).toHaveCount(0);
    await account.click();
    await header.getByRole("button", { name: "Sign out" }).click();
    await expect(header.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    expect(loggedOut).toBe(true);
  });
});

test.describe("payments dashboard", () => {
  test("table rows have status badges, summary figures add up, and the filter tabs work", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockSignedInDashboard(page);
    await page.goto("/payments");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText([
      "Date",
      "Description",
      "Amount (USDC)",
      "Paid with",
      "Status",
      "Action",
    ]);
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    const logo = rows.filter({ hasText: "Logo design deposit" });
    await expect(logo.locator(".badge")).toHaveText("Paid");
    await expect(logo).toContainText("on Ethereum");
    await expect(rows.filter({ hasText: "Website hosting" }).locator(".badge")).toHaveText("Processing");
    await expect(rows.filter({ hasText: "Sticker pack" }).locator(".badge")).toHaveText("Returned");
    await expect(logo.getByRole("link", { name: /View/ })).toHaveAttribute("href", /\/status\?a=0x1{40}&i=/);
    // Amounts are right-aligned numerals.
    expect(await logo.locator("td.num").evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");

    const summary = page.getByRole("group", { name: "Summary" });
    await expect(summary.getByText("Received").locator("..")).toContainText("35.5");
    await expect(summary.getByText("In progress").locator("..")).toContainText("1");
    await expect(summary.getByText("Returned or failed").locator("..")).toContainText("1");

    await page.getByRole("tab", { name: /^Paid/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(table).not.toContainText("Website hosting");
    await page.getByRole("tab", { name: /^In progress/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Website hosting");
    await page.getByRole("tab", { name: /^Returned\/failed/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Sticker pack");
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(rows).toHaveCount(4);
    // Arrow keys move between tabs.
    await page.getByRole("tab", { name: /^All/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^Paid/ })).toHaveAttribute("aria-selected", "true");
  });

  test("shows a loading skeleton for each status before the badge", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockSignedInDashboard(page, { delayStatusMs: 800 });
    await page.goto("/payments");
    await expect(page.getByRole("status", { name: "Checking status" }).first()).toBeVisible();
    await expect(page.getByRole("table").locator(".badge").first()).toBeVisible();
    await expect(page.getByRole("status", { name: "Checking status" })).toHaveCount(0);
  });

  test("at 360px the rows stack as cards with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockSignedInDashboard(page);
    await page.goto("/payments");
    const row = page.locator("tbody tr").filter({ hasText: "Logo design deposit" });
    await expect(row).toBeVisible();
    await expect(row.locator(".badge")).toHaveText("Paid");
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe("grid");
    // The label of each cell is shown next to its value.
    expect(await row.locator("td.num").evaluate((el) => getComputedStyle(el, "::before").content)).toContain("Amount");
    const amount = (await row.locator("td.num").boundingBox())!;
    const status = (await row.locator("td").nth(4).boundingBox())!;
    expect(status.y).toBeGreaterThan(amount.y);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    for (const header of await page.getByRole("banner").getByRole("button").all()) {
      expect((await header.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("payer pages", () => {
  test("have a brand-only header and no wallet button; CSP on / and /pay stays strict", async ({ page }) => {
    const code = encodeInvoice({ amount: "1", account: "near", description: "Coffee order", createdAt: 1700000000000 });
    await page.route("**/api/config", (r) => json(r, 200, { mode: "public" }));
    await page.route("**/api/tokens", (r) => json(r, 200, []));
    await page.route("**/api/invoice**", (r) => json(r, 200, { deposits: [] }));
    await page.route("**/api/auth/me", (r) => json(r, 200, { accountId: null }));
    for (const url of [buildPayLink(ORIGIN, { amount: "1", account: "near", description: "Coffee order", createdAt: 1700000000000 }), `/status?i=${code}`, "/status"]) {
      const res = await page.goto(url);
      const header = page.getByRole("banner");
      await expect(header.getByRole("link", { name: "QuietPay" })).toBeVisible();
      await expect(page.getByRole("button", { name: /connect wallet|sign in/i })).toHaveCount(0);
      await expect(header.getByRole("navigation")).toHaveCount(0);
      const csp = res!.headers()["content-security-policy"];
      expect(csp).toContain("connect-src 'self';");
      expect(csp).toContain("font-src 'self';");
      expect(csp).toContain("img-src 'self' data:;");
      expect(csp).not.toContain("githubusercontent");
    }
    const home = await page.goto("/");
    const csp = home!.headers()["content-security-policy"];
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("font-src 'self';");
    expect(csp).not.toContain("githubusercontent");
    expect(csp).not.toContain("frame-src");
  });

  test("pay page shows an amount hero, the merchant and plain refund wording", async ({ page }) => {
    await page.route("**/api/config", (r) => json(r, 200, { mode: "confidential" }));
    await page.route("**/api/tokens", (r) =>
      json(r, 200, [
        { assetId: "a", decimals: 6, blockchain: "eth", symbol: "USDC", price: 1 },
        { assetId: "b", decimals: 6, blockchain: "near", symbol: "USDC", price: 1 },
      ]),
    );
    await page.route("**/api/invoice**", (r) => json(r, 200, { deposits: [] }));
    await page.goto(buildPayLink(ORIGIN, { amount: "25", account: "shop.near", description: "Logo design deposit", createdAt: 1700000000000 }));
    const hero = page.getByRole("region", { name: "Invoice" });
    await expect(hero).toContainText("25");
    await expect(hero).toContainText("Logo design deposit");
    await expect(hero).toContainText("shop.near");
    await expect(page.getByText("Private payment")).toBeVisible();
    await page.getByRole("option", { name: /USDC\s*Ethereum/ }).click();
    await expect(page.getByLabel("Your address on Ethereum for refunds")).toBeVisible();
    await expect(page.getByText(/Refund address/)).toHaveCount(0);
  });
});
