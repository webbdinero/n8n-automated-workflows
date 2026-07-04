import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { createContainer, type Container } from "../src/container.js";
import { openMemoryDb } from "../src/db/connection.js";
import { config } from "../src/config.js";
import { csrfFromSessionValue } from "../src/auth/csrf.js";
import { grantInput } from "./support.js";

/**
 * End-to-end auth flow over real HTTP (no new deps — Node global fetch).
 * Proves the three things the pilot depends on:
 *   1. Unauthenticated web access is blocked (redirect to /login).
 *   2. The JSON API is closed without a valid per-org token.
 *   3. A logged-in user's action is attributed to THAT user in the audit trail.
 */
let server: Server;
let baseUrl: string;
let container: Container;
let grantId: string;
let apiToken: string;

beforeAll(async () => {
  container = createContainer(openMemoryDb());
  // Slug must match config.defaultOrgSlug so the app's context resolves it.
  const org = container.orgs.create({
    slug: config.defaultOrgSlug,
    name: "Pilot Org",
    type: "municipality",
  });
  container.users.create({
    org_id: org.id,
    email: "jane@pilot.gov",
    name: "Jane Rivera",
    role: "admin",
    password: "pw123456",
  });
  grantId = container.grantService.createGrant(org.id, grantInput(), {
    actor: "seed",
    source: "manual",
  }).id;
  apiToken = container.orgs.ensureApiToken(org.id)!;

  const { app } = createApp({ container, ensureDefaultOrg: false });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "jane@pilot.gov", password: "pw123456" }),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0]!; // gg_session=<token>
}

describe("auth flow (end-to-end)", () => {
  it("blocks unauthenticated web access with a redirect to /login", async () => {
    const res = await fetch(`${baseUrl}/grants`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("rejects the JSON API without a token, accepts it with one", async () => {
    const noToken = await fetch(`${baseUrl}/api/grants`);
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`${baseUrl}/api/grants`, {
      headers: { authorization: "Bearer gg_wrong" },
    });
    expect(badToken.status).toBe(401);

    const good = await fetch(`${baseUrl}/api/grants`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(good.status).toBe(200);
  });

  it("rejects invalid credentials", async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "jane@pilot.gov", password: "wrong" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("allows authenticated access and attributes the audit entry to the real user", async () => {
    const cookie = await login();

    // Authenticated request now succeeds.
    const page = await fetch(`${baseUrl}/grants`, { headers: { cookie }, redirect: "manual" });
    expect(page.status).toBe(200);

    // Mutate a grant as the logged-in user (with the session-bound CSRF token).
    const sessionValue = cookie.slice(cookie.indexOf("=") + 1);
    const csrf = csrfFromSessionValue(sessionValue, config.sessionSecret)!;
    const upd = await fetch(`${baseUrl}/grants/${grantId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ assigned_to: "Assigned By Jane", _csrf: csrf }),
      redirect: "manual",
    });
    expect(upd.status).toBe(302);

    // The audit trail records the user's identity, not a hardcoded actor.
    const change = container.events
      .listForGrant(grantId)
      .find((e) => e.field === "assigned_to");
    expect(change).toBeTruthy();
    expect(change!.actor).toBe("jane@pilot.gov");
  });

  it("blocks an authenticated POST that is missing the CSRF token", async () => {
    const cookie = await login();
    const res = await fetch(`${baseUrl}/grants/${grantId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ assigned_to: "No CSRF" }), // no _csrf
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });
});
