import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { EvidenceItem } from "../domain/schemas.js";
import type { EvidenceType } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToEvidenceItem, type Row } from "./serialize.js";

export interface NewEvidenceItem {
  org_id: string;
  grant_id: string;
  type: EvidenceType;
  filename?: string | null;
  url?: string | null;
  note?: string | null;
  content_hash?: string | null;
  created_by_user_id?: string | null;
  created_by_email?: string | null;
}

/**
 * Evidence items for grants. Append-only chain of custody: no hard deletes;
 * items may be superseded (status + superseded_by) but history is preserved.
 * Designed to extend to other entities later by generalizing grant_id.
 */
export class EvidenceRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: NewEvidenceItem): EvidenceItem {
    const item: EvidenceItem = {
      id: randomUUID(),
      org_id: input.org_id,
      grant_id: input.grant_id,
      type: input.type,
      filename: input.filename ?? null,
      url: input.url ?? null,
      note: input.note ?? null,
      content_hash: input.content_hash ?? null,
      status: "active",
      superseded_by: null,
      created_at: nowIso(),
      created_by_user_id: input.created_by_user_id ?? null,
      created_by_email: input.created_by_email ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO evidence_items
           (id, org_id, grant_id, type, filename, url, note, content_hash, status,
            superseded_by, created_at, created_by_user_id, created_by_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.org_id,
        item.grant_id,
        item.type,
        item.filename,
        item.url,
        item.note,
        item.content_hash,
        item.status,
        item.superseded_by,
        item.created_at,
        item.created_by_user_id,
        item.created_by_email,
      );
    return item;
  }

  findById(id: string): EvidenceItem | null {
    const row = this.db.prepare(`SELECT * FROM evidence_items WHERE id = ?`).get(id);
    return row ? rowToEvidenceItem(row as Row) : null;
  }

  /** Most recent first. */
  listForGrant(grantId: string): EvidenceItem[] {
    return this.db
      .prepare(`SELECT * FROM evidence_items WHERE grant_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(grantId)
      .map((r) => rowToEvidenceItem(r as Row));
  }

  countForGrantByType(grantId: string, type: EvidenceType): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM evidence_items WHERE grant_id = ? AND type = ? AND status = 'active'`,
      )
      .get(grantId, type) as Row;
    return Number(row.n ?? 0);
  }

  /** Mark an item superseded by a newer one (no hard delete). */
  supersede(id: string, supersededBy: string): void {
    this.db
      .prepare(`UPDATE evidence_items SET status = 'superseded', superseded_by = ? WHERE id = ?`)
      .run(supersededBy, id);
  }
}
