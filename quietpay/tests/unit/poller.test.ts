import { describe, expect, it } from "vitest";
import { createPoller, nextDelay, type PollerDeps, type PollerView } from "@/lib/poller";

function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      timers.set(++id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    async advance(ms: number) {
      await new Promise((r) => setImmediate(r));
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
  };
}

describe("poller", () => {
  it("nextDelay backs off to 30s", () => {
    expect([0, 1, 2, 3, 4, 10].map(nextDelay)).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });

  it("polls at 3s, stops on terminal, keeps data", async () => {
    const clock = fakeClock();
    const calls: number[] = [];
    const seq = ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"] as const;
    const deps: PollerDeps = {
      ...clock,
      isVisible: () => true,
      fetchStatus: async () => {
        calls.push(clock.now());
        return { httpStatus: 200, body: { status: seq[Math.min(calls.length - 1, 2)] } };
      },
    };
    const views: PollerView[] = [];
    createPoller("addr", undefined, deps, (v) => views.push(v)).start();
    await clock.advance(20000);
    expect(calls).toEqual([0, 3000, 6000]);
    const last = views[views.length - 1];
    expect(last.stopped).toBe(true);
    expect(last.stopReason).toBe("terminal");
    expect(last.status).toBe("SUCCESS");
  });

  it("stops after 3 consecutive 404s", async () => {
    const clock = fakeClock();
    let n = 0;
    const deps: PollerDeps = {
      ...clock,
      isVisible: () => true,
      fetchStatus: async () => (n++, { httpStatus: 404 }),
    };
    const views: PollerView[] = [];
    createPoller("addr", undefined, deps, (v) => views.push(v)).start();
    await clock.advance(60000);
    expect(n).toBe(3);
    expect(views[views.length - 1].stopReason).toBe("not-found");
  });
});
