"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copy";

type Props = { value: string; label: string };

/** Copies `value` exactly as given. Shows a check for 2 s; on failure shows the value as selectable text. */
export function CopyButton({ value, label }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(value);
    clearTimeout(timer.current);
    setState(ok ? "copied" : "failed");
    if (ok) timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <span className="inline-copy">
      <button type="button" className="btn btn--sm" onClick={onClick} aria-label={`Copy ${label}`}>
        {state === "copied" ? "✓ Copied" : `Copy ${label}`}
      </button>
      <span role="status" aria-live="polite">
        {state === "failed" && (
          <>
            <span>Copy failed. Select and copy the text below:</span>
            <code className="copy-failed" tabIndex={0}>
              {value}
            </code>
          </>
        )}
      </span>
    </span>
  );
}
