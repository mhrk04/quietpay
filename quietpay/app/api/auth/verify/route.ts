import { guardRequest, readJsonCapped } from "@/lib/server/guard";
import { isValidNearAccount } from "@/lib/near-account";
import { verifyNep413 } from "@/lib/server/nep413";
import { RpcError, checkAccessKey } from "@/lib/server/near-rpc";
import {
  CHALLENGE_COOKIE,
  NOT_SET_UP,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearCookie,
  getSessionSecret,
  isProduction,
  readCookie,
  setCookie,
  signToken,
  verifyToken,
  type Challenge,
} from "@/lib/server/session";

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, message: string, headers?: Headers) => {
  const h = headers ?? new Headers();
  h.set("Cache-Control", "no-store");
  return Response.json({ message }, { status, headers: h });
};

export async function POST(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  const secret = getSessionSecret();
  if (!secret) return Response.json(NOT_SET_UP, { status: 503, headers: NO_STORE });

  const parsed = await readJsonCapped(req);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body as Record<string, unknown> | null;
  const accountId = b && typeof b === "object" ? b.accountId : undefined;
  const publicKey = b && typeof b === "object" ? b.publicKey : undefined;
  const signature = b && typeof b === "object" ? b.signature : undefined;
  if (typeof accountId !== "string" || typeof publicKey !== "string" || typeof signature !== "string") {
    return fail(400, "Sign-in data is incomplete");
  }

  const token = readCookie(req.headers.get("cookie"), CHALLENGE_COOKIE);
  const challenge = token ? verifyToken<Challenge>(token, secret) : null;
  if (!challenge || typeof challenge.nonce !== "string" || typeof challenge.recipient !== "string" || typeof challenge.message !== "string") {
    return fail(400, "Sign-in expired. Please start again.");
  }
  if (!isValidNearAccount(accountId)) return fail(400, "Invalid NEAR account");

  const secure = isProduction();
  // Single use: the challenge cookie is removed on every answer except a temporary RPC failure.
  const consumed = () => {
    const h = new Headers();
    h.append("Set-Cookie", clearCookie(CHALLENGE_COOKIE, "/api/auth", secure));
    return h;
  };

  const nonce = Buffer.from(challenge.nonce, "base64");
  // The signed values come from the server-side cookie, never from the request body.
  if (!verifyNep413({ publicKey, signature, message: challenge.message, recipient: challenge.recipient, nonce })) {
    return fail(401, "The signature could not be verified", consumed());
  }

  let kind;
  try {
    kind = await checkAccessKey(accountId, publicKey);
  } catch (e) {
    if (e instanceof RpcError) return fail(502, "Could not check your account on NEAR. Please try again.");
    throw e;
  }
  if (kind !== "full") {
    return fail(401, "This key is not a full-access key of that account", consumed());
  }

  const headers = consumed();
  headers.set("Cache-Control", "no-store");
  headers.append(
    "Set-Cookie",
    setCookie(SESSION_COOKIE, signToken({ accountId, exp: Date.now() + SESSION_TTL_MS }, secret), {
      path: "/",
      maxAgeSeconds: SESSION_TTL_MS / 1000,
      secure,
    }),
  );
  return Response.json({ accountId }, { headers });
}
