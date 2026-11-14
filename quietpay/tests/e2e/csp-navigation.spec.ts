import { test, expect, type Page } from "@playwright/test";

// /payments has a CSP that allows the wallet connector; the other pages are strict.
// Crossing between them must be a full document load so each page gets its own CSP.

async function track(page: Page) {
  const csp: string[] = [];
  let documents = 0;
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) csp.push(m.text());
  });
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents++;
  });
  await page.route("**/api/auth/me", (r) => r.fulfill({ json: { accountId: null } }));
  return { csp, docs: () => documents };
}

async function cspOf(page: Page): Promise<string> {
  const res = await page.request.get(page.url());
  return res.headers()["content-security-policy"] ?? "";
}

const cases = [
  { name: "Connect wallet button", click: (p: Page) => p.getByRole("button", { name: "Connect wallet" }).click() },
  { name: "Payments nav link", click: (p: Page) => p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Payments" }).click() },
];

for (const c of cases) {
  test(`/ -> /payments via ${c.name} is a full document load with the connector CSP`, async ({ page }) => {
    const t = await track(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(t.docs()).toBe(1);
    await c.click(page);
    await page.waitForURL(/\/payments/);
    await page.waitForLoadState("networkidle");
    expect(t.docs()).toBeGreaterThanOrEqual(2);
    expect(await cspOf(page)).toContain("raw.githubusercontent.com");
    expect(t.csp).toEqual([]);
  });
}

test("/payments -> / via Create link restores the strict CSP", async ({ page }) => {
  const t = await track(page);
  await page.goto("/payments");
  await page.waitForLoadState("networkidle");
  const before = t.docs();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Create link" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForLoadState("networkidle");
  expect(t.docs()).toBeGreaterThan(before);
  expect(await cspOf(page)).not.toContain("raw.githubusercontent.com");
  expect(t.csp).toEqual([]);
});
