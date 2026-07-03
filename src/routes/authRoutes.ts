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
    const user = c.users.authenticate(email, password);
    if (!user) {
      res.status(401).render("login", {
        title: "Sign in",
        error: "Invalid email or password.",
        email,
        next,
      });
      return;
    }
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
