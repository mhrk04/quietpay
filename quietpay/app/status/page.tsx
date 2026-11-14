import { Suspense } from "react";
import type { Metadata } from "next";
import StatusView from "./StatusView";
import { PayerHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Payment status" };

export default function StatusPage() {
  return (
    <>
      <PayerHeader />
      <main id="main" className="page page--narrow">
        <Suspense
          fallback={
            <div className="card" role="status" aria-label="Loading payment status">
              <span className="skeleton skeleton--text" />
              <span className="skeleton skeleton--text" />
            </div>
          }
        >
          <StatusView />
        </Suspense>
      </main>
    </>
  );
}
