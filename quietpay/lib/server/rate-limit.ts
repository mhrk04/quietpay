export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  now?: () => number;
  maxKeys?: number;
}

/**
 * Fixed-window in-memory limiter. Per server instance only: it resets on cold
 * start and is not shared between instances.
 */
export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(opts: RateLimiterOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  size(): number {
    return this.entries.size;
  }

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || e.resetAt <= t) {
      if (!e && this.entries.size >= this.maxKeys) this.evict(t);
      e = { count: 0, resetAt: t + windowMs };
    }
    e.count += 1;
    // Re-insert so Map order tracks recency of window start.
    this.entries.delete(key);
    this.entries.set(key, e);
    if (e.count > limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private evict(t: number): void {
    for (const [k, v] of this.entries) {
      if (v.resetAt <= t) this.entries.delete(k);
    }
    // Still full: drop the oldest entries (Map iterates in insertion order).
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  const real = req.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

export const sharedLimiter = new RateLimiter();
