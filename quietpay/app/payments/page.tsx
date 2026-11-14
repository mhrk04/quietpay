import type { Metadata } from "next";
import { MyPayments } from "@/components/MyPayments";
import { MerchantHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <>
      <MerchantHeader current="payments" />
      <main id="main" className="page">
        <div className="page-head page-head--compact">
          <h1>Payments</h1>
          <p>Every payment made to your payment links, with its live status.</p>
        </div>
        <MyPayments />
      </main>
    </>
  );
}
