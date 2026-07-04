import { Router, type Express, type Request, type Response } from "express";
import type { Container } from "../container.js";
import { config } from "../config.js";
import {
  SESSION_COOKIE,
  signSession,
  sessionExpiry,
} from "../auth/session.js";

/** Only allow same-origin relative redirects (guards against open redirect). */
function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export function registerAuthRoutes(app: Express, c: Container): void {
  const router = Router();

  router.get("/login", (req: Request, res: Response) => {
    if (res.locals.currentUser) return res.redirect("/");
    res.render("login", {
      title: "Sign in",
      error: null,
      email: "",
      next: safeNext(req.query.next),
    });
  });

  router.post("/login", (req: Request, res: Response) => {
    const email = String(req.body.email ?? "");
    const password = String(req.body.password ?? "");
    const next = safeNext(req.body.next);
    const key = `${email.trim().toLowerCase()}|${req.ip}`;

    // Brute-force protection: lock the key out after too many failures.
    const gate = c.loginLimiter.status(key);
    if (gate.locked) {
      const mins = Math.ceil(gate.retryAfterMs / 60000);
      res.status(429).render("login", {
        title: "Sign in",
        error: `Too many failed attempts. Try again in about ${mins} minute(s).`,
        email,
        next,
      });
      return;
    }

    const user = c.users.authenticate(email, password);
    if (!user) {
      const after = c.loginLimiter.recordFailure(key);
      res.status(after.locked ? 429 : 401).render("login", {
        title: "Sign in",
        error: after.locked
          ? "Too many failed attempts. This login is temporarily locked."
          : "Invalid email or password.",
        email,
        next,
      });
      return;
    }
    c.loginLimiter.recordSuccess(key);
    c.users.recordLogin(user.id);
    const token = signSession({ uid: user.id, exp: sessionExpiry(14) }, config.sessionSecret);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax", // blocks cross-site POST → mitigates CSRF for the pilot
      secure: config.cookieSecure,
      path: "/",
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
    res.redirect(next);
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.redirect("/login");
  });

  app.use(router);
}
