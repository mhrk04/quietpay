"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { buildPayLink, parseStatusLink } from "@/lib/link-codec";
import { createPoller, type PollerDeps, type PollerView, type StatusBody } from "@/lib/poller";
import { refundReasonText, statusBadge, statusMessage } from "@/lib/status";
import { buildReceiptShareUrl, buildWhatsappUrl, statusOnlyMessage } from "@/lib/whatsapp";
import { CopyButton } from "@/components/CopyButton";
import { Receipt, TxLinks, safeTxLinks } from "@/components/Receipt";

const EXPLORER_URL = "https://explorer.near-intents.org";

type Details = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Prefer a human-readable amount field, fall back to the raw value. */
function amountText(d: Details, key: string): string | undefined {
  return str(d[`${key}Formatted`]) ?? str(d[key]);
}

function realDeps(): PollerDeps {
  return {
    async fetchStatus(addr, signal) {
      const res = await fetch(`/api/status?depositAddress=${encodeURIComponent(addr)}`, {
        signal,
        cache: "no-store",
      });
      let body: StatusBody | undefined;
      try {
        body = (await res.json()) as StatusBody;
      } catch {
        body = undefined;
      }
      return { httpStatus: res.status, body };
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isVisible: () => document.visibilityState !== "hidden",
  };
}

export default function StatusView() {
  const search = useSearchParams();
  const key = search.toString();
  const parsed = useMemo(() => parseStatusLink(new URLSearchParams(key)), [key]);

  const [view, setView] = useState<PollerView>({ stopped: false });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [seenCompleteAt, setSeenCompleteAt] = useState<Date | null>(null);
  const statusUrl = useSyncExternalStore(
    () => () => {},
    () => window.location.href,
    () => "",
  );

  const address = parsed.ok ? parsed.value.address : undefined;
  const deadline = parsed.ok ? parsed.value.deadline : undefined;

  useEffect(() => {
    if (!address) return;
    const poller = createPoller(address, deadline, realDeps(), (v) => {
      setView(v);
      if (v.status === "SUCCESS") setSeenCompleteAt((prev) => prev ?? new Date());
    });
    const onVis = () => poller.onVisibilityChange();
    document.addEventListener("visibilitychange", onVis);
    poller.start();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      poller.stop();
    };
  }, [address, deadline]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!parsed.ok) {
    return (
      <>
        <h1>Payment status</h1>
        <p role="alert" className="status-error">
          This link is not valid. Ask the sender for a new link.
        </p>
      </>
    );
  }

  const { invoice, refund } = parsed.value;
  const status = view.status;
  const data = view.data;
  const details: Details = (data?.swapDetails as Details | undefined) ?? {};
  const updatedAt = str((data as Record<string, unknown> | undefined)?.updatedAt);

  const windowClosed =
    view.notice === "window-closed" ||
    (deadline !== undefined && nowMs >= deadline && (status === undefined || status === "PENDING_DEPOSIT"));

  const heading = status ? statusMessage(status) : "Checking payment";

  let completedAt: Date | null = null;
  if (status === "SUCCESS") {
    const parsedDate = updatedAt ? new Date(updatedAt) : null;
    if (parsedDate && !Number.isNaN(parsedDate.getTime())) completedAt = parsedDate;
    else completedAt = seenCompleteAt ?? new Date(nowMs);
  }

  const showDeposit =
    !windowClosed &&
    deadline !== undefined &&
    nowMs < deadline &&
    (status === undefined || status === "PENDING_DEPOSIT");
  const payHref = buildPayLink(statusUrl ? new URL(statusUrl).origin : "", invoice);
  const destLinks = safeTxLinks(details.destinationChainTxHashes);
  const originLinks = safeTxLinks(details.originChainTxHashes);

  const shareUrl =
    status === "SUCCESS"
      ? buildReceiptShareUrl(invoice, statusUrl)
      : buildWhatsappUrl(statusOnlyMessage(statusUrl, status ?? "PENDING_DEPOSIT"));

  return (
    <>
      <h1>Payment status</h1>
      <section className="status-card status-hero" aria-live="polite">
        <p className="status-main">
          <span className={`badge badge--lg badge--${status ? statusBadge(status).tone : "neutral"}`}>{heading}</span>
        </p>
        <p className="status-amount tabular">{invoice.amount} USDC</p>
        <p className="status-sub">
          to <span className="status-break mono">{invoice.account}</span>
        </p>
      </section>

      {showDeposit && (
        <section className="status-card" aria-label="Deposit address">
          <p>Deposit address</p>
          <code className="status-break break-all">{address}</code>
          <CopyButton value={address as string} label="address" />
          <a href={payHref}>Back to payment instructions</a>
        </section>
      )}
      {view.notice === "connection-problem" && (
        <p role="status" className="status-notice">
          Connection problem, retrying
        </p>
      )}
      {view.notice === "not-found" && (
        <p role="status" className="status-notice">
          Payment not found
        </p>
      )}
      {windowClosed && (
        <p role="status" className="status-notice">
          Payment window closed
        </p>
      )}
      {view.notice === "slow-processing" && (
        <p role="status" className="status-notice">
          This is taking longer than usual. Keep this deposit address: <code className="status-break">{address}</code>.{" "}
          <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer">
            Check the payment on the explorer
          </a>
        </p>
      )}

      {status === "SUCCESS" && completedAt && (
        <>
          <section className="status-card">
            <p>Amount delivered: {invoice.amount} USDC</p>
            <p>
              Merchant account: <span className="status-break">{invoice.account}</span>
            </p>
          </section>
          <Receipt invoice={invoice} completedAt={completedAt} links={destLinks} />
        </>
      )}

      {status === "REFUNDED" && (
        <section className="status-card">
          <p>Refunded amount: {amountText(details, "refundedAmount") ?? "not available"}</p>
          {refund && (
            <p>
              Returned to: <span className="status-break">{refund}</span>
            </p>
          )}
          <p>Reason: {refundReasonText(str(details.refundReason))}</p>
          <TxLinks links={originLinks} label="View original payment" />
        </section>
      )}

      {status === "INCOMPLETE_DEPOSIT" && (
        <section className="status-card">
          <p>Amount received: {amountText(details, "depositedAmount") ?? "not available"}</p>
          <p>Amount needed: {amountText(details, "amountIn") ?? "not available"}</p>
          <p>Contact the merchant, or wait for the payment to be returned to you.</p>
        </section>
      )}

      {status === "FAILED" && (
        <section className="status-card">
          {str(details.refundReason) && <p>Reason: {refundReasonText(str(details.refundReason))}</p>}
          <p>
            If you contact support, keep this deposit address: <code className="status-break">{address}</code>
          </p>
        </section>
      )}

      <a className="btn btn--primary btn--block" href={shareUrl} target="_blank" rel="noopener noreferrer">
        {status === "SUCCESS" ? "Share receipt on WhatsApp" : "Share status on WhatsApp"}
      </a>
    </>
  );
}
