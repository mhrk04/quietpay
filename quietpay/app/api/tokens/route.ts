import { connection } from "next/server";
import { getConfig } from "@/lib/server/config";
import { proxyFetch } from "@/lib/server/proxy";

export async function GET() {
  await connection(); // opt out of prerendering
  const config = getConfig();
  if (config.mode === "unconfigured") {
    return Response.json({ message: "Server is not configured" }, { status: 500 });
  }
  const { jwt } = config;
  const r = await proxyFetch("/v0/tokens", { method: "GET", cache: "no-store" }, { jwt });
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
