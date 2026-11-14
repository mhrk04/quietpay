# QuietPay

QuietPay is a web app for taking a payment in USDC on NEAR. A merchant creates a payment link for an exact USDC amount. A payer opens the link, picks any supported token on any supported chain, sees a quote, and gets a deposit address. The merchant receives exactly the requested USDC in their NEAR account. Payer and merchant both get a live status page and a WhatsApp-shareable receipt.

- Hackathon track: **realworld** (NEAR Hackathon, Real-World Money).
- Stack: Next.js (App Router), TypeScript, a private Vercel Blob store for payment records, no smart contract.
- Settlement is done only by the NEAR Intents 1Click API. QuietPay never holds funds or private keys.

## Live demo

https://quietpay-rust.vercel.app (hosted on Vercel, private mode enabled with a partner JWT stored as a Vercel secret). You can run the demo steps below on it without installing anything. Steps 1 to 5 spend nothing.

## MAINNET NOTICE (read before the demo)

NEAR Intents and the 1Click API have no testnet. **A completed payment moves real funds on mainnet.** Recommended demo amount: **at most 1 USDC**. Steps 1 to 4 below (link, token choice, dry quote) spend nothing. Steps 5 onward only spend money if you send tokens to the deposit address.

## What the terms mean

- **NEAR Intents**: a system where a user states the result they want (for example, "send 1 USDC to this NEAR account") and market makers carry out the swap and transfers across chains.
- **1Click**: the REST API (`https://1click.chaindefuser.com`) on top of NEAR Intents. You request a quote, send tokens to one address, and the swap is done for you.
- **Quote**: the API's price for one swap, including how much the payer must send. QuietPay always asks for an exact output (`EXACT_OUTPUT`), so the merchant gets the exact amount and the payer carries the cost.
- **Dry quote**: a quote with `dry: true`. It shows the price but creates no deposit address.
- **Deposit address**: the address from a live quote (`dry: false`) that the payer sends tokens to. It is valid until the quote deadline.
- **Swap**: the conversion from the payer's token on the payer's chain into USDC on NEAR, plus delivery to the merchant.
- **Status**: the state of a swap reported by `GET /v0/status`: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING` (in progress) and `SUCCESS`, `REFUNDED`, `FAILED`, `INCOMPLETE_DEPOSIT` (final).

## Demo steps

Each step is one action with one expected result. Run the app first (see Setup).

1. Open `http://localhost:3000/`. Expected: the "Create payment link" form is shown.
2. Enter amount `1`, a real NEAR account you control (for example `yourname.near`), and a description, then press "Create payment link". Expected: a payment link, a QR code, a copy button and a "Share on WhatsApp" button appear, and the link is added to your saved list.
3. Open the payment link in a new tab (or on a phone). Expected: the Pay page shows the amount, description and merchant account without any API call, then loads the token list grouped by chain.
4. Choose a token and chain, enter a refund address on that chain (a real address of yours), and request the quote. Expected: a dry quote shows what you send (`amountIn`), the minimum accepted (`minAmountIn`), the exact USDC the merchant receives, and the time estimate. No deposit address is shown yet.
5. Press "Confirm and get payment address". Expected: one live quote is requested, then the deposit address, QR code, exact amount, copy buttons, a countdown and a link to the status page appear. If the live amount differs from the dry quote, the new amount is shown and you must confirm again. **Sending tokens to this address moves real funds.**
6. (Optional, real money) Send the shown amount of the selected token on the selected chain to the deposit address from your own wallet. Expected: your wallet shows the transfer. You may paste the transaction hash and press "Send hash to speed things up".
   Expected after step 5: the deposit view is saved in this browser. Reopen the same pay link before the countdown ends and you see the same address and amount with the note "You already started this payment", and no new quote is requested. "Start over with a new quote" clears it.
   Expected after step 5, on another phone: open the same pay link there. If the payment is still pending you see "A payment was already started for this invoice" with "Continue with this payment" and "Start a new payment". If it was completed you see "This invoice is already paid" with a receipt link and no new quote. The refund address is not known on another device, so refunds still go to the address the payer entered.
