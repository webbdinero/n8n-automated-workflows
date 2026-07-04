import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AnomalyEvent } from "../domain/schemas.js";
import type { AnomalySeverity, AnomalyStatus } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToAnomalyEvent, type Row } from "./serialize.js";

export interface NewAnomalyEvent {
  org_id: string;
  grant_id: string;
  rule_name: string;
  severity: AnomalySeverity;
  details?: string | null;
  created_by?: string;
}

export class AnomalyRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: NewAnomalyEvent): AnomalyEvent {
    const item: AnomalyEvent = {
      id: randomUUID(),
      org_id: input.org_id,
      grant_id: input.grant_id,
      rule_name: input.rule_name,
      severity: input.severity,
      details: input.details ?? null,
      status: "open",
      created_at: nowIso(),
      created_by: input.created_by ?? "system",
      resolved_by_user_id: null,
      resolved_at: null,
      resolution_note: null,
    };
    this.db
      .prepare(
        `INSERT INTO anomaly_events
           (id, org_id, grant_id, rule_name, severity, details, status, created_at,
            created_by, resolved_by_user_id, resolved_at, resolution_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.org_id,
        item.grant_id,
        item.rule_name,
        item.severity,
        item.details,
        item.status,
        item.created_at,
        item.created_by,
        item.resolved_by_user_id,
        item.resolved_at,
        item.resolution_note,
      );
    return item;
  }

  findById(id: string): AnomalyEvent | null {
    const row = this.db.prepare(`SELECT * FROM anomaly_events WHERE id = ?`).get(id);
    return row ? rowToAnomalyEvent(row as Row) : null;
  }

  /** Open anomalies for an org (newest first), for the investigator queue. */
  listOpen(orgId: string): AnomalyEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM anomaly_events WHERE org_id = ? AND status != 'cleared'
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(orgId)
      .map((r) => rowToAnomalyEvent(r as Row));
  }

  listForGrant(grantId: string): AnomalyEvent[] {
    return this.db
      .prepare(`SELECT * FROM anomaly_events WHERE grant_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(grantId)
      .map((r) => rowToAnomalyEvent(r as Row));
  }

  /** Open (or under-review) anomalies for a specific rule on a grant — dedupe. */
  openByRule(grantId: string, ruleName: string): AnomalyEvent | null {
    const row = this.db
      .prepare(
        `SELECT * FROM anomaly_events WHERE grant_id = ? AND rule_name = ? AND status != 'cleared'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(grantId, ruleName);
    return row ? rowToAnomalyEvent(row as Row) : null;
  }

  updateStatus(
    id: string,
    status: AnomalyStatus,
    opts: { resolvedByUserId?: string | null; note?: string | null } = {},
  ): void {
    const resolved = status === "cleared";
    this.db
      .prepare(
        `UPDATE anomaly_events
           SET status = ?, resolved_by_user_id = ?, resolved_at = ?, resolution_note = ?
         WHERE id = ?`,
      )
      .run(
        status,
        resolved ? opts.resolvedByUserId ?? null : null,
        resolved ? nowIso() : null,
        opts.note ?? null,
        id,
      );
  }
}
