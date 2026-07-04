import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { signSession, verifySession, sessionExpiry } from "../src/auth/session.js";
import { ensureBootstrapAdmin } from "../src/auth/bootstrap.js";
import { newCtx } from "./support.js";

describe("password hashing", () => {
  it("verifies the correct password and rejects the wrong one", () => {
    const stored = hashPassword("s3cret-pw");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("s3cret-pw", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("uses a random salt (same password → different hash)", () => {
    expect(hashPassword("pw")).not.toBe(hashPassword("pw"));
  });

  it("rejects malformed stored hashes without throwing", () => {
    expect(verifyPassword("pw", "")).toBe(false);
    expect(verifyPassword("pw", "not-a-hash")).toBe(false);
    expect(verifyPassword("pw", "scrypt$abc")).toBe(false);
  });
});

describe("signed sessions", () => {
  const secret = "test-secret";

  it("round-trips a valid session", () => {
    const token = signSession({ uid: "u1", exp: sessionExpiry(1) }, secret);
    const payload = verifySession(token, secret);
    expect(payload?.uid).toBe("u1");
  });

  it("rejects a tampered payload", () => {
    const token = signSession({ uid: "u1", exp: sessionExpiry(1) }, secret);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: sessionExpiry(1) })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, secret)).toBeNull();
  });

  it("rejects a bad signature and a wrong secret", () => {
    const token = signSession({ uid: "u1", exp: sessionExpiry(1) }, secret);
    expect(verifySession(`${token}x`, secret)).toBeNull();
    expect(verifySession(token, "other-secret")).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = signSession({ uid: "u1", exp: sessionExpiry(-1) }, secret);
    expect(verifySession(token, secret)).toBeNull();
  });
});

describe("UserRepository", () => {
  it("authenticates by email (case-insensitive) and never leaks the hash", () => {
    const { c, org } = newCtx();
    const user = c.users.create({
      org_id: org.id,
      email: "Jane@Borough.GOV",
      name: "Jane",
      role: "admin",
      password: "pw123456",
    });
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
    expect(c.users.authenticate("jane@borough.gov", "pw123456")?.id).toBe(user.id);
    expect(c.users.authenticate("jane@borough.gov", "nope")).toBeNull();
    expect(c.users.authenticate("missing@x.com", "pw")).toBeNull();
  });

  it("records login time and counts users", () => {
    const { c, org } = newCtx();
    const u = c.users.create({ org_id: org.id, email: "a@b.c", name: "A", password: "pw123456" });
    expect(c.users.findById(u.id)!.last_login_at).toBeNull();
    c.users.recordLogin(u.id);
    expect(c.users.findById(u.id)!.last_login_at).not.toBeNull();
    expect(c.users.countForOrg(org.id)).toBe(1);
  });
});

describe("bootstrap admin", () => {
  it("creates an admin only when the org has none", () => {
    const { c, org } = newCtx();
    const first = ensureBootstrapAdmin(c, org.id, { email: "admin@x.com", name: "Admin", password: "pw123456" });
    expect(first.created).toBe(true);
    expect(c.users.authenticate("admin@x.com", "pw123456")?.role).toBe("admin");
    const second = ensureBootstrapAdmin(c, org.id, { email: "other@x.com", name: "Other", password: "pw" });
    expect(second.created).toBe(false);
    expect(c.users.countForOrg(org.id)).toBe(1);
  });
});

describe("org API token", () => {
  it("generates once, is idempotent, and rotates", () => {
    const { c, org } = newCtx();
    const t1 = c.orgs.ensureApiToken(org.id);
    expect(t1).toMatch(/^gg_/);
    expect(c.orgs.ensureApiToken(org.id)).toBe(t1); // idempotent
    expect(c.orgs.findByApiToken(t1!)?.id).toBe(org.id);
    const t2 = c.orgs.rotateApiToken(org.id);
    expect(t2).not.toBe(t1);
    expect(c.orgs.findByApiToken(t1!)).toBeNull(); // old token invalid
    expect(c.orgs.findByApiToken(t2)?.id).toBe(org.id);
  });
});
