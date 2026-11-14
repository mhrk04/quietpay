import { Suspense } from "react";
import type { Metadata } from "next";
import { PayFlow } from "@/components/PayFlow";
import { PayerHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Pay" };

export default function PayPage() {
  return (
    <>
      <PayerHeader />
      <main id="main" className="page">
        <h1 className="sr-only">Pay</h1>
        <Suspense
          fallback={
            <div className="card" role="status" aria-label="Loading payment">
              <span className="skeleton skeleton--text" />
              <span className="skeleton skeleton--text" />
            </div>
          }
        >
          <PayFlow />
        </Suspense>
      </main>
    </>
  );
}
