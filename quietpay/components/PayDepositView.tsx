"use client";

import { useState } from "react";
import { Countdown } from "@/components/Countdown";
import { CopyButton } from "@/components/CopyButton";
import { QrCode } from "@/components/QrCode";
import { chainName } from "@/lib/tokens";
import { buildWhatsappUrl, trackingMessage, type WhatsappInvoice } from "@/lib/whatsapp";

type Props = {
  address: string;
  memo?: string;
  amountText: string;
  symbol: string;
  chain: string;
  deadlineMs: number;
  statusHref: string;
  invoice: WhatsappInvoice;
  resumed?: boolean;
  onStartOver?: () => void;
  onExpire: () => void;
};

const SUBMIT_TIMEOUT_MS = 10_000;

export function PayDepositView(p: Props) {
  const [hash, setHash] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function submit() {
    const txHash = hash.trim();
    if (!txHash) return;
    setSubmitState("sending");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/deposit-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, depositAddress: p.address, ...(p.memo ? { memo: p.memo } : {}) }),
        signal: ctrl.signal,
      });
      setSubmitState(res.ok ? "sent" : "failed");
    } catch {
      setSubmitState("failed");
    } finally {
      clearTimeout(timer);
    }
  }

  const chain = chainName(p.chain);
  return (
    <section className="card pay-card" aria-label="Payment instructions">
      <h2>Send your payment</h2>
      {p.resumed && (
        <p className="notice notice--info" role="status">
          <span>You already started this payment. Send to the same address below.</span>
          <span>
            <button type="button" className="btn btn--sm" onClick={p.onStartOver}>
              Start over with a new quote
            </button>
          </span>
        </p>
      )}
      <p className="notice notice--warning" role="note">
        Send only {p.symbol} on {chain}. Anything else may be lost.
      </p>
      <p className="pay-deadline">
        <span>Time left</span>
        <strong>
          <Countdown deadlineMs={p.deadlineMs} onExpire={p.onExpire} />
        </strong>
      </p>
      <div className="pay-qr">
        <QrCode value={p.address} label="QR code of the payment address" />
      </div>
      <div className="pay-field">
        <span className="pay-label">Amount to send</span>
        <strong className="pay-amount">
          {p.amountText} {p.symbol}
        </strong>
        <span className="small muted">on {chain}</span>
        <CopyButton value={p.amountText} label="amount" />
      </div>
      <div className="pay-field">
        <span className="pay-label">Payment address</span>
        <code className="pay-value pay-break">{p.address}</code>
        <CopyButton value={p.address} label="address" />
      </div>
      {p.memo && (
        <div className="pay-field">
          <span className="pay-label">Memo</span>
          <code className="pay-value pay-break">{p.memo}</code>
          <CopyButton value={p.memo} label="memo" />
          <p className="notice notice--danger" role="alert">
            You must include this memo. If you leave it out, your funds are lost.
          </p>
        </div>
      )}
      <a className="btn btn--primary btn--block" href={p.statusHref} target="_blank" rel="noopener noreferrer">
        Track this payment
      </a>
      <a
        className="btn btn--block"
        href={buildWhatsappUrl(trackingMessage(p.invoice, p.statusHref))}
        target="_blank"
        rel="noopener noreferrer"
      >
        Send tracking link to the merchant on WhatsApp
      </a>
      <div className="stack-sm">
        <label className="field">
          Transaction ID (optional)
          <input
            value={hash}
            onChange={(e) => {
              setHash(e.target.value);
              if (submitState !== "sending") setSubmitState("idle");
            }}
            placeholder="Paste it after you send"
            autoComplete="off"
          />
          <span className="field__hint">The ID your wallet shows after you send. It helps us spot your payment faster.</span>
        </label>
        <button type="button" className="btn" onClick={submit} disabled={!hash.trim() || submitState === "sending"}>
          {submitState === "failed" ? "Try sending the ID again" : "Send ID to speed things up"}
        </button>
        <span role="status" aria-live="polite" className="small">
          {submitState === "sent" && "Transaction ID received."}
          {submitState === "failed" &&
            "Could not send the ID. We are still watching for your payment. You can try again."}
        </span>
      </div>
    </section>
  );
}
