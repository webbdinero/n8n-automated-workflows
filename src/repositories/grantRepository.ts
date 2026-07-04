import type { DatabaseSync } from "node:sqlite";
import type { GrantRecord } from "../domain/schemas.js";
import type { RiskTier } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToGrant, type Row } from "./serialize.js";

export interface GrantFilters {
  status?: string;
  funding_source?: string;
  classification?: string;
  risk_tier?: string;
  assigned_to?: string;
  q?: string;
  sort?: string;
}

const SORTS: Record<string, string> = {
  risk_desc: "risk_score DESC, expenditure_deadline ASC",
  deadline_asc: "expenditure_deadline ASC",
  award_desc: "award_amount DESC",
  updated_desc: "updated_at DESC",
  number_asc: "grant_number ASC",
};

/** Columns that {@link GrantRepository.update} is allowed to write. */
const UPDATABLE_COLUMNS = new Set([
  "grant_number",
  "title",
  "funding_source",
  "program",
  "grantor",
  "subrecipient",
  "department",
  "category",
  "award_amount",
  "obligated_amount",
  "expended_amount",
  "award_date",
  "obligation_deadline",
  "expenditure_deadline",
  "period_of_performance_end",
  "status",
  "assigned_to",
  "classification",
  "review_notes",
  "last_reviewed_at",
  "tags",
  "risk_score",
  "risk_tier",
]);

export class GrantRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(g: GrantRecord): GrantRecord {
    this.db
      .prepare(
        `INSERT INTO grants (
          id, org_id, grant_number, title, funding_source, program, grantor,
          subrecipient, department, category, award_amount, obligated_amount,
          expended_amount, award_date, obligation_deadline, expenditure_deadline,
          period_of_performance_end, status, assigned_to, classification,
          review_notes, last_reviewed_at, tags, risk_score, risk_tier,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      )
      .run(
        g.id,
        g.org_id,
        g.grant_number,
        g.title,
        g.funding_source,
        g.program,
        g.grantor,
        g.subrecipient,
        g.department,
        g.category,
        g.award_amount,
        g.obligated_amount,
        g.expended_amount,
        g.award_date,
        g.obligation_deadline,
        g.expenditure_deadline,
        g.period_of_performance_end,
        g.status,
        g.assigned_to,
        g.classification,
        g.review_notes,
        g.last_reviewed_at,
        JSON.stringify(g.tags ?? []),
        g.risk_score,
        g.risk_tier,
        g.created_at,
        g.updated_at,
      );
    return g;
  }

  /** Apply a partial column update. Unknown columns are ignored defensively. */
  update(id: string, changes: Record<string, unknown>): void {
    const cols = Object.keys(changes).filter((c) => UPDATABLE_COLUMNS.has(c));
    if (cols.length === 0) return;
    const sets = cols.map((c) => `${c} = ?`);
    sets.push("updated_at = ?");
    const values = cols.map((c) => {
      const v = changes[c];
      if (c === "tags") return JSON.stringify(Array.isArray(v) ? v : []);
      return v as string | number | null;
    });
    values.push(nowIso());
    values.push(id);
    this.db
      .prepare(`UPDATE grants SET ${sets.join(", ")} WHERE id = ?`)
      .run(...(values as (string | number | null)[]));
  }

  setScore(id: string, score: number, tier: RiskTier): void {
    this.db
      .prepare(`UPDATE grants SET risk_score = ?, risk_tier = ? WHERE id = ?`)
      .run(score, tier, id);
  }

  findById(id: string): GrantRecord | null {
    const row = this.db.prepare(`SELECT * FROM grants WHERE id = ?`).get(id);
    return row ? rowToGrant(row as Row) : null;
  }

  findByNumber(orgId: string, grantNumber: string): GrantRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM grants WHERE org_id = ? AND grant_number = ?`)
      .get(orgId, grantNumber);
    return row ? rowToGrant(row as Row) : null;
  }

  listAll(orgId: string): GrantRecord[] {
    return this.db
      .prepare(`SELECT * FROM grants WHERE org_id = ?`)
      .all(orgId)
      .map((r) => rowToGrant(r as Row));
  }

  list(orgId: string, filters: GrantFilters = {}): GrantRecord[] {
    const where: string[] = ["org_id = ?"];
    const params: (string | number)[] = [orgId];

    if (filters.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters.funding_source) {
      where.push("funding_source = ?");
      params.push(filters.funding_source);
    }
    if (filters.classification) {
      where.push("classification = ?");
      params.push(filters.classification);
    }
    if (filters.risk_tier) {
      where.push("risk_tier = ?");
      params.push(filters.risk_tier);
    }
    if (filters.assigned_to) {
      where.push("assigned_to = ?");
      params.push(filters.assigned_to);
    }
    if (filters.q && filters.q.trim()) {
      const like = `%${filters.q.trim().toLowerCase()}%`;
      where.push(
        `(LOWER(grant_number) LIKE ? OR LOWER(title) LIKE ? OR LOWER(IFNULL(grantor,'')) LIKE ?
          OR LOWER(IFNULL(subrecipient,'')) LIKE ? OR LOWER(IFNULL(program,'')) LIKE ?
          OR LOWER(IFNULL(category,'')) LIKE ?)`,
      );
      params.push(like, like, like, like, like, like);
    }

    const orderBy = SORTS[filters.sort ?? "risk_desc"] ?? SORTS.risk_desc;
    const sql = `SELECT * FROM grants WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => rowToGrant(r as Row));
  }

  /** Distinct assignee names for filter dropdowns. */
  distinctAssignees(orgId: string): string[] {
    return this.db
      .prepare(
        `SELECT DISTINCT assigned_to FROM grants
         WHERE org_id = ? AND assigned_to IS NOT NULL AND assigned_to <> ''
         ORDER BY assigned_to`,
      )
      .all(orgId)
      .map((r) => String((r as Row).assigned_to));
  }
}
