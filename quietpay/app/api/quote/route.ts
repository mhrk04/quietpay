import { getConfig } from "@/lib/server/config";
import { proxyFetch, validateQuoteBody } from "@/lib/server/proxy";

export async function POST(req: Request) {
  const config = getConfig();
  if (config.mode === "unconfigured") {
    return Response.json({ message: "Server is not configured" }, { status: 500 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateQuoteBody(body);
  if (!v.ok) return Response.json({ message: v.message }, { status: v.status });

  const payload = {
    ...(body as Record<string, unknown>),
    confidentiality: config.mode === "confidential" ? "basic" : "public",
  };
  const r = await proxyFetch(
    "/v0/quote",
    { method: "POST", body: JSON.stringify(payload), cache: "no-store" },
    { jwt: config.jwt },
  );
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
