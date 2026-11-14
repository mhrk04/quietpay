export type ServerMode = "confidential" | "public" | "unconfigured";

export interface ServerConfig {
  mode: ServerMode;
  jwt?: string;
}

type Env = Record<string, string | undefined>;

/**
 * Derives the server mode from environment variables.
 * JWT set -> confidential. No JWT and fallback flag exactly "true" -> public.
 * Otherwise unconfigured.
 */
export function getConfig(env: Env = process.env): ServerConfig {
  const jwt = env.ONECLICK_JWT;
  if (typeof jwt === "string" && jwt.length > 0) {
    return { mode: "confidential", jwt };
  }
  if (env.QUIETPAY_ALLOW_PUBLIC_FALLBACK === "true") {
    return { mode: "public" };
  }
  return { mode: "unconfigured" };
}
