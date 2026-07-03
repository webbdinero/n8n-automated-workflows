import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { User } from "../domain/schemas.js";
import type { UserRole } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { rowToUser, type Row } from "./serialize.js";

export interface NewUser {
  org_id: string;
  email: string;
  name: string;
  role?: UserRole;
  password: string;
}

/**
 * Operator accounts. Password hashing/verification is encapsulated here so the
 * hash never leaves the repository; callers only ever see the public `User`.
 */
export class UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: NewUser): User {
    const user: User = {
      id: randomUUID(),
      org_id: input.org_id,
      email: input.email.trim().toLowerCase(),
      name: input.name,
      role: input.role ?? "member",
      created_at: nowIso(),
      last_login_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, password_hash, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.org_id,
        user.email,
        user.name,
        user.role,
        hashPassword(input.password),
        user.created_at,
        user.last_login_at,
      );
    return user;
  }

  findByEmail(email: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email.trim().toLowerCase());
    return row ? rowToUser(row as Row) : null;
  }

  findById(id: string): User | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    return row ? rowToUser(row as Row) : null;
  }

  /** Verify credentials. Returns the public user on success, null otherwise. */
  authenticate(email: string, password: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email.trim().toLowerCase()) as Row | undefined;
    if (!row) return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;
    return rowToUser(row);
  }

  recordLogin(id: string): void {
    this.db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  countForOrg(orgId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE org_id = ?`)
      .get(orgId) as Row;
    return Number(row.n ?? 0);
  }

  listForOrg(orgId: string): User[] {
    return this.db
      .prepare(`SELECT * FROM users WHERE org_id = ? ORDER BY created_at`)
      .all(orgId)
      .map((r) => rowToUser(r as Row));
  }
}
