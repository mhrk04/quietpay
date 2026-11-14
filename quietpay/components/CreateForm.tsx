"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { fromBaseUnits, toBaseUnits } from "@/lib/amount";
import { buildPayLink, validateInvoice, type Invoice } from "@/lib/link-codec";
import { isValidNearAccount } from "@/lib/near-account";
import { buildWhatsappUrl, paymentRequestMessage } from "@/lib/whatsapp";
import { CopyButton } from "./CopyButton";
import { InvoicePayments } from "./InvoicePayments";
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
  const uid = useId();
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
    <>
      <div className="create-grid">
        <section className="card" aria-label="New payment link">
          <h2>New payment link</h2>
          <form className="create-form" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor={`${uid}-amount`}>Amount (USDC)</label>
              <div className="input-affix">
                <input
                  id={`${uid}-amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="25.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? "create-amount-err" : undefined}
                />
                <span className="input-affix__suffix" aria-hidden="true">USDC</span>
              </div>
              {errors.amount && <span id="create-amount-err" className="field__error create-error" role="alert">{errors.amount}</span>}
            </div>
            <div className="field">
              <label htmlFor={`${uid}-account`}>Merchant NEAR account</label>
              <input
                id={`${uid}-account`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="shop.near"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                aria-invalid={!!errors.account}
                aria-describedby={errors.account ? "create-account-err" : `${uid}-account-hint`}
              />
              <span id={`${uid}-account-hint`} className="field__hint">The NEAR account that receives the USDC.</span>
              {errors.account && <span id="create-account-err" className="field__error create-error" role="alert">{errors.account}</span>}
            </div>
            <div className="field">
              <label htmlFor={`${uid}-desc`}>Description (optional)</label>
              <textarea
                id={`${uid}-desc`}
                rows={2}
                placeholder="Logo design deposit"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? "create-desc-err" : `${uid}-desc-hint`}
              />
              <span id={`${uid}-desc-hint`} className="field__hint">{remaining} characters left</span>
              {errors.description && <span id="create-desc-err" className="field__error create-error" role="alert">{errors.description}</span>}
            </div>
            <button type="submit" className="btn btn--primary btn--block">Create payment link</button>
          </form>
        </section>

        <div className="create-aside">
          {link ? (
            <section className="card create-result" aria-label="Your payment link">
              <h2>Your payment link</h2>
              {saveFailed && (
                <p className="notice notice--danger" role="alert">
                  We could not save this invoice on this device. The link below still works, so copy or share it now.
                </p>
              )}
              <p className="create-link create-break">{link.url}</p>
              <div className="create-qr">
                <QrCode value={link.url} label="QR code for the payment link" />
              </div>
              <div className="create-actions">
                <CopyButton value={link.url} label="link" />
                <a
                  className="btn btn--sm"
                  href={buildWhatsappUrl(paymentRequestMessage(link.invoice, link.url))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Share on WhatsApp
                </a>
              </div>
              <a className="small" href={nearblocks(link.invoice.account)} target="_blank" rel="noopener noreferrer">
                Check my NEAR account
              </a>
              <InvoicePayments invoice={link.invoice} />
              <p className="notice notice--info create-notice">
                The invoice is stored inside the link, so it works on any device. Anyone can edit a link, so always check that the amount you received is correct.
              </p>
            </section>
          ) : (
            <section className="card card--flat create-placeholder" aria-label="How it works">
              <h2>How it works</h2>
              <ol className="create-steps">
                <li>Fill in the amount and the NEAR account that should receive it.</li>
                <li>Send the link or QR code to your client, for example on WhatsApp.</li>
                <li>Your client pays with any token on any chain. You receive USDC.</li>
              </ol>
            </section>
          )}
        </div>
      </div>

      {stored.length > 0 && (
        <section className="stack" aria-label="Saved invoices">
          <h2>Saved invoices</h2>
          <ul className="create-list">
            {stored.map((inv) => {
              const url = buildPayLink(window.location.origin, inv);
              return (
                <li key={`${inv.createdAt}-${inv.account}-${inv.amount}`} className="create-item">
                  <span className="create-item__amount">{inv.amount} USDC</span>
                  <span className="small">to <span className="mono break">{inv.account}</span></span>
                  {inv.description && <span className="break">{inv.description}</span>}
                  <span className="create-hint">{new Date(inv.createdAt).toLocaleString()}</span>
                  <CopyButton value={url} label="link" />
                  <a className="small" href={nearblocks(inv.account)} target="_blank" rel="noopener noreferrer">
                    Check my NEAR account
                  </a>
                  <InvoicePayments invoice={inv} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
