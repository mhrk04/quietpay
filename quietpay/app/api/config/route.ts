import { connection } from "next/server";
import { getConfig } from "@/lib/server/config";

export async function GET() {
  await connection(); // opt out of prerendering; env is read per request
  return Response.json({ mode: getConfig().mode }, { headers: { "Cache-Control": "no-store" } });
}
