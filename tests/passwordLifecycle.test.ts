import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { createContainer, type Container } from "../src/container.js";
import { openMemoryDb } from "../src/db/connection.js";
import { config } from "../src/config.js";
import { csrfFromSessionValue } from "../src/auth/csrf.js";

/**
 * End-to-end first-login forced password change: an admin-created user must set
 * their own (policy-compliant) password before using the app.
 */
let server: Server;
let baseUrl: string;
let container: Container;
let email: string;
let oneTimePassword: string;

beforeAll(async () => {
  container = createContainer(openMemoryDb());
  const org = container.orgs.create({ slug: config.defaultOrgSlug, name: "Pilot", type: "municipality" });
  const created = container.userAdminService.createUser(
    org.id,
    { email: "clerk@pilot.gov", name: "Clerk", role: "member" },
    { actor: "admin@pilot.gov" },
  );
  email = created.user.email;
  oneTimePassword = created.password;

  const { app } = createApp({ container, ensureDefaultOrg: false });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => server?.close());

async function post(path: string, body: Record<string, string>, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
    redirect: "manual",
  });
}

describe("first-login forced password change", () => {
  it("logs in with the one-time password but is forced to the change page", async () => {
    const login = await post("/login", { email, password: oneTimePassword });
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

    // Any app page redirects to the change page until the password is changed.
    const grants = await fetch(`${baseUrl}/grants`, { headers: { cookie }, redirect: "manual" });
    expect(grants.status).toBe(302);
    expect(grants.headers.get("location")).toBe("/account/password");
  });

  it("enforces the policy, then clears the flag and swaps the password", async () => {
    const login = await post("/login", { email, password: oneTimePassword });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = csrfFromSessionValue(cookie.slice(cookie.indexOf("=") + 1), config.sessionSecret)!;

    // Weak password is rejected (still forced).
    const weak = await post(
      "/account/password",
      { current_password: oneTimePassword, new_password: "short", confirm_password: "short", _csrf: csrf },
      cookie,
    );
    expect(weak.status).toBe(400);

    // Wrong current password is rejected.
    const wrongCurrent = await post(
      "/account/password",
      { current_password: "nope", new_password: "Str0ng-Pass!", confirm_password: "Str0ng-Pass!", _csrf: csrf },
      cookie,
    );
    expect(wrongCurrent.status).toBe(401);

    // Strong password succeeds.
    const ok = await post(
      "/account/password",
      { current_password: oneTimePassword, new_password: "Str0ng-Pass!", confirm_password: "Str0ng-Pass!", _csrf: csrf },
      cookie,
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("password_changed=1");

    // Flag cleared; new password works, old one no longer does.
    const reloaded = container.users.findByEmail(email)!;
    expect(reloaded.must_change_password).toBe(false);
    expect(container.users.authenticate(email, "Str0ng-Pass!")).not.toBeNull();
    expect(container.users.authenticate(email, oneTimePassword)).toBeNull();

    // No longer forced: app pages load.
    const relogin = await post("/login", { email, password: "Str0ng-Pass!" });
    const cookie2 = relogin.headers.get("set-cookie")!.split(";")[0]!;
    const grants = await fetch(`${baseUrl}/grants`, { headers: { cookie: cookie2 }, redirect: "manual" });
    expect(grants.status).toBe(200);
  });

  it("records structured security events for logins and the password change", () => {
    const events = container.securityEvents.listRecent(100).map((e) => e.event);
    expect(events).toContain("login_success");
    expect(events).toContain("password_changed");
  });
});
