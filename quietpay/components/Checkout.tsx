import type { ReactNode } from "react";

type Step = 1 | 2 | 3;
const STEPS = ["Pick a token", "Check the price", "Send the payment"];

/** Two-column checkout (like a payment link): amount hero and steps on the left, the current step on the right. */
export function Checkout({
  invoice,
  step,
  children,
}: {
  invoice: { amount: string; account: string; description: string };
  step?: Step;
  children: ReactNode;
}) {
  return (
    <div className="checkout">
      <div className="checkout__summary">
        <section className="card checkout-hero" aria-label="Invoice">
          <span className="checkout-hero__label">Amount due</span>
          <strong className="checkout-hero__amount">
            {invoice.amount} <span className="checkout-hero__unit">USDC</span>
          </strong>
          {invoice.description && <p className="checkout-hero__desc break">{invoice.description}</p>}
          <div className="checkout-hero__merchant">
            <span className="muted">Paying to</span>
            <code className="break-all">{invoice.account}</code>
          </div>
          {step && (
            <ol className="steps" aria-label="Steps">
              {STEPS.map((label, i) => (
                <li
                  key={label}
                  aria-current={step === i + 1 ? "step" : undefined}
                  data-done={step > i + 1 ? "true" : undefined}
                >
                  {label}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <div className="checkout__main">{children}</div>
    </div>
  );
}
