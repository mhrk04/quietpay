import type { Invoice } from "@/lib/link-codec";

export interface TxLink {
  hash: string;
  explorerUrl: string;
}

/** Keep only well-formed http(s) explorer links. Tolerates missing or non-array input. */
export function safeTxLinks(list: unknown): TxLink[] {
  if (!Array.isArray(list)) return [];
  const out: TxLink[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { hash, explorerUrl } = item as Record<string, unknown>;
    if (typeof explorerUrl !== "string" || typeof hash !== "string") continue;
    try {
      const u = new URL(explorerUrl);
      if (u.protocol === "https:" || u.protocol === "http:") out.push({ hash, explorerUrl: u.toString() });
    } catch {
      // skip malformed URL
    }
  }
  return out;
}

export function TxLinks({ links, label }: { links: TxLink[]; label: string }) {
  if (links.length === 0) return null;
  return (
    <ul className="status-links">
      {links.map((l, i) => (
        <li key={`${l.hash}-${i}`}>
          <a href={l.explorerUrl} target="_blank" rel="noopener noreferrer" className="status-link">
            {label} {links.length > 1 ? i + 1 : ""}
            <span className="status-hash"> {l.hash.slice(0, 10)}…</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Receipt({
  invoice,
  completedAt,
  links,
}: {
  invoice: Invoice;
  completedAt: Date;
  links: TxLink[];
}) {
  return (
    <section className="status-receipt" aria-label="Receipt">
      <h2>Receipt</h2>
      <dl className="status-dl">
        {invoice.description ? (
          <>
            <dt>Description</dt>
            <dd>{invoice.description}</dd>
          </>
        ) : null}
        <dt>Amount</dt>
        <dd>{invoice.amount} USDC</dd>
        <dt>Paid to</dt>
        <dd className="status-break">{invoice.account}</dd>
        <dt>Completed</dt>
        <dd>{completedAt.toLocaleString()}</dd>
      </dl>
      <TxLinks links={links} label="View transaction" />
    </section>
  );
}
