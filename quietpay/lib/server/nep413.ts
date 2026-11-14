import { createHash, createPublicKey, verify } from "node:crypto";
import { base58Decode } from "@/lib/server/base58";

/** 2^31 + 413, the NEP-413 prefix tag, serialized as a little-endian u32. */
const TAG = 2147484061;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const borshString = (s: string): Buffer => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
};

export interface Nep413Payload {
  message: string;
  recipient: string;
  nonce: Buffer;
}

/** SHA-256 of tag + borsh(Payload { message, nonce, recipient, callbackUrl: None }). */
export function buildNep413Hash(p: Nep413Payload): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(TAG);
  const data = Buffer.concat([tag, borshString(p.message), p.nonce, borshString(p.recipient), Buffer.from([0])]);
  return createHash("sha256").update(data).digest();
}

/** True only when `signature` (base64) is a valid ed25519 signature by `publicKey` ("ed25519:<base58>") over the payload. */
export function verifyNep413(args: Nep413Payload & { publicKey: string; signature: string }): boolean {
  try {
    if (args.nonce.length !== 32) return false;
    if (!args.publicKey.startsWith("ed25519:")) return false;
    const raw = base58Decode(args.publicKey.slice("ed25519:".length));
    if (!raw || raw.length !== 32) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(args.signature)) return false;
    const sig = Buffer.from(args.signature, "base64");
    if (sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verify(null, buildNep413Hash(args), key, sig);
  } catch {
    return false;
  }
}
