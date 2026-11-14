"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { fromBaseUnits, toBaseUnits } from "@/lib/amount";
import { fetchMyPayments, type AccountRecord } from "@/lib/auth-client";
import { buildStatusLink, decodeInvoice } from "@/lib/link-codec";
import { fetchDepositStatus } from "@/lib/payments-client";
import { connectWallet, ensureSession, useSessionState } from "@/lib/session-store";
import { statusBadge, type StatusCategory } from "@/lib/status";
import { chainName } from "@/lib/tokens";

/** `undefined` while the live status is loading, `null` when it could not be read. */
type Row = { payment: AccountRecord; status: string | null | undefined };
type Data =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: Row[] };

type Filter = "all" | StatusCategory;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "paid", label: "Paid" },
  { id: "progress", label: "In progress" },
  { id: "returned", label: "Returned/failed" },
];

const categoryOf = (r: Row): StatusCategory | null => (r.status === undefined ? null : statusBadge(r.status).category);

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Sum of the requested USDC amounts of paid rows, as a plain decimal string. */
function receivedTotal(rows: Row[]): string {
  let total = BigInt(0);
  for (const r of rows) {
    if (r.status !== "SUCCESS") continue;
    const base = toBaseUnits(r.payment.amount);
    if (base.ok) total += BigInt(base.value);
  }
  return fromBaseUnits(total.toString());
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (status === undefined) {
    return <span className="skeleton skeleton--badge" role="status" aria-label="Checking status" />;
  }
  const b = statusBadge(status);
  return <span className={`badge badge--${b.tone}`}>{b.label}</span>;
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} aria-hidden="true">
          <td className="cell-date" data-label="Date"><span className="skeleton skeleton--text" /></td>
          <td className="cell-desc" data-label="Description"><span className="skeleton skeleton--text" /></td>
          <td className="num" data-label="Amount"><span className="skeleton skeleton--text" /></td>
          <td data-label="Paid with"><span className="skeleton skeleton--text" /></td>
          <td data-label="Status"><span className="skeleton skeleton--badge" /></td>
          <td className="cell-action" />
        </tr>
      ))}
    </>
  );
}

