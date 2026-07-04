import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { parseCookies } from "./cookies.js";
import { SESSION_COOKIE } from "./session.js";

/**
 * Session-bound CSRF tokens (synchronizer pattern, stateless). The token is an
 * HMAC of the user's session cookie value, so it is unpredictable to an
 * attacker (who cannot read the HttpOnly session cookie) and verifiable without
 * any server-side store. Forms embed it in a hidden `_csrf` field; state-
 * changing POSTs must echo it back. This layers on top of the SameSite=Lax
 * cookie for defense in depth.
 */
export function csrfFromSessionValue(sessionValue: string | undefined, secret: string): string | null {
  if (!sessionValue) return null;
  return createHmac("sha256", secret).update(`csrf:${sessionValue}`).digest("base64url");
}

export function deriveCsrf(req: Request, secret: string): string | null {
  const sessionValue = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return csrfFromSessionValue(sessionValue, secret);
}

/** Methods that never change state and so need no CSRF check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths exempt from CSRF (no session yet, or bearer-token API). */
function isExempt(req: Request): boolean {
  return (
    req.path.startsWith("/api") || // token-authenticated, no ambient cookie
    req.path === "/login" ||
    req.path === "/logout"
  );
}

export function requireCsrf(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || isExempt(req)) return next();
    const expected = deriveCsrf(req, secret);
    const provided =
      (req.body && typeof req.body._csrf === "string" ? req.body._csrf : "") ||
      req.get("x-csrf-token") ||
      "";
    const ok =
      expected != null &&
      provided.length > 0 &&
      Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) {
      res.status(403).render("error", {
        title: "Security check failed",
        message: "Your session security token was missing or invalid. Reload the page and try again.",
      });
      return;
    }
    next();
  };
}
