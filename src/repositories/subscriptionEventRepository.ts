import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { SubscriptionEvent } from "../domain/schemas.js";
import { nowIso } from "../util/dates.js";
import { rowToSubscriptionEvent, type Row } from "./serialize.js";

export interface NewSubscriptionEvent {
  org_id: string;
  actor: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  reason?: string | null;
  at?: string;
}

/**
 * Append-only audit log for subscription/plan changes. Exposes no update or
 * delete — billing-sensitive history is immutable, mirroring grant_events.
 */
export class SubscriptionEventRepository {
  constructor(private readonly db: DatabaseSync) {}

  append(e: NewSubscriptionEvent): SubscriptionEvent {
    const event: SubscriptionEvent = {
      id: randomUUID(),
      org_id: e.org_id,
      at: e.at ?? nowIso(),
      actor: e.actor,
      field: e.field,
      old_value: e.old_value,
      new_value: e.new_value,
      reason: e.reason ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO subscription_events (id, org_id, at, actor, field, old_value, new_value, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.org_id,
        event.at,
        event.actor,
        event.field,
        event.old_value,
        event.new_value,
        event.reason,
      );
    return event;
  }

  listForOrg(orgId: string, limit = 50): SubscriptionEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM subscription_events WHERE org_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`,
      )
      .all(orgId, limit)
      .map((r) => rowToSubscriptionEvent(r as Row));
  }
}
