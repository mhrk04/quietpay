"use client";
import { useCallback, useEffect, useState } from "react";
import { fromBaseUnits } from "@/lib/amount";
import { fetchMe, fetchMyPayments, signInWithWallet, signOut, type AccountRecord } from "@/lib/auth-client";
import { buildStatusLink, decodeInvoice } from "@/lib/link-codec";
import { fetchDepositStatus } from "@/lib/payments-client";
import { statusMessage } from "@/lib/status";
import { chainName } from "@/lib/tokens";

type Row = { payment: AccountRecord; status: string | null };
type View =
  | { kind: "loading" }
  | { kind: "not-set-up" }
  | { kind: "signed-out"; error?: string }
  | { kind: "signed-in"; accountId: string; rows: Row[] | null; error?: string };

export function MyPayments() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (accountId: string) => {
    setView({ kind: "signed-in", accountId, rows: null });
    const list = await fetchMyPayments();
    if (!list.ok) {
      setView({ kind: "signed-in", accountId, rows: [], error: list.message });
      return;
    }
    const statuses = await Promise.all(list.value.map((p) => fetchDepositStatus(p.depositAddress)));
    setView({ kind: "signed-in", accountId, rows: list.value.map((payment, i) => ({ payment, status: statuses[i] })) });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (!me.ok) setView(me.notSetUp ? { kind: "not-set-up" } : { kind: "signed-out", error: me.message });
      else if (me.value) void load(me.value);
      else setView({ kind: "signed-out" });
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onSignIn() {
    setBusy(true);
    const r = await signInWithWallet();
    setBusy(false);
    if (!r.ok) setView(r.notSetUp ? { kind: "not-set-up" } : { kind: "signed-out", error: r.message });
    else void load(r.value);
  }

  async function onSignOut() {
    await signOut();
    setView({ kind: "signed-out" });
  }

  if (view.kind === "loading") return <p>Loading…</p>;
  if (view.kind === "not-set-up") {
    return (
      <p className="create-notice" role="status">
        Sign-in is not set up
      </p>
    );
  }
  if (view.kind === "signed-out") {
    return (
      <div className="create-wrap">
        <p>
          Sign in with your NEAR wallet to see the payments made to your account. Your wallet signs a short message. No
          payment is made and no fee is charged.
        </p>
        {view.error && (
          <p className="create-error" role="alert">
            {view.error}
          </p>
        )}
        <button type="button" onClick={onSignIn} disabled={busy}>
          {busy ? "Waiting for your wallet…" : "Sign in with NEAR"}
        </button>
      </div>
    );
  }
  return (
    <div className="create-wrap">
      <p>
        Signed in as <strong className="create-break">{view.accountId}</strong>
      </p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
      {view.error && (
        <p className="create-error" role="alert">
          {view.error}
        </p>
      )}
      {view.rows === null && <p>Loading payments…</p>}
      {view.rows && view.rows.length === 0 && !view.error && <p className="create-hint">No payments yet.</p>}
      {view.rows && view.rows.length > 0 && (
        <ul className="create-list" aria-label="Payments">
          {view.rows.map(({ payment: p, status }) => {
            const inv = decodeInvoice(p.invoiceCode);
            return (
              <li key={p.depositAddress} className="create-item">
                <strong className="create-break">{p.description || "No description"}</strong>
                <span>{p.amount} USDC requested</span>
                <span>
                  Paying {fromBaseUnits(p.amountIn, p.origin.decimals)} {p.origin.symbol} on {chainName(p.origin.blockchain)}
                </span>
                <span>{status ? statusMessage(status) : "Checking payment"}</span>
                <span className="create-hint">{new Date(p.createdAt).toLocaleString()}</span>
                {inv.ok && (
                  <a
                    href={buildStatusLink(window.location.origin, p.depositAddress, inv.value, {
                      deadline: Date.parse(p.deadline),
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View payment status
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
