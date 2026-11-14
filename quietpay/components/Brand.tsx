export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="brand__mark-bg" />
      <circle cx="15" cy="15" r="6.5" className="brand__mark-stroke" />
      <path d="M19.5 19.5 25 25" className="brand__mark-stroke" />
    </svg>
  );
}

// Plain <a>, not next/link: /payments has its own CSP (wallet connector sources), so crossing it needs a full document load.
export function Brand() {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className="brand">
      <BrandMark />
      <span>QuietPay</span>
    </a>
  );
}
