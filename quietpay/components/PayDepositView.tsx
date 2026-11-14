"use client";

import { useState } from "react";
import { Countdown } from "@/components/Countdown";
import { CopyButton } from "@/components/CopyButton";
import { QrCode } from "@/components/QrCode";
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

  return (
    <section className="pay-card" aria-label="Payment instructions">
      <h2>Send your payment</h2>
      {p.resumed && (
        <p role="status">
          You already started this payment. Send to the same address below.{" "}
          <button type="button" className="pay-secondary" onClick={p.onStartOver}>
            Start over with a new quote
          </button>
        </p>
      )}
      <p className="pay-warning" role="note">
        Send only {p.symbol} on {p.chain}. Anything else may be lost.
      </p>
      <p>
        Time left: <strong><Countdown deadlineMs={p.deadlineMs} onExpire={p.onExpire} /></strong>
      </p>
      <QrCode value={p.address} label="QR code of the payment address" />
      <div className="pay-field">
        <span className="pay-label">Amount to send</span>
        <strong className="pay-value">{p.amountText} {p.symbol}</strong>
        <span>on {p.chain}</span>
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
          <p className="pay-warning" role="alert">
            You must include this memo. If you leave it out, your funds are lost.
          </p>
        </div>
      )}
      <a className="button" href={p.statusHref} target="_blank" rel="noopener noreferrer">
        Track this payment
      </a>
      <a
        className="button"
        href={buildWhatsappUrl(trackingMessage(p.invoice, p.statusHref))}
        target="_blank"
        rel="noopener noreferrer"
      >
        Send tracking link to the merchant on WhatsApp
      </a>
      <div className="pay-field">
        <label>
          Transaction hash (optional)
          <input
            value={hash}
            onChange={(e) => {
              setHash(e.target.value);
              if (submitState !== "sending") setSubmitState("idle");
            }}
            placeholder="Paste it after you send"
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={submit} disabled={!hash.trim() || submitState === "sending"}>
          {submitState === "failed" ? "Try sending the hash again" : "Send hash to speed things up"}
        </button>
        <span role="status" aria-live="polite">
          {submitState === "sent" && "Hash received."}
          {submitState === "failed" &&
            "Could not send the hash. We are still watching for your payment. You can try again."}
        </span>
      </div>
    </section>
  );
}
