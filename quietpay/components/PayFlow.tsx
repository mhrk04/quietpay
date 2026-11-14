"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fromBaseUnits } from "@/lib/amount";
import {
  clearActiveDeposit,
  loadActiveDeposit,
  saveActiveDeposit,
  type ActiveDeposit,
} from "@/lib/active-deposit";
import { buildStatusLink, decodeInvoice } from "@/lib/link-codec";
import {
  amountInChanged,
  buildQuoteRequest,
  prepareQuoteBody,
  checkQuoteAmountOut,
  readDeadline,
  readDepositAddress,
  readDepositMemo,
  readTimeEstimate,
  QUOTE_WINDOW_MS,
  type PartialQuoteResponse,
  type QuoteRequest,
} from "@/lib/quote";
import { quoteErrorMessage } from "@/lib/quote-errors";
import { isValidRefundAddress } from "@/lib/refund-address";
import {
  chainName,
  findDestinationToken,
  getCachedTokens,
  setCachedTokens,
  type TokenInfo,
} from "@/lib/tokens";
import { classifyDeposits, fetchInvoiceDeposits, type Classified } from "@/lib/payments-client";
import { Checkout } from "@/components/Checkout";
import { PayDepositView } from "@/components/PayDepositView";
import { TokenPicker } from "@/components/TokenPicker";

type Mode = "confidential" | "public" | "unconfigured";
type Quote = NonNullable<PartialQuoteResponse["quote"]>;
type Phase = "select" | "dry" | "reconfirm" | "deposit" | "expired";
type Action = "dry" | "live";

const TOKEN_TIMEOUT_MS = 10_000;
const QUOTE_TIMEOUT_MS = 15_000;

