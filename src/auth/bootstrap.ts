import type { Container } from "../container.js";

export interface BootstrapAdminOptions {
  email: string;
  name: string;
  password: string;
}

export interface BootstrapResult {
  created: boolean;
  email: string;
  /** Only present when a new account was created. */
  password?: string;
}

/**
 * Ensure an org has at least one admin so the app is never locked out, without
 * ever creating duplicates. Returns whether a new account was created (and its
 * password, so callers can surface it once).
 */
export function ensureBootstrapAdmin(
  c: Container,
  orgId: string,
  opts: BootstrapAdminOptions,
): BootstrapResult {
  if (c.users.countForOrg(orgId) > 0) {
    return { created: false, email: "(existing account)" };
  }
  c.users.create({
    org_id: orgId,
    email: opts.email,
    name: opts.name,
    role: "admin",
    password: opts.password,
  });
  return { created: true, email: opts.email.trim().toLowerCase(), password: opts.password };
}
