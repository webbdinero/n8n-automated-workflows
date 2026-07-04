import { randomBytes } from "node:crypto";
import type { UserRepository } from "../repositories/userRepository.js";
import type { UserEventRepository } from "../repositories/userEventRepository.js";
import type { User } from "../domain/schemas.js";
import type { UserRole } from "../domain/constants.js";
import { NotFoundError, ValidationError } from "./errors.js";

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
}

export interface CreatedUser {
  user: User;
  /** Generated one-time password — shown to the admin once, never stored plain. */
  password: string;
}

export interface AdminContext {
  actor: string;
}

/**
 * Admin-only user management. Every action is written to the append-only
 * user_events audit log. No self-signup and no in-app password change (yet) —
 * accounts are created by an admin with a generated one-time password.
 */
export class UserAdminService {
  constructor(
    private readonly users: UserRepository,
    private readonly events: UserEventRepository,
  ) {}

  createUser(orgId: string, input: CreateUserInput, ctx: AdminContext): CreatedUser {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ValidationError("A valid email is required");
    }
    if (!input.name.trim()) throw new ValidationError("Name is required");
    if (this.users.findByEmail(email)) {
      throw new ValidationError("A user with that email already exists");
    }
    const password = randomBytes(9).toString("base64url"); // ~12 chars
    const user = this.users.create({
      org_id: orgId,
      email,
      name: input.name.trim(),
      role: input.role,
      password,
      must_change_password: true, // forced change on first login
    });
    this.events.append({
      org_id: orgId,
      actor: ctx.actor,
      action: "user_created",
      target_id: user.id,
      target_email: user.email,
      detail: `role=${user.role}`,
    });
    return { user, password };
  }

  /** Admin-triggered password reset: new one-time password + forced change. */
  resetPassword(orgId: string, targetId: string, ctx: AdminContext): CreatedUser {
    const target = this.users.findById(targetId);
    if (!target || target.org_id !== orgId) throw new NotFoundError("User not found");
    if (target.deactivated_at) {
      throw new ValidationError("Cannot reset a deactivated user");
    }
    const password = randomBytes(9).toString("base64url");
    this.users.setPassword(targetId, password, true);
    this.events.append({
      org_id: orgId,
      actor: ctx.actor,
      action: "password_reset",
      target_id: target.id,
      target_email: target.email,
      detail: null,
    });
    return { user: target, password };
  }

  deactivateUser(orgId: string, targetId: string, ctx: AdminContext): User {
    const target = this.users.findById(targetId);
    if (!target || target.org_id !== orgId) throw new NotFoundError("User not found");
    if (target.deactivated_at) return target; // idempotent
    if (target.email === ctx.actor) {
      throw new ValidationError("You cannot deactivate your own account");
    }
    if (target.role === "admin" && this.users.countActiveAdmins(orgId) <= 1) {
      throw new ValidationError("Cannot deactivate the last active administrator");
    }
    this.users.deactivate(targetId);
    this.events.append({
      org_id: orgId,
      actor: ctx.actor,
      action: "user_deactivated",
      target_id: target.id,
      target_email: target.email,
      detail: null,
    });
    return { ...target, deactivated_at: new Date().toISOString() };
  }

  history(orgId: string, limit = 50) {
    return this.events.listForOrg(orgId, limit);
  }
}
