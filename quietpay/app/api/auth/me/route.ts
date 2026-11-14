import { guardRequest } from "@/lib/server/guard";
import { NOT_SET_UP, getSessionSecret, readSession } from "@/lib/server/session";

export async function GET(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  if (!getSessionSecret()) return Response.json(NOT_SET_UP, { status: 503, headers: { "Cache-Control": "no-store" } });
  const s = readSession(req);
  if (!s) return Response.json({ accountId: null }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ accountId: s.accountId }, { headers: { "Cache-Control": "no-store" } });
}
