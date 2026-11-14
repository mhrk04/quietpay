"use client";

import { useSyncExternalStore } from "react";
import { fetchMe, signInWithWallet, signOut } from "@/lib/auth-client";

export type Session =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "not-set-up" }
  | { status: "signed-in"; accountId: string };

export type SessionState = { session: Session; connecting: boolean };

const LOADING: SessionState = { session: { status: "loading" }, connecting: false };
let state: SessionState = LOADING;
let started = false;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Shared merchant session for the header and the Payments page. */
export function useSessionState(): SessionState {
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

/** Reads the current session from the server once per page load. */
export async function ensureSession(): Promise<void> {
  if (started) return;
  started = true;
  const me = await fetchMe();
  if (!me.ok) {
    set({ ...state, session: me.notSetUp ? { status: "not-set-up" } : { status: "signed-out", error: me.message } });
  } else if (me.value) {
    set({ ...state, session: { status: "signed-in", accountId: me.value } });
  } else {
    set({ ...state, session: { status: "signed-out" } });
  }
}

/** Opens the wallet picker, has the wallet sign the sign-in message (no transaction), then stores the account. */
export async function connectWallet(): Promise<void> {
  if (state.connecting) return;
  set({ ...state, connecting: true });
  const r = await signInWithWallet();
  if (r.ok) set({ session: { status: "signed-in", accountId: r.value }, connecting: false });
  else set({ session: r.notSetUp ? { status: "not-set-up" } : { status: "signed-out", error: r.message }, connecting: false });
}

export async function disconnectWallet(): Promise<void> {
  await signOut();
  set({ ...state, session: { status: "signed-out" } });
}

/** Short form of a NEAR account for the header button: long implicit accounts become `abcdef…1234`. */
export function shortAccount(accountId: string): string {
  return accountId.length > 22 ? `${accountId.slice(0, 8)}…${accountId.slice(-6)}` : accountId;
}
