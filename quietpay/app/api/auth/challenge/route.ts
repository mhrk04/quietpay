import { randomBytes } from "node:crypto";
import { guardRequest } from "@/lib/server/guard";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  NOT_SET_UP,
  SIGN_IN_MESSAGE,
  authRecipient,
  getSessionSecret,
  isProduction,
  setCookie,
  signToken,
  type Challenge,
} from "@/lib/server/session";

export async function GET(req: Request) {
  const blocked = guardRequest(req, "other");
  if (blocked) return blocked;
  const secret = getSessionSecret();
  if (!secret) return Response.json(NOT_SET_UP, { status: 503, headers: { "Cache-Control": "no-store" } });
  const challenge: Challenge = {
    nonce: randomBytes(32).toString("base64"),
    recipient: authRecipient(req),
    message: SIGN_IN_MESSAGE,
    exp: Date.now() + CHALLENGE_TTL_MS,
  };
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    setCookie(CHALLENGE_COOKIE, signToken({ ...challenge }, secret), {
      path: "/api/auth",
      maxAgeSeconds: CHALLENGE_TTL_MS / 1000,
      secure: isProduction(),
    }),
  );
  return Response.json({ message: challenge.message, recipient: challenge.recipient, nonce: challenge.nonce }, { headers });
}
