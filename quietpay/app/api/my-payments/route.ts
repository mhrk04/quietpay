import { guardRequest } from "@/lib/server/guard";
import { accountKeyFor, getPaymentsStore } from "@/lib/server/payments-store";
import { readSession } from "@/lib/server/session";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  // The account comes only from the signed session cookie, never from the URL.
  const s = readSession(req);
  if (!s) return Response.json({ message: "Please sign in" }, { status: 401, headers: NO_STORE });
  try {
    const payments = await getPaymentsStore().listForAccount(accountKeyFor(s.accountId));
    return Response.json({ accountId: s.accountId, payments }, { headers: NO_STORE });
  } catch {
    return Response.json({ message: "Payments could not be loaded" }, { status: 502, headers: NO_STORE });
  }
}
