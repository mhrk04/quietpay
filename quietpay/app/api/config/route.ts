import { guardRequest } from "@/lib/server/guard";
import { connection } from "next/server";
import { getConfig } from "@/lib/server/config";

export async function GET(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  await connection(); // opt out of prerendering; env is read per request
  return Response.json({ mode: getConfig().mode }, { headers: { "Cache-Control": "no-store" } });
}