export function MyPayments() {
  const { session, connecting } = useSessionState();
  const [data, setData] = useState<Data>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [attempt, setAttempt] = useState(0);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const autoConnected = useRef(false);

  const accountId = session.status === "signed-in" ? session.accountId : null;

  useEffect(() => {
    void ensureSession();
  }, []);

  // /payments?connect=1 (from the Connect wallet button on other pages) opens the wallet picker once.
  useEffect(() => {
    if (autoConnected.current) return;
    if (session.status === "loading") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connect")) return;
    autoConnected.current = true;
    params.delete("connect");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (session.status === "signed-out") void connectWallet();
  }, [session.status]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const list = await fetchMyPayments();
      if (cancelled) return;
      if (!list.ok) {
        setData({ kind: "error", message: list.message });
        return;
      }
      setData({ kind: "ready", rows: list.value.map((payment) => ({ payment, status: undefined })) });
      list.value.forEach(async (payment) => {
        const status = await fetchDepositStatus(payment.depositAddress);
        if (cancelled) return;
        setData((cur) =>
          cur.kind === "ready"
            ? {
                kind: "ready",
                rows: cur.rows.map((r) => (r.payment.depositAddress === payment.depositAddress ? { ...r, status } : r)),
              }
            : cur,
        );
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, attempt]);

  const retry = useCallback(() => {
    setData({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const rows = useMemo(() => (data.kind === "ready" ? data.rows : []), [data]);
  const counts = useMemo(() => {
    const c = { all: rows.length, paid: 0, progress: 0, returned: 0 };
    for (const r of rows) {
      const cat = categoryOf(r);
      if (cat) c[cat] += 1;
    }
    return c;
  }, [rows]);
  useEffect(() => {
    const el = tabRefs.current[FILTERS.findIndex((f) => f.id === filter)];
    // Scrolls only the tab strip (and the page the least amount needed) so the active tab is visible.
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [filter, data.kind]);
  const allLoaded = data.kind === "ready" && rows.every((r) => r.status !== undefined);
  const visible = filter === "all" ? rows : rows.filter((r) => categoryOf(r) === filter || (filter === "progress" && r.status === undefined));

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % FILTERS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = FILTERS.length - 1;
    else return;
    e.preventDefault();
    setFilter(FILTERS[next].id);
    tabRefs.current[next]?.focus();
  }

  if (session.status === "loading") {
    return (
      <div className="card" role="status" aria-label="Loading">
        <span className="skeleton skeleton--text" />
        <span className="skeleton skeleton--text" />
      </div>
    );
  }

  if (session.status === "not-set-up") {
    return (
      <p className="notice notice--warning" role="status">
        Sign-in is not set up
      </p>
    );
  }

  if (session.status === "signed-out") {
    return (
      <section className="card empty" aria-label="Sign in">
        <svg className="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M3 10h18M16 14.5h2" />
        </svg>
        <h2>Sign in to see your payments</h2>
        <p>
          Connect your NEAR wallet to see what your clients have paid you, on any device. Your wallet signs a short
          message. No transaction is made and no fee is charged.
        </p>
        {session.error && (
          <p className="notice notice--danger" role="alert">
            {session.error}
          </p>
        )}
        <button type="button" className="btn btn--primary" onClick={() => void connectWallet()} disabled={connecting}>
          {connecting && <span className="spinner" aria-hidden="true" />}
          {connecting ? "Waiting for your wallet…" : "Connect wallet"}
        </button>
      </section>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const activeTab = FILTERS.findIndex((f) => f.id === filter);

  return (
    <div className="stack">
      <div className="stats" role="group" aria-label="Summary">
        <div className="stat">
          <span className="stat__label">Received</span>
          <span className="stat__value">
            {allLoaded ? receivedTotal(rows) : <span className="skeleton skeleton--text" aria-label="Loading" />}
            <span className="stat__unit">USDC</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">In progress</span>
          <span className="stat__value">{data.kind === "ready" ? counts.progress : "–"}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Returned or failed</span>
          <span className="stat__value">{data.kind === "ready" ? counts.returned : "–"}</span>
        </div>
      </div>

      {data.kind === "error" && (
        <div className="notice notice--danger" role="alert">
          <p>{data.message}</p>
          <div>
            <button type="button" className="btn btn--sm" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      )}

      {data.kind === "ready" && rows.length === 0 && (
        <section className="card empty" aria-label="No payments">
          <svg className="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <h2>No payments yet</h2>
          <p>When a client pays one of your payment links, it shows up here with its live status.</p>
          <Link className="btn btn--primary" href="/">
            Create a payment link
          </Link>
        </section>
      )}

      {data.kind !== "error" && !(data.kind === "ready" && rows.length === 0) && (
        <>
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter payments by status">
              {FILTERS.map((f, i) => (
                <button
                  key={f.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${f.id}`}
                  className="tab"
                  aria-selected={filter === f.id}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={filter === f.id ? 0 : -1}
                  onClick={() => setFilter(f.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {f.label}
                  {data.kind === "ready" && <span className="tab__count">{counts[f.id]}</span>}
                </button>
              ))}
            </div>
          </div>
          <div
            className="table-card"
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-tab-${FILTERS[activeTab].id}`}
          >
            <table className="table">
              <caption className="sr-only">Payments received by {accountId}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="num">Amount (USDC)</th>
                  <th scope="col">Paid with</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {data.kind === "loading" && <SkeletonRows />}
                {data.kind === "ready" && visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No payments in this view.
                    </td>
                  </tr>
                )}
                {visible.map(({ payment: p, status }) => {
                  const inv = decodeInvoice(p.invoiceCode);
                  const description = p.description || "No description";
                  return (
                    <tr key={p.depositAddress}>
                      <td className="cell-date" data-label="Date">{formatDate(p.createdAt)}</td>
                      <td className="cell-desc" data-label="Description">{description}</td>
                      <td className="num" data-label="Amount (USDC)">{p.amount}</td>
                      <td data-label="Paid with">
                        <span className="cell-stack">
                          <span className="tabular">
                            {fromBaseUnits(p.amountIn, p.origin.decimals)} {p.origin.symbol}
                          </span>
                          <span className="cell-sub">on {chainName(p.origin.blockchain)}</span>
                        </span>
                      </td>
                      <td data-label="Status"><StatusBadge status={status} /></td>
                      <td className="cell-action">
                        {inv.ok && (
                          <a
                            className="btn btn--sm"
                            aria-label={`View ${description}`}
                            href={buildStatusLink(origin, p.depositAddress, inv.value, { deadline: Date.parse(p.deadline) })}
                          >
                            View
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
