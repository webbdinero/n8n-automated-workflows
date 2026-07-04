import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { SecurityEvent } from "../domain/schemas.js";
import { nowIso } from "../util/dates.js";
import { rowToSecurityEvent, type Row } from "./serialize.js";

export interface NewSecurityEvent {
  event: string; // login_success | login_failure | login_lockout | password_changed | password_reset
  email?: string | null;
  ip?: string | null;
  org_id?: string | null;
  actor?: string | null;
  detail?: string | null;
}

/**
 * Append-only auth/security event log. Persists a structured row AND emits a
 * structured JSON line to stdout (skipped under tests) so ops tooling can
 * scrape it. Never receives or stores raw passwords.
 */
export class SecurityEventRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(e: NewSecurityEvent): SecurityEvent {
    const event: SecurityEvent = {
      id: randomUUID(),
      at: nowIso(),
      event: e.event,
      email: e.email ?? null,
      ip: e.ip ?? null,
      org_id: e.org_id ?? null,
      actor: e.actor ?? null,
      detail: e.detail ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO security_events (id, at, event, email, ip, org_id, actor, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(event.id, event.at, event.event, event.email, event.ip, event.org_id, event.actor, event.detail);

    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts: event.at,
          level: event.event.includes("failure") || event.event.includes("lockout") ? "warn" : "info",
          kind: "security",
          event: event.event,
          email: event.email,
          ip: event.ip,
          detail: event.detail,
        }),
      );
    }
    return event;
  }

  listRecent(limit = 50): SecurityEvent[] {
    return this.db
      .prepare(`SELECT * FROM security_events ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(limit)
      .map((r) => rowToSecurityEvent(r as Row));
  }
}
