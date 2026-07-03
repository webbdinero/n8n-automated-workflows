import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { UsageEvent } from "../domain/schemas.js";
import type { UsageKind } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToUsageEvent, type Row } from "./serialize.js";

export interface NewUsageEvent {
  org_id: string;
  kind: UsageKind;
  actor: string;
  quantity?: number;
  ref?: string | null;
  meta?: string | null;
}

/**
 * Metered usage log. Records billing-relevant actions (packet/report
 * generation, exports) so the platform can support usage-based pricing and
 * account for premium-report consumption. Append-only.
 */
export class UsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(e: NewUsageEvent): UsageEvent {
    const ev: UsageEvent = {
      id: randomUUID(),
      org_id: e.org_id,
      at: nowIso(),
      kind: e.kind,
      actor: e.actor,
      quantity: e.quantity ?? 1,
      ref: e.ref ?? null,
      meta: e.meta ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO usage_events (id, org_id, at, kind, actor, quantity, ref, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ev.id, ev.org_id, ev.at, ev.kind, ev.actor, ev.quantity, ev.ref, ev.meta);
    return ev;
  }

  /** Totals by kind since an ISO timestamp (defaults to all time). */
  countsByKind(orgId: string, sinceIso = "0000-01-01"): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT kind, SUM(quantity) AS total FROM usage_events
         WHERE org_id = ? AND at >= ? GROUP BY kind`,
      )
      .all(orgId, sinceIso) as Array<Row>;
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.kind)] = Number(r.total ?? 0);
    return out;
  }

  recent(orgId: string, limit = 20): UsageEvent[] {
    return this.db
      .prepare(`SELECT * FROM usage_events WHERE org_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(orgId, limit)
      .map((r) => rowToUsageEvent(r as Row));
  }
}
