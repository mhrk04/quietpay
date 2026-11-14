import { test, expect } from "@playwright/test";
import { buildPayLink } from "../../lib/link-codec";

const ORIGIN = "http://localhost:3100";
const INVOICE = { amount: "1", account: "near", description: "Coffee order", createdAt: 1700000000000 };

test("pages load under the CSP with no CSP console errors and the headers are set", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.route("**/api/config", (r) => r.fulfill({ json: { mode: "public" } }));
  await page.route("**/api/tokens", (r) => r.fulfill({ json: [] }));
  const payUrl = buildPayLink(ORIGIN, INVOICE);
  for (const url of [`${ORIGIN}/`, payUrl, `${ORIGIN}/status`]) {
    const res = await page.goto(url);
    const h = res!.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age=63072000");
    await page.waitForLoadState("networkidle");
  }
  // The Create page renders QR data URLs; confirm one is not blocked.
  await page.goto(`${ORIGIN}/`);
  await page.getByLabel(/amount/i).first().fill("1");
  await page.getByLabel(/account/i).first().fill("near");
  await page.getByRole("button", { name: /create/i }).first().click();
  await expect(page.locator('img[src^="data:"]').first()).toBeVisible();
  expect(problems).toEqual([]);
});
