import { Suspense } from "react";
import { PayFlow } from "@/components/PayFlow";

export default function PayPage() {
  return (
    <main>
      <h1>Pay</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <PayFlow />
      </Suspense>
    </main>
  );
}
