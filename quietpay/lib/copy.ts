export type ClipboardLike = { writeText(text: string): Promise<void> };

/** Writes text to the clipboard. Resolves true on success, false on any failure. */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | undefined = typeof navigator !== "undefined" ? navigator.clipboard : undefined,
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Formats remaining milliseconds as m:ss (minutes may exceed 59). Never negative. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
