import Link from "next/link";
import { MyPayments } from "@/components/MyPayments";

export default function PaymentsPage() {
  return (
    <main>
      <h1>My payments</h1>
      <MyPayments />
      <p>
        <Link href="/">Create a payment link</Link>
      </p>
    </main>
  );
}
