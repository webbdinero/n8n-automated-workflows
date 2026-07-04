import { describe, it, expect } from "vitest";
import { newCtx } from "./support.js";
import { ValidationError } from "../src/services/errors.js";

describe("UserAdminService", () => {
  it("creates a user with a generated password and audits it", () => {
    const { c, org } = newCtx();
    const { user, password } = c.userAdminService.createUser(
      org.id,
      { email: "New.User@x.com", name: "New User", role: "member" },
      { actor: "admin@x.com" },
    );
    expect(user.email).toBe("new.user@x.com");
    expect(password.length).toBeGreaterThanOrEqual(10);
    // The generated password actually works.
    expect(c.users.authenticate("new.user@x.com", password)?.id).toBe(user.id);
    // Audited.
    const log = c.userAdminService.history(org.id);
    const ev = log.find((e) => e.action === "user_created");
    expect(ev?.actor).toBe("admin@x.com");
    expect(ev?.target_email).toBe("new.user@x.com");
    expect(ev?.detail).toContain("member");
  });

  it("rejects duplicate emails and invalid input", () => {
    const { c, org } = newCtx();
    c.userAdminService.createUser(org.id, { email: "dup@x.com", name: "A", role: "member" }, { actor: "admin" });
    expect(() =>
      c.userAdminService.createUser(org.id, { email: "dup@x.com", name: "B", role: "member" }, { actor: "admin" }),
    ).toThrow(ValidationError);
    expect(() =>
      c.userAdminService.createUser(org.id, { email: "not-an-email", name: "B", role: "member" }, { actor: "admin" }),
    ).toThrow(ValidationError);
  });

  it("deactivates a user, audits it, and blocks their login", () => {
    const { c, org } = newCtx();
    const { user, password } = c.userAdminService.createUser(
      org.id,
      { email: "victim@x.com", name: "V", role: "member" },
      { actor: "admin@x.com" },
    );
    expect(c.users.authenticate("victim@x.com", password)).not.toBeNull();
    c.userAdminService.deactivateUser(org.id, user.id, { actor: "admin@x.com" });
    // Deactivated users can no longer authenticate.
    expect(c.users.authenticate("victim@x.com", password)).toBeNull();
    expect(c.userAdminService.history(org.id).some((e) => e.action === "user_deactivated")).toBe(true);
  });

  it("prevents deactivating your own account", () => {
    const { c, org } = newCtx();
    const { user } = c.userAdminService.createUser(
      org.id,
      { email: "self@x.com", name: "Self", role: "admin" },
      { actor: "admin@x.com" },
    );
    expect(() =>
      c.userAdminService.deactivateUser(org.id, user.id, { actor: "self@x.com" }),
    ).toThrow(ValidationError);
  });

  it("prevents deactivating the last active admin", () => {
    const { c, org } = newCtx();
    const { user } = c.userAdminService.createUser(
      org.id,
      { email: "onlyadmin@x.com", name: "Only", role: "admin" },
      { actor: "someone@x.com" },
    );
    // Deactivating by a different actor would otherwise be allowed, but it's the
    // last admin.
    expect(() =>
      c.userAdminService.deactivateUser(org.id, user.id, { actor: "someone@x.com" }),
    ).toThrow(ValidationError);
  });
});
