import { getConfig } from "@/lib/server/config";
import { proxyFetch } from "@/lib/server/proxy";

export async function POST(req: Request) {
  if (getConfig().mode === "unconfigured") {
    return Response.json({ message: "Server is not configured" }, { status: 500 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const { jwt } = getConfig();
  const r = await proxyFetch(
    "/v0/deposit/submit",
    { method: "POST", body: JSON.stringify(body), cache: "no-store" },
    { jwt },
  );
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
