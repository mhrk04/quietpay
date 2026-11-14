"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { connectWallet, disconnectWallet, ensureSession, shortAccount, useSessionState } from "@/lib/session-store";

type Props = {
  /**
   * The wallet connector only runs on /payments (the only page whose CSP allows it).
   * On any other page the button navigates there instead of opening the picker.
   */
  connectInPlace?: boolean;
};

export function WalletButton({ connectInPlace = false }: Props) {
  const router = useRouter();
  const { session, connecting } = useSessionState();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ensureSession();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (session.status === "loading") {
    return <span className="skeleton header-pill-skeleton" role="status" aria-label="Checking sign-in" />;
  }

  if (session.status === "signed-in") {
    return (
      <div className="menu" ref={wrap}>
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          aria-controls="account-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="mono">{shortAccount(session.accountId)}</span>
          <svg className="btn__caret" viewBox="0 0 10 6" aria-hidden="true" focusable="false">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div className="menu__panel" id="account-menu">
            <span className="menu__label break">Signed in as {session.accountId}</span>
            <Link className="menu__item" href="/payments" onClick={() => setOpen(false)}>
              My payments
            </Link>
            <div className="menu__sep" role="separator" />
            <button
              type="button"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                void disconnectWallet();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  const unavailable = session.status === "not-set-up";
  return (
    <button
      type="button"
      className="btn btn--primary"
      disabled={unavailable || connecting}
      title={unavailable ? "Sign-in is not set up" : undefined}
      onClick={() => {
        if (connectInPlace) void connectWallet();
        else router.push("/payments?connect=1");
      }}
    >
      {connecting && <span className="spinner" aria-hidden="true" />}
      {connecting ? "Waiting for wallet…" : "Connect wallet"}
    </button>
  );
}
