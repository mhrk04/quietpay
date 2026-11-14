# Validation summary

QuietPay was checked on 2026-11-14 with six independent review passes (integration, security, code, browser, design, alignment), each run by a separate agent against the written requirements. Bugs found in the first run were fixed and the affected checks were run again.

| Check | Result | Notes |
|---|---|---|
| Integration | PASS | Every field the app reads exists in the real 1Click API with the same name and type. Checked with real dry-run quotes, the token list and a status lookup. Live-quote fields were checked against the API schema only. |
| Security | PASS | No findings rated 7/10 or higher. A build with a fake JWT showed the key never reaches the browser bundle or any API response. `npm audit --omit=dev`: 0 vulnerabilities. |
| Code | Defects fixed | First run found a confirm loop after a price change, proxy routes that called 1Click when the server was unconfigured, a 401 that blocked retry, and an unused `swapType` guard. All four are fixed with regression tests. The re-run confirmed the fixes and found no regressions. |
| Browser | PASS (re-run) | Real Chromium at 360 px: create, pay with a real dry-run quote, mocked confirm and status flows. 0 console errors, no horizontal overflow. |
| Design | Not passed, accepted | Lighthouse performance 98-100, accessibility 89 on `/pay`. The visual design is minimal (no design system or branding). |
| Alignment | Partial at run time | The only gap was untested private (Confidential Intents) quotes. Retested afterwards with a partner JWT: private dry-run quotes return `confidentiality: "basic"`, the server overrides client attempts to go public, the JWT never appears in responses or logs, and the Pay page shows the "Private payment" label. |

## Tests

- 43 unit tests (`npm test`) and 10 Playwright end-to-end tests at 360 px with mocked API routes (`npm run test:e2e`).
- Not written: property-based tests and live read-only API tests. Some edge-case scenarios have no dedicated test; see `quietpay/README.md`, "Testing status".

## Known limitations

- No real end-to-end mainnet payment has been made with the app.
- Private mode is tested only with dry-run quotes; no private live quote or payment has been made.
- The payment link carries the invoice in the URL, so it is long and can be edited. The merchant must check what arrives.
- The payer still sees some technical words, such as "refund address" and chain names.
