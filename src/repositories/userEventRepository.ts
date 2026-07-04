import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { UserEvent } from "../domain/schemas.js";
import { nowIso } from "../util/dates.js";
import { rowToUserEvent, type Row } from "./serialize.js";

export interface NewUserEvent {
  org_id: string;
  actor: string;
  action: string;
  target_id?: string | null;
  target_email?: string | null;
  detail?: string | null;
}

/** Append-only audit log of user-management actions (no update/delete). */
export class UserEventRepository {
  constructor(private readonly db: DatabaseSync) {}

  append(e: NewUserEvent): UserEvent {
    const event: UserEvent = {
      id: randomUUID(),
      org_id: e.org_id,
      at: nowIso(),
      actor: e.actor,
      action: e.action,
      target_id: e.target_id ?? null,
      target_email: e.target_email ?? null,
      detail: e.detail ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO user_events (id, org_id, at, actor, action, target_id, target_email, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.org_id,
        event.at,
        event.actor,
        event.action,
        event.target_id,
        event.target_email,
        event.detail,
      );
    return event;
  }

  listForOrg(orgId: string, limit = 50): UserEvent[] {
    return this.db
      .prepare(`SELECT * FROM user_events WHERE org_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(orgId, limit)
      .map((r) => rowToUserEvent(r as Row));
  }
}
