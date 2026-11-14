import { getConfig } from "@/lib/server/config";
import { proxyFetch } from "@/lib/server/proxy";

export async function GET(req: Request) {
  if (getConfig().mode === "unconfigured") {
    return Response.json({ message: "Server is not configured" }, { status: 500 });
  }
  const depositAddress = new URL(req.url).searchParams.get("depositAddress");
  if (!depositAddress) {
    return Response.json({ message: "depositAddress is required" }, { status: 400 });
  }
  const { jwt } = getConfig();
  const r = await proxyFetch(
    `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { method: "GET", cache: "no-store" },
    { jwt },
  );
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
