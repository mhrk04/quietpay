"use client";

import { useState } from "react";
import { encodeInvoice, buildStatusLink, type Invoice } from "@/lib/link-codec";
import { fromBaseUnits } from "@/lib/amount";
import { fetchDepositStatus, fetchInvoiceDeposits, type DepositRecord } from "@/lib/payments-client";
import { statusBadge, statusMessage } from "@/lib/status";
import { chainName } from "@/lib/tokens";

type Row = { deposit: DepositRecord; status: string | null };

/** Merchant view: payments the server recorded for one invoice, with live status. Loads on demand. */
export function InvoicePayments({ invoice }: { invoice: Invoice }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function check() {
    setBusy(true);
    setFailed(false);
    const deposits = await fetchInvoiceDeposits(encodeInvoice(invoice));
    if (!deposits) {
      setFailed(true);
      setBusy(false);
      return;
    }
    const statuses = await Promise.all(deposits.map((d) => fetchDepositStatus(d.depositAddress)));
    setRows(deposits.map((deposit, i) => ({ deposit, status: statuses[i] })));
    setBusy(false);
  }

  return (
    <div className="create-payments" role="group" aria-label="Payments">
      <button type="button" className="btn btn--sm" onClick={check} disabled={busy}>
        {busy ? "Checking…" : "Check payments"}
      </button>
      {failed && (
        <p className="notice notice--danger" role="alert">
          Could not load payments. Try again in a moment.
        </p>
      )}
      {rows && rows.length === 0 && <p className="create-hint">No payments started yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="stack-sm">
          {rows.map(({ deposit: d, status }) => (
            <li key={d.depositAddress} className="payment-line">
              <span>
                <strong className="tabular">
                  {fromBaseUnits(d.amountIn, d.origin.decimals)} {d.origin.symbol}
                </strong>{" "}
                on {chainName(d.origin.blockchain)}
              </span>
              <span>
                <span className={`badge badge--${statusBadge(status).tone}`}>
                  {status ? statusMessage(status) : "Checking payment"}
                </span>
              </span>
              <span className="create-hint">{new Date(d.createdAt).toLocaleString()}</span>
              <a
                href={buildStatusLink(window.location.origin, d.depositAddress, invoice, {
                  deadline: Date.parse(d.deadline),
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                View payment status
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
