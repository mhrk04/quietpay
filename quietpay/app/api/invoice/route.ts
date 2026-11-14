import { guardRequest } from "@/lib/server/guard";
import { decodeInvoice } from "@/lib/link-codec";
import { getPaymentsStore, invoiceKeyFor } from "@/lib/server/payments-store";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  const code = new URL(req.url).searchParams.get("i") ?? "";
  if (!decodeInvoice(code).ok) {
    return Response.json({ message: "Invalid invoice code" }, { status: 400, headers: NO_STORE });
  }
  try {
    const deposits = await getPaymentsStore().list(invoiceKeyFor(code));
    return Response.json({ deposits }, { headers: NO_STORE });
  } catch {
    return Response.json({ message: "Payments could not be loaded" }, { status: 502, headers: NO_STORE });
  }
}
