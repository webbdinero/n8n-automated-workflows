import { describe, it, expect } from "vitest";
import { newCtx } from "./support.js";
import { ValidationError } from "../src/services/errors.js";

describe("UserAdminService", () => {
  it("creates a user with a generated password, forces a change, and audits it", () => {
    const { c, org } = newCtx();
    const { user, password } = c.userAdminService.createUser(
      org.id,
      { email: "New.User@x.com", name: "New User", role: "member" },
      { actor: "admin@x.com" },
    );
    expect(user.email).toBe("new.user@x.com");
    expect(user.must_change_password).toBe(true); // forced change on first login
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

  it("resets a password: new one-time credential, forces change, audits, blocks reset of deactivated", () => {
    const { c, org } = newCtx();
    const { user, password } = c.userAdminService.createUser(
      org.id,
      { email: "reset@x.com", name: "R", role: "member" },
      { actor: "admin@x.com" },
    );
    const { password: newPw } = c.userAdminService.resetPassword(org.id, user.id, { actor: "admin@x.com" });
    expect(newPw).not.toBe(password);
    // Old password no longer works; new one does; change is still forced.
    expect(c.users.authenticate("reset@x.com", password)).toBeNull();
    const after = c.users.authenticate("reset@x.com", newPw);
    expect(after?.must_change_password).toBe(true);
    expect(c.userAdminService.history(org.id).some((e) => e.action === "password_reset")).toBe(true);

    // Cannot reset a deactivated user.
    c.userAdminService.deactivateUser(org.id, user.id, { actor: "admin@x.com" });
    expect(() => c.userAdminService.resetPassword(org.id, user.id, { actor: "admin@x.com" })).toThrow(ValidationError);
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
