import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { GrantEvent } from "../domain/schemas.js";
import type { EventSource, EventType } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToEvent } from "./serialize.js";

export interface NewEvent {
  org_id: string;
  grant_id: string;
  actor: string;
  event_type: EventType;
  summary: string;
  source?: EventSource;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  at?: string;
}

/**
 * Append-only audit trail. This repository intentionally exposes no update or
 * delete — history is immutable. That immutability is the product's moat: a
 * longitudinal, tamper-evident record of how each grant was managed.
 */
export class EventRepository {
  constructor(private readonly db: DatabaseSync) {}

  append(e: NewEvent): GrantEvent {
    const event: GrantEvent = {
      id: randomUUID(),
      org_id: e.org_id,
      grant_id: e.grant_id,
      at: e.at ?? nowIso(),
      actor: e.actor,
      event_type: e.event_type,
      field: e.field ?? null,
      old_value: e.old_value ?? null,
      new_value: e.new_value ?? null,
      summary: e.summary,
      source: e.source ?? "system",
    };
    this.db
      .prepare(
        `INSERT INTO grant_events
           (id, org_id, grant_id, at, actor, event_type, field, old_value, new_value, summary, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.org_id,
        event.grant_id,
        event.at,
        event.actor,
        event.event_type,
        event.field,
        event.old_value,
        event.new_value,
        event.summary,
        event.source,
      );
    return event;
  }

  listForGrant(grantId: string): GrantEvent[] {
    return this.db
      .prepare(`SELECT * FROM grant_events WHERE grant_id = ? ORDER BY at DESC, rowid DESC`)
      .all(grantId)
      .map((r) => rowToEvent(r as Record<string, unknown>));
  }

  /** Change-history query with optional filters (actor, event type, date range). */
  listForGrantFiltered(
    grantId: string,
    filters: { actor?: string; eventType?: string; from?: string; to?: string } = {},
  ): GrantEvent[] {
    const where: string[] = ["grant_id = ?"];
    const params: (string | number)[] = [grantId];
    if (filters.actor) {
      where.push("actor = ?");
      params.push(filters.actor);
    }
    if (filters.eventType) {
      where.push("event_type = ?");
      params.push(filters.eventType);
    }
    if (filters.from) {
      where.push("at >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      // inclusive end-of-day
      where.push("at <= ?");
      params.push(`${filters.to}T23:59:59.999Z`);
    }
    return this.db
      .prepare(`SELECT * FROM grant_events WHERE ${where.join(" AND ")} ORDER BY at DESC, rowid DESC`)
      .all(...params)
      .map((r) => rowToEvent(r as Record<string, unknown>));
  }

  /** Distinct actors that have touched a grant — for the history filter dropdown. */
  distinctActorsForGrant(grantId: string): string[] {
    return this.db
      .prepare(`SELECT DISTINCT actor FROM grant_events WHERE grant_id = ? ORDER BY actor`)
      .all(grantId)
      .map((r) => String((r as Record<string, unknown>).actor));
  }

  recent(orgId: string, limit = 20): GrantEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM grant_events WHERE org_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`,
      )
      .all(orgId, limit)
      .map((r) => rowToEvent(r as Record<string, unknown>));
  }
}