7. Press "Track this payment". Expected: the status page opens in a new tab, so the payment instructions stay open. While it waits for a deposit, the status page also shows the deposit address with a copy button and a "Back to payment instructions" link. To tell the merchant, press "Send tracking link to the merchant on WhatsApp". The merchant can also press "Check my NEAR account" on the Create page. It opens nearblocks.io and shows incoming USDC even when the payer does not share the tracking link. On the status page, expected: the page checks status immediately, then every 3 seconds, and shows "Waiting for your payment", then "Payment seen, confirming", then "Converting and sending".
   Merchant check: on the Create page press "Check payments" under the new link or a saved invoice. Expected: each recorded payment is listed with its live status text and a "View payment status" link.
8. Wait for the final status. Expected: "Payment complete" with the delivered amount, the merchant account and explorer links where the API returns them. Other final results are "Payment returned to you", "Payment failed" and "Not enough was sent". Polling stops.
9. Press "Share receipt on WhatsApp". Expected: WhatsApp opens (`wa.me`) with a prefilled message holding the description, amount, merchant account and status page URL. Before success the button reads "Share status on WhatsApp" and the message holds only the status URL and the status.

Steps 1 to 5 do not require sending money. Without sending funds, the status page for the new address stays at "Waiting for your payment".

## Video script (60 to 90 seconds)

| Time | Show | Say |
|---|---|---|
| 0:00 to 0:10 | Step 1 | "QuietPay lets a merchant ask for an exact USDC amount and be paid from any chain. Mainnet only, so I use 1 USDC." |
| 0:10 to 0:25 | Step 2 | "I enter the amount and my NEAR account and get a link, a QR code and a WhatsApp share." |
| 0:25 to 0:45 | Steps 3 and 4 | "The payer opens the link, picks a token and chain, and sees a dry quote: what they send, the minimum, and the exact USDC the merchant gets. No address yet." |
| 0:45 to 0:55 | Step 5 | "After confirming, they get one deposit address with a countdown. Reopening the link brings back the same address. The 1Click API does the swap." |
| 0:55 to 1:10 | Steps 6 to 8 | "I send from my wallet. Tracking opens in a new tab and checks every 3 seconds. The payer can send that link to the merchant, and the merchant can also check their NEAR account." |
| 1:10 to 1:25 | Step 9 | "Either side shares a receipt on WhatsApp. No smart contract, no custody, no keys. Confidential mode needs a partner JWT, and it does not hide the merchant account or amount on NEAR." |

## Setup

Requires Node.js 20 or newer.

1. Install dependencies:

   ```bash
   cd quietpay
   npm install
   ```

2. Create the env file: `cp .env.example .env.local`.
3. Edit `.env.local` and choose one mode. Without this step the Pay page shows "Payments are not set up".
   - **Public mode (no partner JWT, easiest for a judge):** set `QUIETPAY_ALLOW_PUBLIC_FALLBACK=true`. Payments are labeled "Standard payment (not private)".
   - **Private mode:** set `ONECLICK_JWT` to your partner JWT. Tested with dry-run quotes only (see "Real-API check").
