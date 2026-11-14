import Link from "next/link";
import { Brand } from "@/components/Brand";
import { WalletButton } from "@/components/WalletButton";

/** Merchant header: brand on the left, navigation, wallet button on the right. */
export function MerchantHeader({ current }: { current: "create" | "payments" }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand />
        <nav className="site-nav" aria-label="Main">
          <Link className="site-nav__link" href="/" aria-current={current === "create" ? "page" : undefined}>
            Create link
          </Link>
          <Link className="site-nav__link" href="/payments" aria-current={current === "payments" ? "page" : undefined}>
            Payments
          </Link>
        </nav>
        <div className="site-header__actions">
          <WalletButton connectInPlace={current === "payments"} />
        </div>
      </div>
    </header>
  );
}

/** Payer header: brand only. Payers pay from any chain and never need a NEAR wallet. */
export function PayerHeader() {
  return (
    <header className="site-header site-header--static">
      <div className="site-header__inner">
        <Brand />
      </div>
    </header>
  );
}
