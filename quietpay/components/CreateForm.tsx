"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fromBaseUnits, toBaseUnits } from "@/lib/amount";
import { buildPayLink, validateInvoice, type Invoice } from "@/lib/link-codec";
import { isValidNearAccount } from "@/lib/near-account";
import { buildWhatsappUrl, paymentRequestMessage } from "@/lib/whatsapp";
import { CopyButton } from "./CopyButton";
import { QrCode } from "./QrCode";

const KEY = "quietpay:invoices";
const MAX_DESC = 140;
const nearblocks = (account: string) => `https://nearblocks.io/address/${encodeURIComponent(account)}`;
type Errors = { amount?: string; account?: string; description?: string };

function loadInvoices(): Invoice[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const r = validateInvoice(x);
      return r.ok ? [r.value] : [];
    });
  } catch {
    return [];
  }
}

export function CreateForm() {
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [link, setLink] = useState<{ invoice: Invoice; url: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [stored, setStored] = useState<Invoice[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setStored(loadInvoices());
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const acct = account.trim();
    const base = toBaseUnits(amount.trim());
    if (!base.ok) next.amount = `Amount: ${base.error}`;
    if (!isValidNearAccount(acct)) {
      next.account = "Merchant NEAR account: enter a valid account such as shop.near";
    }
    if (Array.from(description).length > MAX_DESC) {
      next.description = "Description: use 140 characters or fewer";
    }
    if (!base.ok || next.account || next.description) {
      setErrors(next);
      return;
    }
    const invoice: Invoice = {
      amount: fromBaseUnits(base.value),
      account: acct,
      description,
      createdAt: Date.now(),
    };
    const checked = validateInvoice(invoice);
    if (!checked.ok) {
      const field = checked.error.split(":")[0];
      setErrors(
        field === "amount"
          ? { amount: "Amount: must be at most 999999999.999999" }
          : { description: "Description: could not be used, please change it" },
      );
      return;
    }
    setErrors({});
    setLink({ invoice, url: buildPayLink(window.location.origin, invoice) });
    try {
      const updated = [invoice, ...loadInvoices()];
      localStorage.setItem(KEY, JSON.stringify(updated));
      setStored(updated);
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }

  const remaining = MAX_DESC - Array.from(description).length;

  return (
    <div className="create-wrap">
      <form className="create-form" onSubmit={onSubmit} noValidate>
        <label className="create-field">
          <span>Amount (USDC)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? "create-amount-err" : undefined}
          />
          {errors.amount && <span id="create-amount-err" className="create-error" role="alert">{errors.amount}</span>}
        </label>
        <label className="create-field">
          <span>Merchant NEAR account</span>
          <input
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="shop.near"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            aria-invalid={!!errors.account}
            aria-describedby={errors.account ? "create-account-err" : undefined}
          />
          {errors.account && <span id="create-account-err" className="create-error" role="alert">{errors.account}</span>}
        </label>
        <label className="create-field">
          <span>Description (optional)</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "create-desc-err" : undefined}
          />
          <span className="create-hint">{remaining} characters left</span>
          {errors.description && <span id="create-desc-err" className="create-error" role="alert">{errors.description}</span>}
        </label>
        <button type="submit">Create payment link</button>
      </form>

      {link && (
        <section className="create-result" aria-label="Your payment link">
          <h2>Your payment link</h2>
          {saveFailed && (
            <p className="create-error" role="alert">
              We could not save this invoice on this device. The link below still works, so copy or share it now.
            </p>
          )}
          <p className="create-break">{link.url}</p>
          <QrCode value={link.url} label="QR code for the payment link" />
          <CopyButton value={link.url} label="link" />
          <a
            className="create-wa"
            href={buildWhatsappUrl(paymentRequestMessage(link.invoice, link.url))}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp
          </a>
          <a href={nearblocks(link.invoice.account)} target="_blank" rel="noopener noreferrer">
            Check my NEAR account
          </a>
          <p className="create-notice">
            The invoice is stored inside the link, so it works on any device. Anyone can edit a link, so always check that the amount you received is correct.
          </p>
        </section>
      )}

      {stored.length > 0 && (
        <section aria-label="Saved invoices">
          <h2>Saved invoices</h2>
          <ul className="create-list">
            {stored.map((inv) => {
              const url = buildPayLink(window.location.origin, inv);
              return (
                <li key={`${inv.createdAt}-${inv.account}-${inv.amount}`} className="create-item">
                  <strong>{inv.amount} USDC</strong> to {inv.account}
                  {inv.description && <span className="create-break"> – {inv.description}</span>}
                  <span className="create-hint">{new Date(inv.createdAt).toLocaleString()}</span>
                  <CopyButton value={url} label="link" />
                  <a href={nearblocks(inv.account)} target="_blank" rel="noopener noreferrer">
                    Check my NEAR account
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
