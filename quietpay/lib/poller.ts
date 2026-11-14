import { isTerminal, type SwapStatus } from "./status";

export interface StatusBody {
  status: SwapStatus;
  swapDetails?: {
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    depositedAmount?: string;
    refundedAmount?: string;
    refundReason?: string;
  };
}

export interface PollerDeps {
  /** Throws on network error or abort. */
  fetchStatus(addr: string, signal: AbortSignal): Promise<{ httpStatus: number; body?: StatusBody }>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  isVisible(): boolean;
}

export interface PollerView {
  status?: SwapStatus;
  data?: StatusBody;
  notice?: "connection-problem" | "not-found" | "window-closed" | "slow-processing";
  stopped: boolean;
  stopReason?: "terminal" | "deadline" | "not-found";
}

export const POLL_INTERVAL_MS = 3000;
export const MAX_DELAY_MS = 30000;
export const REQUEST_TIMEOUT_MS = 10000;
export const DEADLINE_GRACE_MS = 5 * 60 * 1000;
export const SLOW_PROCESSING_MS = 5 * 60 * 1000;
export const MAX_NOT_FOUND = 3;

export function nextDelay(failures: number): number {
  const n = Math.max(0, Math.floor(failures));
  return Math.min(POLL_INTERVAL_MS * 2 ** Math.min(n, 20), MAX_DELAY_MS);
}

export function createPoller(
  addr: string,
  deadlineMs: number | undefined,
  deps: PollerDeps,
  onUpdate: (v: PollerView) => void,
): { start(): void; stop(): void; onVisibilityChange(): void } {
  let started = false;
  let stopped = false;
  let inFlight = false;
  let timer: unknown = undefined;
  let hasTimer = false;
  let failures = 0;
  let notFound = 0;
  let status: SwapStatus | undefined;
  let data: StatusBody | undefined;
  let connectionProblem = false;
  let notFoundNotice = false;
  let processingSince: number | undefined;
  let stopReason: PollerView["stopReason"];

  const emit = () => {
    let notice: PollerView["notice"];
    if (stopReason === "deadline") notice = "window-closed";
    else if (stopReason === "not-found") notice = "not-found";
    else if (stopReason === "terminal") notice = undefined;
    else if (connectionProblem) notice = "connection-problem";
    else if (notFoundNotice) notice = "not-found";
    else if (
      status === "PROCESSING" &&
      processingSince !== undefined &&
      deps.now() - processingSince >= SLOW_PROCESSING_MS
    )
      notice = "slow-processing";
    onUpdate({ status, data, notice, stopped, stopReason });
  };

  const clear = () => {
    if (hasTimer) {
      deps.clearTimer(timer);
      hasTimer = false;
    }
  };

  const finish = (reason: NonNullable<PollerView["stopReason"]>) => {
    clear();
    stopped = true;
    stopReason = reason;
    emit();
  };

  const deadlinePassed = () =>
    deadlineMs !== undefined &&
    (status === undefined || status === "PENDING_DEPOSIT") &&
    deps.now() >= deadlineMs + DEADLINE_GRACE_MS;

  const schedule = (ms: number) => {
    clear();
    if (stopped || !deps.isVisible()) return;
    hasTimer = true;
    timer = deps.setTimer(() => {
      hasTimer = false;
      void poll();
    }, ms);
  };

  const poll = async () => {
    if (stopped || inFlight) return;
    if (!deps.isVisible()) return;
    if (deadlinePassed()) return finish("deadline");
    inFlight = true;
    const ac = new AbortController();
    let timeoutHandle: unknown;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = deps.setTimer(() => {
        timedOut = true;
        ac.abort();
        reject(new Error("timeout"));
      }, REQUEST_TIMEOUT_MS);
    });
    let res: { httpStatus: number; body?: StatusBody } | undefined;
    let failed = false;
    try {
      const p = deps.fetchStatus(addr, ac.signal);
      p.catch(() => {}); // avoid unhandled rejection if the timeout wins
      res = await Promise.race([p, timeout]);
    } catch {
      failed = true;
    } finally {
      if (!timedOut) deps.clearTimer(timeoutHandle);
      inFlight = false;
    }
    if (stopped) return;

    if (!failed && res && res.httpStatus === 404) {
      failures = 0;
      connectionProblem = false;
      notFound += 1;
      notFoundNotice = true;
      if (notFound >= MAX_NOT_FOUND) return finish("not-found");
      if (deadlinePassed()) return finish("deadline");
      emit();
      return schedule(POLL_INTERVAL_MS);
    }

    if (failed || !res || res.httpStatus < 200 || res.httpStatus >= 300 || !res.body || !res.body.status) {
      notFound = 0;
      notFoundNotice = false;
      failures += 1;
      connectionProblem = true;
      if (deadlinePassed()) return finish("deadline");
      emit();
      return schedule(nextDelay(failures - 1));
    }

    // Success
    failures = 0;
    notFound = 0;
    connectionProblem = false;
    notFoundNotice = false;
    data = res.body;
    if (res.body.status === "PROCESSING") {
      if (status !== "PROCESSING" || processingSince === undefined) processingSince = deps.now();
    } else {
      processingSince = undefined;
    }
    status = res.body.status;
    if (isTerminal(status)) return finish("terminal");
    if (deadlinePassed()) return finish("deadline");
    emit();
    schedule(POLL_INTERVAL_MS);
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (deps.isVisible()) void poll();
    },
    stop() {
      stopped = true;
      clear();
    },
    onVisibilityChange() {
      if (!started || stopped) return;
      if (!deps.isVisible()) {
        clear();
        return;
      }
      // Visible again: request now unless one is already running.
      if (!inFlight) {
        clear();
        void poll();
      }
    },
  };
}
