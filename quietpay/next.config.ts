import type { NextConfig } from "next";

// script-src keeps 'unsafe-inline' because Next.js emits inline bootstrap/RSC
// scripts and this app does not implement per-request nonces (nonces would force
// dynamic rendering of every page). Everything else is locked to same-origin.
// QR codes are data: URLs, so img-src allows data:. wa.me and explorer links are
// plain navigations, which connect-src does not restrict.
type Extra = Partial<Record<"connect-src" | "img-src" | "style-src" | "font-src" | "frame-src", string[]>>;
function buildCsp(extra: Extra = {}): string {
  const d = (name: keyof Extra, base: string) => [base, ...(extra[name] ?? [])].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    `style-src ${d("style-src", "'self' 'unsafe-inline'")}`,
    `img-src ${d("img-src", "'self' data:")}`,
    `connect-src ${d("connect-src", "'self'")}`,
    `font-src ${d("font-src", "'self'")}`,
    ...(extra["frame-src"] ? [`frame-src ${extra["frame-src"].join(" ")}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
const csp = buildCsp();
// Only /payments (NEAR wallet sign-in) gets more. @hot-labs/near-connect loads a wallet list from
// GitHub/jsDelivr, fetches each wallet's script (wallet code runs in a sandboxed srcdoc iframe that
// inherits this policy, so the wallet's own servers and RPCs must be listed too) and shows wallet icons.
// A wallet whose hosts are not listed here is blocked on this page; add its hosts to extend.
const walletCsp = buildCsp({
  "connect-src": [
    "https://raw.githubusercontent.com",
    "https://cdn.jsdelivr.net",
    "https://free.rpc.fastnear.com",
    "https://rpc.mainnet.near.org",
    "https://app.hot-labs.org",
    "https://h4n.app",
    "https://api0.herewallet.app",
    "https://my.herewallet.app",
    "https://wallet.meteorwallet.app",
    "https://mc.meteorwallet.app",
    "https://wallet.intear.tech",
    "https://logout-bridge-service.intear.tech",
    "wss://logout-bridge-service.intear.tech",
    "wss://mc.meteorwallet.app",
    "https://app.mynearwallet.com",
    "https://near-mobile-production.aws.peersyst.tech",
  ],
  "img-src": [
    "https://app.hot-labs.org",
    "https://hot-labs.org",
    "https://storage.herewallet.app",
    "https://raw.githubusercontent.com",
    "https://res.cloudinary.com",
    "https://evm-on-near.dev",
    "https://meteorwallet.app",
    "https://near-mobile-production.aws.peersyst.tech",
  ],
  "frame-src": ["https://wallet.intear.tech"],
  "style-src": ["https://fonts.cdnfonts.com", "https://rsms.me", "https://fonts.googleapis.com"],
  "font-src": ["data:", "https://fonts.cdnfonts.com", "https://rsms.me", "https://fonts.gstatic.com"],
});
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      { source: "/payments", headers: [{ key: "Content-Security-Policy", value: walletCsp }] },
      { source: "/((?!payments$).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), clipboard-write=(self)",
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};
export default nextConfig;
