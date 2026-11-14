import { guardRequest } from "@/lib/server/guard";
import { SESSION_COOKIE, clearCookie, isProduction } from "@/lib/server/session";

export async function POST(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, "/", isProduction()));
  return Response.json({ ok: true }, { headers });
}
