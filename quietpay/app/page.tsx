import { CreateForm } from "@/components/CreateForm";

export default function Home() {
  return (
    <main>
      <h1>QuietPay</h1>
      <p>Get paid in USDC from any token on any chain.</p>
      <CreateForm />
    </main>
  );
}
