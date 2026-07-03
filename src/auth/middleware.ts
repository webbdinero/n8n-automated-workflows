import type { Request, Response, NextFunction } from "express";
import type { Container } from "../container.js";
import { config } from "../config.js";
import { SESSION_COOKIE, verifySession } from "./session.js";

/** Parse the Cookie header into a map (no cookie-parser dependency). */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Paths reachable without a session (login flow, health, static assets). */
function isPublicPath(path: string): boolean {
  return (
    path === "/login" ||
    path === "/logout" ||
    path === "/healthz" ||
    path === "/styles.css" ||
    path === "/app.js"
  );
}

/**
 * Populates res.locals.currentUser from the signed session cookie (or null).
 * Runs on every request; enforcement is done by the gate middlewares below.
 */
export function sessionLoader(c: Container) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const payload = verifySession(cookies[SESSION_COOKIE], config.sessionSecret);
    res.locals.currentUser = payload ? c.users.findById(payload.uid) : null;
    next();
  };
}

/** Gate web (non-API) routes behind a valid session. */
export function requireWebAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next(); // API uses token auth
    if (isPublicPath(req.path)) return next();
    if (res.locals.currentUser) return next();
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  };
}

/** Require the current user to be an admin (billing-sensitive actions). */
export function requireAdmin() {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.currentUser;
    if (user && user.role === "admin") return next();
    res.status(403).render("error", {
      title: "Not allowed",
      message: "This action requires an administrator account.",
    });
  };
}

/**
 * Gate the JSON API behind a per-org bearer token. On success sets
 * res.locals.org to the token's org and the actor to the caller. n8n and other
 * automation send `Authorization: Bearer <token>` or `x-api-key: <token>`.
 */
export function requireApiToken(c: Container) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    const token = bearer || req.header("x-api-key") || "";
    if (!token) {
      res.status(401).json({ error: "unauthorized", message: "Missing API token" });
      return;
    }
    const org = c.orgs.findByApiToken(token);
    if (!org) {
      res.status(401).json({ error: "unauthorized", message: "Invalid API token" });
      return;
    }
    res.locals.org = org;
    res.locals.entitlements = undefined; // recomputed by routes if needed
    const actor = req.header("x-actor");
    res.locals.actor = actor && actor.trim() ? actor.trim() : `api:${org.slug}`;
    next();
  };
}