4. Start the app: `npm run dev` (http://localhost:3000). Restart it after changing `.env.local`.

Other commands:

```bash
npm test                                   # unit tests (vitest)
npm run typecheck                          # generate Next route types, then tsc
npx eslint .                               # lint
npm run build && npm start                 # production build
npm run check:1click -- <depositAddress>   # real-API read-only check (needs network)
npm run test:e2e                           # Playwright e2e (builds the app, sets the public fallback itself)
```

### Environment variables

Set these in `.env.local` (server side only). Never commit real values.

| Variable | Purpose |
|---|---|
| `ONECLICK_JWT` | Partner JWT from https://partners.near-intents.org. Sent by the server to 1Click as `X-API-Key`. Enables confidential quotes (`confidentiality: "basic"`). Example: `ONECLICK_JWT=<your-partner-jwt>`. Never sent to the browser. |
| `QUIETPAY_ALLOW_PUBLIC_FALLBACK` | Set to exactly `true` to allow public (not private) quotes when `ONECLICK_JWT` is empty. The UI then labels payments "Standard payment (not private)". Any other value, with no JWT, makes the server return HTTP 500 "Server is not configured". |
| `BLOB_READ_WRITE_TOKEN` | Token of the private Vercel Blob store that holds payment records. Added by Vercel when the store is connected. Optional: without it, nothing is recorded. |
| `QUIETPAY_SESSION_SECRET` | Random string of at least 32 characters, used to sign the sign-in challenge and the session cookie (HMAC-SHA256). Example: `QUIETPAY_SESSION_SECRET=<output of openssl rand -base64 48>`. Server only. Optional: when it is empty, merchant sign-in answers "Sign-in is not set up" and the rest of the app works. |
| `QUIETPAY_AUTH_RECIPIENT` | Name the wallet shows as the recipient of the sign-in message. Optional: the site's host name is used when empty. |
| `NEAR_RPC_URL` | NEAR mainnet RPC used to check the signing key. Optional: defaults to `https://free.rpc.fastnear.com` (free public endpoint from the NEAR docs). |
| `QUIETPAY_LIVE_TESTS` | Set to exactly `true` to run read-only live tests against the real 1Click API. Unset means no test calls the real API. Live tests are not written yet (`tests/live/` is empty), so this variable currently has no effect. |

Server modes: JWT set gives `confidential`. No JWT and fallback `true` gives `public`. Otherwise `unconfigured`.

## Confidentiality scope and the JWT requirement

- Confidential mode (`confidentiality: "basic"`) is documented to prevent the deposit from being linked to the payout on-chain.
- It **does not hide the merchant's NEAR account or the USDC amount on the NEAR chain** when the payout lands. QuietPay does **not** claim that amounts or counterparties are hidden from every observer.
- Confidential mode **requires a partner JWT**. Unauthenticated confidential quotes return **HTTP 401** ("User authentication is required for confidential intent quotes"). QuietPay never retries a 401 as a public quote. It shows "Private payments are unavailable right now" and keeps the entered details.

## Limitations (assumptions A1 to A8)

- **A1. Confidential flow needs a JWT.** With a partner JWT, private dry-run quotes work (tested 2026-11-14). Without one, the app only works through the explicit public fallback flag, and the UI says the payment is not private.
- **A2. Confidentiality scope.** The merchant's NEAR account and the USDC amount remain visible on NEAR. No claim of hiding from every observer.
- **A3. Dry quote needs a refund address.** The API requires `refundTo` even for dry quotes, so the Pay page asks for a real refund address before quoting.
- **A4. No quote before a token is chosen.** A quote needs an origin asset, so the dry quote appears after the payer picks a token and chain.
- **A9. Payment records are shared by link.** Recorded deposits for an invoice are readable by anyone with the link (see "What the server stores"). Payments made before this feature, or when storage was unavailable, are not listed, so a payer on another device may not see them.
- **A5. The invoice lives in the link.** The invoice (amount, account, description) is encoded in the URL. Anyone who edits the URL changes the invoice, so the merchant must check the amount actually received. The saved-links list is in the merchant's browser `localStorage` only (see "If the merchant clears browser data").
- **A6. Recipient USDC registration is not checked.** A NEAR account must be registered on the USDC contract to receive USDC. Whether 1Click registers it automatically is unverified.
- **A7. Confidential status detail is unverified.** It is unknown whether status returns destination transaction hashes for confidential swaps. The status page works with empty hash arrays and just omits the links.
- **A8. Mainnet only.** No testnet exists. Paid quotes spend real funds.

Other limits: unknown chains accept any non-empty refund address without spaces (the API is the final check). Without a JWT, 1Click adds a 0.25% fee, which the payer bears under `EXACT_OUTPUT`.

## Real-API check results (2026-11-14)

Read-only calls to `https://1click.chaindefuser.com`, first without a JWT:

- `GET /v0/tokens`: HTTP 200, 231 tokens.
- Dry quote (`dry: true`, `EXACT_OUTPUT`): HTTP 201. The response had `quote.amountIn`, `quote.minAmountIn`, `quote.amountOut` and `quote.timeEstimate` (45 s in the example). It had no `depositAddress`, no `depositMemo` and no `quote.deadline`.
- Refund address: the placeholder `0x…0001` was accepted. `0x…dead` was rejected with "refundTo is not valid". For this reason the Pay page asks for a real refund address.
- Recipient: `quietpay-check.near` (a nonexistent account) returned HTTP 400 "Internal server error". `near` worked.
- Confidential (`confidentiality: "basic"`) without a JWT: HTTP 401, "User authentication is required for confidential intent quotes".
- Status for an unknown deposit address: HTTP 404.

**Private mode, tested 2026-11-14 with a partner JWT (dry-run quotes only):** `/api/config` returned `confidential`. A dry quote through `/api/quote` returned HTTP 201 with `quoteRequest.confidentiality: "basic"` (send 1.010222 USDC, merchant receives 1 USDC). A client request asking for `confidentiality: "public"` was overridden to `basic` by the server. The JWT did not appear in any response or in the server log. The Pay page showed the "Private payment" label in a real browser. A partner JWT alone was enough.

**Not verified:**

- Live quotes and a real payment end to end, in either mode.
- Whether destination transaction hashes appear for confidential swaps.
- Whether the recipient account needs, or gets, USDC registration.

## Merchant sign-in
The Create page links to **My payments** (`/payments`). The merchant signs in with a NEAR wallet and sees every payment made to their account, on any device.
How it works:
1. The page asks the server for a challenge: the message "Sign in to QuietPay", a recipient (the site name) and a random 32-byte code. The server puts these in a signed cookie that lasts 5 minutes.
2. The wallet (through `@hot-labs/near-connect`, mainnet) shows the message and signs it as a NEP-413 message. **This is only a signature. No transaction is sent, no gas or fee is paid, no funds can move, and no access key is added.**
3. The server checks the signature against the message, recipient and code stored in its own cookie (never values sent by the browser), then asks the NEAR mainnet RPC whether that public key is a **full-access key** of the account.
4. If everything matches, the server sets a session cookie and removes the challenge cookie.
What is checked:
- The challenge cookie is present, has a valid HMAC-SHA256 signature (compared in constant time) and is under 5 minutes old.
- The NEAR account ID is valid and the ed25519 signature is valid over the NEP-413 payload (tag 2^31 + 413, SHA-256).
- The key is a full-access key of that account on mainnet. Function-call keys and unknown keys are rejected. If the RPC cannot be reached the server answers 502 and nothing is signed in.
- The challenge cookie is cleared after every answer except a temporary RPC failure. The server keeps no list of used codes, so "single use" means the browser's challenge is removed, and a copy of the cookie plus its signature would still work until the 5 minutes end.
Session: an httpOnly, SameSite=Lax cookie `qp_session` (Secure in production) that is valid for 8 hours and holds only the account ID, signed with `QUIETPAY_SESSION_SECRET`. "Sign out" clears it. The cookie is not stored on the server, so signing out does not invalidate a copy that was saved elsewhere.
What the merchant sees: account, and for each payment the description, the amount requested, the token and chain the payer used (readable names such as "Ethereum"), the live status, and a "View payment status" link. Newest first, at most 200 per account.
Limits:
- Payments recorded before this feature was added are **not** indexed by account. They stay available through their payment link ("Check payments" on the Create page).
- Sign-in proves control of a full-access key of the account. It does not prove the person owns the business.
- A wallet that is not on the list of allowed sites in the `/payments` security policy is blocked on that page (see below).
- Real wallet signatures cannot be produced by the automated tests. They cover the server checks with generated keys and a mocked RPC, and the page with mocked responses.
Security policy for `/payments`: every other page keeps the strict policy. `/payments` additionally allows only what the wallet connector needs (`connect-src`, `img-src`, `style-src`, `font-src`, one `frame-src`): GitHub and jsDelivr for the wallet list, and the hosts used by HOT, Meteor, MyNearWallet, Intear, NEAR Mobile and Nightly. The list is in `next.config.ts`. Wallet code runs in a sandboxed frame that inherits this policy, so a new wallet needs its hosts added there.
## What the server stores (payment records)

- For each live quote the server itself received and that matches the invoice, QuietPay stores one small JSON record in a **private Vercel Blob store**, under `invoices/<sha256 of the invoice code>/<deposit address>.json`, and a copy under `accounts/<sha256 of the merchant account>/<deposit address>.json` that also holds the invoice code, description and requested amount (this powers "My payments"; the account comes from the invoice that the server matched, never from the browser). The record holds the deposit address, deposit memo (if any), amounts, token and chain, quote deadline and creation time.
- It stores **no refund address, no keys, no JWT, no IP address and no personal data**. At most 20 records are kept per invoice and 200 per account.
- A record is written only for a live (`dry: false`) quote that succeeded, whose recipient and amount match the invoice code the payer's browser sent with the request. The deposit address always comes from the 1Click response, never from the browser. Dry quotes are never recorded.
- **Anyone who has the payment link can read these records** through `/api/invoice`. Deposit addresses are public on-chain anyway, but this means QuietPay's server can link a deposit to an invoice and its merchant, even though the chain cannot. This is a limit of the confidentiality QuietPay offers (see the scope section above).
- If the Blob store is not configured (`BLOB_READ_WRITE_TOKEN` missing), recording is skipped and the app works as before. A storage failure never blocks a quote or a payment. Only the server reads or writes the store (the browser never calls Blob), so the CSP is unchanged.

### Who can see and change payment records

QuietPay has no user accounts. Per invoice, **the payment link is the key.** Across all of a merchant's invoices, a NEAR wallet sign-in (see "Merchant sign-in") is the key.

| Who | Can do | How it is enforced |
|---|---|---|
| QuietPay's server | Read and write the Blob store | The store is private. The server authenticates to Vercel Blob with a short-lived Vercel OIDC token (or `BLOB_READ_WRITE_TOKEN`), held only in the server environment. The browser never talks to Blob, and a blob's URL opened without credentials returns HTTP 403 (checked on the live store). |
| A payer confirming a payment | Cause one record to be written | Only through `/api/quote`, only after 1Click returns a successful live quote whose recipient and amount match the invoice. The deposit address is taken from 1Click's response. A browser cannot submit or change a deposit address, so nobody can plant a fake address on someone else's invoice. |
| Anyone holding the payment link (payer, merchant, anyone it is forwarded to) | See that invoice's payments and their status | `/api/invoice?i=<code>` checks that the invoice code is valid, then looks in the folder named by the code's sha256 hash. Without the exact link the folder cannot be found or guessed. |
| The merchant, signed in with a NEAR wallet | See every payment made to their NEAR account since this feature was added | `/api/my-payments` needs the signed `qp_session` cookie. The account comes from that cookie only (never from the URL). Records sit under `accounts/<sha256 of the account>/`. |
| Everyone else | Nothing | There is no route that lists invoices. The API rejects calls from other websites and is rate-limited. |

Limits:

- The app does not prove that the person pressing "Check payments" is the merchant. Anyone with the link sees the same list. The link already shows the amount and merchant account, and deposit addresses are public on-chain, so little extra is revealed, but **treat a payment link like a receipt: share it only with the payer.**
- Records cannot be edited or deleted through the app. Only the project owner can remove them (Vercel dashboard or `vercel blob delete`).
- Merchant identity is proven by the NEAR wallet sign-in described in "Merchant sign-in" below. It does not change what the payment link shows.

### If the merchant clears browser data

| What | Where it lives | After clearing browser data |
|---|---|---|
| The money | The merchant's NEAR account, on-chain | **Not affected.** Always visible with "Check my NEAR account" (nearblocks) or any NEAR wallet. |
| Payment records (deposit address, amount, token, status) | Private Vercel Blob store, on the server | **Not affected.** |
| The "Saved invoices" list on the Create page | That browser's `localStorage` | **Gone from that browser.** |
| The payer's in-progress deposit on their own phone | The payer's browser `localStorage` | Gone from that browser only; reopening the link restores it from the server. |

**Easiest recovery: sign in again.** On the "My payments" page (`/payments`) the merchant signs in with the NEAR wallet and sees the full list of payments made to that account, with live status, with no link needed (payments recorded before the sign-in feature was added are not in this list; see "Merchant sign-in" limits). Without signing in, the records are found by the payment link itself, so the merchant needs the link again, for example from the WhatsApp chat where it was sent. Opening the link on the Pay page shows the latest payment state: an in-progress payment to continue, or "This invoice is already paid" with the receipt link. The full "Check payments" list per invoice is on the Create page, which needs the invoice in that browser's "Saved invoices"; after clearing, it is not there until the merchant creates or re-adds it. Nothing on the server or on-chain is lost. If the merchant no longer has the link anywhere, the server records cannot be looked up from the app, but the money and its transaction history stay visible in the merchant's NEAR account.

## Scope: what the app does not do

- No smart contract, by design. Settlement is only through 1Click.
- The app does not deploy to production, make the repository public, push to a remote, post on X, or submit to the hackathon API. Those are manual steps done by the project owner after explicit confirmation.
- No private keys or seed phrases are requested, stored or sent. No funds are held.

## Security
Protections on the hosted app and their limits:
- **Rate limit:** per client IP (first `x-forwarded-for` entry, else `x-real-ip`), `/api/quote` 30 requests per minute, other `/api/*` 120 per minute, HTTP 429 with `Retry-After`. It is in memory, so it is per server instance and resets on cold start. For stronger protection add a Vercel Firewall rate-limit rule.
- **Cross-site check:** an API request whose `Origin` host differs from the request host gets HTTP 403. This stops other websites from calling the API from a visitor's browser. It does not stop scripts or tools, which can omit or forge `Origin`.
- **Body cap:** `/api/quote` and `/api/deposit-submit` reject bodies over 10 KB with HTTP 413.
- **Headers:** Content-Security-Policy (same-origin only; `script-src` keeps `'unsafe-inline'` because Next.js inline bootstrap scripts are used without nonces), X-Frame-Options DENY, Referrer-Policy no-referrer, X-Content-Type-Options nosniff, Permissions-Policy, Strict-Transport-Security.
- **Error text:** payers see fixed messages, not upstream error text.
- **Check who you are paying:** anyone can create a link that pays their own account. Payers should confirm they know and trust the person who sent the link before paying.

## Testing status

Run on the current tree:

- `npm test`: **15 test files passed, 107 tests passed**, 0 failed.
- `npx playwright test`: **25 tests passed** (`tests/e2e/flow.spec.ts`, `csp.spec.ts` and `payments.spec.ts`, 360 px viewport, mocked API routes).
- `npm run typecheck` (`next typegen && tsc --noEmit`): no errors. Plain `tsc` on a fresh clone needs the generated route types first.
- `npx eslint .`: no errors.

Partly covered (the spec asks for more than the tests do):

- Req 11.4, poller sequences: the FAILED and KNOWN_DEPOSIT_TX sequences are not tested.
- Req 11.5, scenarios with no dedicated test: expired deadline, underpayment, overpayment refund, `refundReason`, HTTP 500 / network backoff, and empty hash arrays.
- Req 11.9, JWT leak check: there is no automated scan of the client bundle for the JWT. A manual canary build by the security validator found no leak.

Known non-blocking items:

- The INCOMPLETE_DEPOSIT view may show "not available" for the required minimum, because the status API does not return it.
- Quote errors show fixed plain-language text by status. Raw upstream messages are no longer shown to payers.

Not written: the optional property-based tests (`tests/property/` is empty) and the live read-only tests (`tests/live/` is empty). The real payment flow has not been run end to end.

## Validation

A specship validation run was done on 2026-11-14. A short summary is in [`VALIDATION.md`](../VALIDATION.md) at the repository root. The full working reports were kept out of the repository.

| Validator | Result |
|---|---|
| Integration | PASS |
| Security | PASS, 0 findings rated 7/10 or higher |
| Code | FAIL at the time of the run. Findings: a confirm loop after a price change, unguarded proxy routes when the server is unconfigured, a 401 on a private quote that blocked retry, and an unused `swapType` guard. All four are fixed and have regression tests. |
| Browser | FAIL at the time of the run (the same confirm loop). Fixed. |
| Design | FAIL: anti-slop score 8/15 and accessibility score 89 on `/pay`. Accepted as a known limitation. |
| Alignment | PARTIAL. The README and tagline items are fixed in this change: stale "e2e not written" text, the missing fallback-flag setup step, and the "private" tagline. |

Re-run after the fixes: the browser validator now passes, and the code validator found all four earlier code defects fixed. The code validator still flags the partial test coverage listed under Testing status.

Accepted limitations:

- Minimal visual design.
- No property-based tests and no live API tests.
- No real end-to-end payment has been run.
- Private mode is tested only with dry-run quotes; no private live quote or payment has been made.
- The payer still sees some technical words, such as "refund address" and chain names.

## Libraries and AI-assisted portions (hackathon rule Q-005)

The code in this repository was written with AI assistance (Kiro). A human reviews and owns the result.

| Item | Role |
|---|---|
| Next.js 16 and React 19 | App framework: pages and server route handlers that proxy 1Click. |
| TypeScript | Type checking. |
| `qrcode` | Renders QR codes for payment links and deposit addresses. |
| Vitest | Unit test runner. |
| fast-check | Property-based testing library (installed, no property tests written yet). |
| Playwright | End-to-end test runner (20 tests in `tests/e2e`). |
| tsx | Runs `scripts/check-1click.ts`. |
| ESLint, `eslint-config-next` | Linting. |
| NEAR Intents 1Click API | External service that quotes, swaps and delivers USDC. |

AI-assisted parts: all of `app/`, `components/`, `lib/`, `scripts/`, `tests/` and this README.

## License

MIT, see `LICENSE`.