async function fetchJson(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function formatEstimate(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  return `about ${Math.round(seconds / 60)} minutes`;
}

function amountFor(base: string | undefined, token: TokenInfo): string {
  if (!base || !/^\d+$/.test(base)) return "?";
  return fromBaseUnits(base, token.decimals);
}

export function PayFlow() {
  const params = useSearchParams();
  const encoded = params.get("i") ?? "";
  const decoded = useMemo(() => decodeInvoice(encoded), [encoded]);
  const invoice = decoded.ok ? decoded.value : null;

  const [mode, setMode] = useState<Mode | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [tokensError, setTokensError] = useState(false);
  const [tokenTry, setTokenTry] = useState(0);

  const [origin, setOrigin] = useState<TokenInfo | undefined>();
  const [refund, setRefund] = useState("");
  const [refundError, setRefundError] = useState("");

  const [phase, setPhase] = useState<Phase>("select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState<Action | null>(null);
  const [request, setRequest] = useState<QuoteRequest | null>(null);
  const [dryQuote, setDryQuote] = useState<Quote | null>(null);
  const [dryResp, setDryResp] = useState<PartialQuoteResponse | null>(null);
  const [liveResp, setLiveResp] = useState<PartialQuoteResponse | null>(null);
  const [liveDeadline, setLiveDeadline] = useState<string | null>(null);

  const [resumed, setResumed] = useState<ActiveDeposit | null>(null);
  // Earlier payments for this invoice recorded by the server (any device).
  const [remote, setRemote] = useState<Classified | null>(null);
  const [remoteDone, setRemoteDone] = useState(false);
  const [continued, setContinued] = useState(false);
  const destination = useMemo(() => (tokens ? findDestinationToken(tokens) : undefined), [tokens]);

  // Resume an unexpired deposit for this invoice (localStorage is only readable after mount).
  useEffect(() => {
    if (!invoice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setResumed(loadActiveDeposit(encoded));
  }, [invoice, encoded]);
  // Ask the server for earlier payments; any failure falls back to the normal flow.
  useEffect(() => {
    if (!invoice) return;
    if (loadActiveDeposit(encoded)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- local resume takes precedence
      setRemoteDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const deposits = await fetchInvoiceDeposits(encoded);
        if (cancelled) return;
        if (deposits && deposits.length > 0) setRemote(await classifyDeposits(deposits));
      } catch {
        // ignore: normal flow
      }
      if (!cancelled) setRemoteDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice, encoded]);
  // Save the active deposit once the deposit view is shown.
  useEffect(() => {
    if (phase !== "deposit" || !origin || !request || !liveResp) return;
    const address = readDepositAddress(liveResp);
    const amountIn = liveResp.quote?.amountIn;
    if (!address || !amountIn || !invoice) return;
    const q = readDeadline(liveResp);
    const deadlineMs = q ? Date.parse(q) : Date.parse(liveDeadline ?? request.deadline);
    if (!Number.isFinite(deadlineMs)) return;
    saveActiveDeposit(encoded, {
      address,
      memo: readDepositMemo(liveResp),
      amountIn,
      origin: { symbol: origin.symbol, blockchain: origin.blockchain, decimals: origin.decimals, assetId: origin.assetId },
      refund: request.refundTo,
      deadlineMs,
      statusHref: buildStatusLink(window.location.origin, address, invoice, { refund: request.refundTo, deadline: deadlineMs }),
    });
  }, [phase, origin, request, liveResp, liveDeadline, encoded, invoice]);
  // Config (only for valid links).
  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    fetchJson("/api/config", undefined, TOKEN_TIMEOUT_MS)
      .then((r) => {
        if (cancelled) return;
        const m = (r.body as { mode?: unknown } | null)?.mode;
        if (r.status === 200 && (m === "confidential" || m === "public" || m === "unconfigured")) {
          setMode(m);
        } else {
          setConfigFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setConfigFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  // Tokens (only when configured).
  useEffect(() => {
    if (!invoice || (mode !== "confidential" && mode !== "public")) return;
    let cancelled = false;
    const cached = getCachedTokens();
    if (cached) {
      queueMicrotask(() => {
        if (!cancelled) setTokens(cached);
      });
      return () => {
        cancelled = true;
      };
    }
    fetchJson("/api/tokens", undefined, TOKEN_TIMEOUT_MS)
      .then((r) => {
        if (cancelled) return;
        if (r.status === 200 && Array.isArray(r.body)) {
          const list = r.body as TokenInfo[];
          setCachedTokens(list);
          setTokens(list);
          setTokensError(false);
        } else {
          setTokensError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setTokensError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice, mode, tokenTry]);

  const retryTokens = () => {
    setTokensError(false);
    setTokenTry((n) => n + 1);
  };

  async function postQuote(
    req: QuoteRequest,
  ): Promise<{ ok: true; resp: PartialQuoteResponse } | { ok: false; message: string; retry: boolean }> {
    if (!invoice) return { ok: false, message: "Invalid link.", retry: false };
    const prepared = prepareQuoteBody(req);
    if (!prepared.ok) return { ok: false, message: prepared.error, retry: false };
    let r;
    try {
      r = await fetchJson(
        "/api/quote",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-quietpay-invoice": encoded },
          body: prepared.body,
        },
        QUOTE_TIMEOUT_MS,
      );
    } catch {
      return { ok: false, message: quoteErrorMessage("network"), retry: true };
    }
    if (r.status === 401 && mode === "confidential") {
      return {
        ok: false,
        message: quoteErrorMessage(401),
        retry: true,
      };
    }
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, message: quoteErrorMessage(r.status), retry: true };
    }
    const resp = r.body as PartialQuoteResponse | null;
    const quote = resp?.quote;
    if (!quote || typeof quote.amountIn !== "string") {
      return { ok: false, message: "The quote was incomplete. Please try again.", retry: true };
    }
    const check = checkQuoteAmountOut(invoice, quote);
    if (!check.ok) {
      return {
        ok: false,
        message: "Amount mismatch: this quote does not match the invoice amount, so it was rejected.",
        retry: false,
      };
    }
    return { ok: true, resp };
  }

  async function requestDry() {
    if (!invoice || !origin || !destination) return;
    if (!isValidRefundAddress(origin.blockchain, refund.trim())) {
      setRefundError(`Your address for refunds: enter a valid ${chainName(origin.blockchain)} address.`);
      return;
    }
    setRefundError("");
    setError("");
    setRetryAction(null);
    setBusy(true);
    const req = buildQuoteRequest({
      invoice,
      origin,
      refundTo: refund.trim(),
      destination,
      dry: true,
    });
    const r = await postQuote(req);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setRetryAction(r.retry ? "dry" : null);
      return;
    }
    setRequest(req);
    setDryResp(r.resp);
    setDryQuote(r.resp.quote as Quote);
    setPhase("dry");
  }

  async function requestLive() {
    if (!invoice || !request || !dryQuote || busy) return;
    // Second confirm after a price change: use the stored live quote (it already has an address).
    if (phase === "reconfirm" && liveResp && readDepositAddress(liveResp)) {
      const stored = readDeadline(liveResp);
      const storedMs = stored ? Date.parse(stored) : Date.parse(liveDeadline ?? request.deadline);
      if (storedMs > Date.now()) {
        setError("");
        setPhase("deposit");
        return;
      }
    }
    const baseline = phase === "reconfirm" && liveResp ? liveResp.quote : dryQuote;
    setBusy(true);
    setError("");
    setRetryAction(null);
    // Same parameters as the dry quote; only refresh the deadline if it is nearly over.
    const left = Date.parse(request.deadline) - Date.now();
    const deadline =
      left < QUOTE_WINDOW_MS / 3 ? new Date(Date.now() + QUOTE_WINDOW_MS).toISOString() : request.deadline;
    const r = await postQuote({ ...request, dry: false, deadline });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setRetryAction(r.retry ? "live" : null);
      return;
    }
    if (!readDepositAddress(r.resp)) {
      setError("The quote had no payment address. Please try again.");
      setRetryAction("live");
      return;
    }
    setLiveResp(r.resp);
    setLiveDeadline(deadline);
    setPhase(amountInChanged(baseline, r.resp.quote) ? "reconfirm" : "deposit");
  }

  const onExpire = useCallback(() => {
    clearActiveDeposit(encoded);
    setPhase("expired");
  }, [encoded]);
  const onResumedExpire = useCallback(() => {
    clearActiveDeposit(encoded);
    setResumed(null);
    setPhase("select");
  }, [encoded]);
  const startOver = useCallback(() => {
    clearActiveDeposit(encoded);
    setResumed(null);
    setPhase("select");
  }, [encoded]);

  function newQuote() {
    setLiveResp(null);
    setDryQuote(null);
    setDryResp(null);
    setRequest(null);
    setError("");
    setPhase("select");
    void requestDry();
  }

  if (!invoice) {
    return (
      <section className="card pay-card" role="alert">
        <h2>Invalid link</h2>
        <p>This payment link is not valid. Ask the person who sent it for a new one.</p>
      </section>
    );
  }

  if (resumed) {
    const amountText = fromBaseUnits(resumed.amountIn, resumed.origin.decimals);
    return (
      <Checkout invoice={invoice} step={3}>
        <PayDepositView
          address={resumed.address}
          memo={resumed.memo}
          amountText={amountText}
          symbol={resumed.origin.symbol}
          chain={resumed.origin.blockchain}
          deadlineMs={resumed.deadlineMs}
          statusHref={buildStatusLink(window.location.origin, resumed.address, invoice, {
            refund: resumed.refund,
            deadline: resumed.deadlineMs,
          })}
          invoice={invoice}
          resumed
          onStartOver={startOver}
          onExpire={onResumedExpire}
        />
      </Checkout>
    );
  }
  if (remote?.kind === "paid") {
    const d = remote.deposit;
    return (
      <Checkout invoice={invoice}>
        <section className="card pay-card" aria-label="Already paid">
          <h2>This invoice is already paid</h2>
          <p>A payment for this invoice was completed. No new payment is needed.</p>
          <a
            className="btn btn--primary"
            href={buildStatusLink(window.location.origin, d.depositAddress, invoice, { deadline: Date.parse(d.deadline) })}
          >
            View the receipt
          </a>
        </section>
      </Checkout>
    );
  }
  if (remote?.kind === "pending" && continued) {
    const d = remote.deposit;
    const deadlineMs = Date.parse(d.deadline);
    return (
      <Checkout invoice={invoice} step={3}>
        <PayDepositView
          address={d.depositAddress}
          memo={d.depositMemo ?? undefined}
          amountText={fromBaseUnits(d.amountIn, d.origin.decimals)}
          symbol={d.origin.symbol}
          chain={d.origin.blockchain}
          deadlineMs={deadlineMs}
          statusHref={buildStatusLink(window.location.origin, d.depositAddress, invoice, { deadline: deadlineMs })}
          invoice={invoice}
          resumed
          onStartOver={() => {
            setContinued(false);
            setRemote(null);
          }}
          onExpire={() => {
            setContinued(false);
            setRemote(null);
          }}
        />
      </Checkout>
    );
  }
  if (remote?.kind === "pending") {
    return (
      <Checkout invoice={invoice}>
        <section className="card pay-card" aria-label="Payment already started">
          <h2>A payment was already started for this invoice</h2>
          <p>You can continue with it, or start a new one.</p>
          <button type="button" className="btn btn--primary" onClick={() => setContinued(true)}>
            Continue with this payment
          </button>
          <button type="button" className="btn" onClick={() => setRemote(null)}>
            Start a new payment
          </button>
        </section>
      </Checkout>
    );
  }
  if (!remoteDone) {
    return (
      <Checkout invoice={invoice}>
        <p className="muted" role="status">
          <span className="spinner" aria-hidden="true" /> Checking for earlier payments…
        </p>
      </Checkout>
    );
  }
  if (mode === "unconfigured") {
    return (
      <Checkout invoice={invoice}>
        <p className="notice notice--danger" role="alert">
          Payments are not set up on this server. The owner must add a partner key or enable standard payments.
        </p>
      </Checkout>
    );
  }

  const label =
    mode === "confidential" ? (
      <p className="private-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>
          <strong>Private payment</strong>. Your deposit cannot be linked to the payout on-chain. The merchant account and
          USDC amount stay visible on NEAR.
        </span>
      </p>
    ) : mode === "public" ? (
      <p className="notice notice--info">
        <strong>Standard payment (not private)</strong>
      </p>
    ) : null;

  const live = liveResp?.quote;
  const liveAddress = readDepositAddress(liveResp);
  const requestedDeadlineMs = Date.parse(liveDeadline ?? request?.deadline ?? "");
  const quoteDeadline = readDeadline(liveResp);
  const deadlineMs = quoteDeadline ? Date.parse(quoteDeadline) : requestedDeadlineMs;

  if (phase === "deposit" && origin && live && liveAddress) {
    const statusHref = buildStatusLink(window.location.origin, liveAddress, invoice, {
      refund: request?.refundTo,
      deadline: deadlineMs,
    });
    return (
      <Checkout invoice={invoice} step={3}>
        {label}
        <PayDepositView
          address={liveAddress}
          memo={readDepositMemo(liveResp)}
          amountText={amountFor(live.amountIn, origin)}
          symbol={origin.symbol}
          chain={origin.blockchain}
          deadlineMs={deadlineMs}
          statusHref={statusHref}
          invoice={invoice}
          onExpire={onExpire}
        />
      </Checkout>
    );
  }

  if (phase === "expired") {
    return (
      <Checkout invoice={invoice}>
        <section className="card pay-card" role="alert">
          <h2>This quote has expired</h2>
          <p>Do not send anything to the old address. Get a new quote to continue.</p>
          <button type="button" className="btn btn--primary" onClick={newQuote} disabled={busy}>
            Get a new quote
          </button>
        </section>
        {error && <p className="notice notice--danger" role="alert">{error}</p>}
      </Checkout>
    );
  }

  const quoteView =
    (phase === "dry" || phase === "reconfirm") && origin && destination && dryQuote ? (
      <section className="card pay-card" aria-label="Quote">
        {phase === "reconfirm" && live ? (
          <>
            <h2>The price changed</h2>
            <p>
              You will now send <strong>{amountFor(live.amountIn, origin)} {origin.symbol}</strong> (it was{" "}
              {amountFor(dryQuote.amountIn, origin)} {origin.symbol}). Confirm again to get your payment address.
            </p>
            <p>Minimum accepted: {amountFor(live.minAmountIn, origin)} {origin.symbol}</p>
          </>
        ) : (
          <>
            <h2>Your quote</h2>
            <div className="quote-rows">
              <div className="quote-row quote-row--total">
                <span>You send</span>
                <strong>{amountFor(dryQuote.amountIn, origin)} {origin.symbol}</strong>
              </div>
              <div className="quote-row">
                <span>On</span>
                <strong>{chainName(origin.blockchain)}</strong>
              </div>
              <div className="quote-row">
                <span>Minimum accepted</span>
                <span className="tabular">{amountFor(dryQuote.minAmountIn, origin)} {origin.symbol}</span>
              </div>
              <div className="quote-row">
                <span>Merchant receives</span>
                <strong>{invoice.amount} {destination.symbol}</strong>
              </div>
              {readTimeEstimate(dryResp) !== undefined && (
                <div className="quote-row">
                  <span>Estimated time</span>
                  <span>{formatEstimate(readTimeEstimate(dryResp) as number)}</span>
                </div>
              )}
            </div>
          </>
        )}
        <button type="button" className="btn btn--primary btn--block" onClick={requestLive} disabled={busy}>
          {busy ? "Getting your address…" : "Confirm and get payment address"}
        </button>
        <button type="button" className="btn btn--block" onClick={() => setPhase("select")} disabled={busy}>
          Change token
        </button>
      </section>
    ) : null;

  return (
    <Checkout invoice={invoice} step={phase === "select" ? 1 : 2}>
      {label}
      {configFailed && (
        <p className="notice notice--danger" role="alert">
          Could not check the server setup. Reload the page to try again.
        </p>
      )}
      {mode && tokensError && (
        <div className="notice notice--danger" role="alert">
          <p>We could not load the list of tokens.</p>
          <button type="button" className="btn btn--sm" onClick={retryTokens}>Try again</button>
        </div>
      )}
      {mode && !tokens && !tokensError && (
        <div className="card" role="status">
          <p className="muted">Loading tokens…</p>
          <span className="skeleton skeleton--text" />
          <span className="skeleton skeleton--text" />
        </div>
      )}
      {tokens && !destination && (
        <p className="notice notice--danger" role="alert">Payments to this merchant are not available right now.</p>
      )}
      {tokens && destination && phase === "select" && (
        <section className="card pay-card" aria-label="Choose how to pay">
          <h2>Choose how to pay</h2>
          <TokenPicker tokens={tokens} selected={origin} onSelect={setOrigin} />
          <div className="stack-sm">
            <label className="field">
              {origin ? `Your address on ${chainName(origin.blockchain)} for refunds` : "Your address for refunds"}
              <input
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
                placeholder={origin ? `Your ${chainName(origin.blockchain)} address` : "Choose a token first"}
                autoComplete="off"
                aria-invalid={refundError ? true : undefined}
                aria-describedby="refund-hint"
              />
            </label>
            <p id="refund-hint" className="pay-hint">
              {origin ? `You are paying with ${origin.symbol} on ${chainName(origin.blockchain)}. ` : ""}
              Used only if the payment cannot go through. Your money is sent back to this address.
            </p>
          </div>
          {refundError && <p className="notice notice--danger" role="alert">{refundError}</p>}
          <button type="button" className="btn btn--primary btn--block" onClick={requestDry} disabled={!origin || busy}>
            {busy ? "Getting your quote…" : "See what I will pay"}
          </button>
        </section>
      )}
      {quoteView}
      {error && (
        <div className="notice notice--danger" role="alert">
          <p>{error}</p>
          {retryAction && (
            <button type="button" className="btn btn--sm" onClick={retryAction === "dry" ? requestDry : requestLive} disabled={busy}>
              Try again
            </button>
          )}
        </div>
      )}
    </Checkout>
  );
}
