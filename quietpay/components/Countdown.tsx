"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/copy";

type Props = { deadlineMs: number; onExpire?: () => void };

/** Counts down to `deadlineMs` (epoch ms), updating every second as m:ss. */
export function Countdown({ deadlineMs, onExpire }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const remaining = deadlineMs - now;
  const expired = remaining <= 0;

  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  return <span aria-label="Time left to pay">{formatCountdown(remaining)}</span>;
}
