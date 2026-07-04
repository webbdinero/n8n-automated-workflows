import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed-cookie sessions. The cookie holds a base64url JSON payload
 * plus an HMAC-SHA256 signature, so no server-side session store is needed. Any
 * tampering (payload or signature) fails verification; expired tokens are
 * rejected. Keep the signing secret in SESSION_SECRET for stable sessions.
 */
export const SESSION_COOKIE = "gg_session";

export interface SessionPayload {
  uid: string;
  /** Expiry as a unix epoch (seconds). */
  exp: number;
}

function b64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(body, secret);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Days-from-now expiry helper (default 14 days). */
export function sessionExpiry(days = 14, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + days * 24 * 60 * 60;
}
