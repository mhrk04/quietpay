import { CreateForm } from "@/components/CreateForm";
import { MerchantHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <MerchantHeader current="create" />
      <main id="main" className="page">
        <div className="page-head">
          <h1>Get paid in USDC, from any token on any chain</h1>
          <p>
            Create a payment link, send it on WhatsApp, and your client pays with whatever they hold. You receive USDC
            on NEAR.
          </p>
        </div>
        <CreateForm />
      </main>
    </>
  );
}
