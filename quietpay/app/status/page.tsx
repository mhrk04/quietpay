import { Suspense } from "react";
import StatusView from "./StatusView";

export default function StatusPage() {
  return (
    <main>
      <Suspense fallback={<p>Loading…</p>}>
        <StatusView />
      </Suspense>
    </main>
  );
}
