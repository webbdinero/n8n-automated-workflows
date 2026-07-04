import { z } from "zod";
import type { GrantService, ActorContext } from "./grantService.js";
import { grantInputSchema } from "../domain/schemas.js";
import { FUNDING_SOURCES, GRANT_STATUSES } from "../domain/constants.js";
import { parseCsv } from "./csv.js";
import { DuplicateGrantError } from "./errors.js";

export interface IngestResult {
  created: number;
  duplicates: number;
  failed: number;
  total: number;
  errors: Array<{ row: number; grant_number?: string; message: string }>;
  createdIds: string[];
}

/**
 * Header aliases → canonical field. Anything a normal grant spreadsheet is
 * likely to call these columns maps cleanly so pilot customers can import
 * their existing tracker with no reformatting.
 */
const FIELD_ALIASES: Record<string, string> = {
  grant_number: "grant_number",
  "grant #": "grant_number",
  "grant no": "grant_number",
  "grant no.": "grant_number",
  number: "grant_number",
  award_number: "grant_number",
  "award #": "grant_number",
  "award id": "grant_number",
  id: "grant_number",

  title: "title",
  name: "title",
  project: "title",
  project_name: "title",
  "project name": "title",
  description: "title",

  funding_source: "funding_source",
  "funding source": "funding_source",
  source: "funding_source",
  fund: "funding_source",

  program: "program",
  program_name: "program",

  grantor: "grantor",
  agency: "grantor",
  funder: "grantor",
  awarding_agency: "grantor",
  "awarding agency": "grantor",

  subrecipient: "subrecipient",
  "sub-recipient": "subrecipient",
  vendor: "subrecipient",

  department: "department",
  dept: "department",
  "owner department": "department",

  category: "category",
  expenditure_category: "category",
  "expenditure category": "category",
  use: "category",

  award_amount: "award_amount",
  "award amount": "award_amount",
  award: "award_amount",
  amount: "award_amount",
  total_award: "award_amount",

  obligated_amount: "obligated_amount",
  "obligated amount": "obligated_amount",
  obligated: "obligated_amount",

  expended_amount: "expended_amount",
  "expended amount": "expended_amount",
  expended: "expended_amount",
  spent: "expended_amount",
  expenditures: "expended_amount",

  award_date: "award_date",
  "award date": "award_date",
  awarded: "award_date",
  start_date: "award_date",
  "start date": "award_date",
  effective_date: "award_date",

  obligation_deadline: "obligation_deadline",
  "obligation deadline": "obligation_deadline",
  obligate_by: "obligation_deadline",
  "obligate by": "obligation_deadline",

  expenditure_deadline: "expenditure_deadline",
  "expenditure deadline": "expenditure_deadline",
  spend_by: "expenditure_deadline",
  "spend by": "expenditure_deadline",
  end_date: "expenditure_deadline",
  "end date": "expenditure_deadline",
  deadline: "expenditure_deadline",

  period_of_performance_end: "period_of_performance_end",
  pop_end: "period_of_performance_end",
  performance_end: "period_of_performance_end",

  status: "status",
  assigned_to: "assigned_to",
  "assigned to": "assigned_to",
  owner: "assigned_to",
  assignee: "assigned_to",
  manager: "assigned_to",

  classification: "classification",
};

const DATE_FIELDS = new Set([
  "award_date",
  "obligation_deadline",
  "expenditure_deadline",
  "period_of_performance_end",
]);

/** Normalize common date formats to YYYY-MM-DD; pass through if unrecognized. */
export function normalizeDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // M/D/YYYY
  if (m) return `${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}`;
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s); // YYYY/M/D
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

function pad(n: string): string {
  return n.padStart(2, "0");
}

function normalizeFundingSource(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const upper = v.toUpperCase().replace(/[\s-]+/g, "_");
  if ((FUNDING_SOURCES as readonly string[]).includes(upper)) return upper;
  if (/ARPA|SLFRF|RECOVERY/i.test(v)) return "ARPA_SLFRF";
  if (/CDBG/i.test(v)) return "CDBG";
  if (/FEMA/i.test(v)) return "FEMA";
  if (/\bEPA\b/i.test(v)) return "EPA";
  if (/IIJA|INFRASTRUCTURE|\bDOT\b/i.test(v)) return "DOT_IIJA";
  if (/\bHUD\b/i.test(v)) return "HUD";
  if (/\bUSDA\b/i.test(v)) return "USDA";
  if (/STATE/i.test(v)) return "STATE";
  return "OTHER";
}

function normalizeStatus(raw: string): string | undefined {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return undefined;
  return (GRANT_STATUSES as readonly string[]).includes(v) ? v : "active";
}

/** Map an arbitrary row (spreadsheet/JSON) to canonical, typed-ish input. */
export function mapRawGrant(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const canonical = FIELD_ALIASES[key.trim().toLowerCase()];
    if (!canonical) continue;
    if (value == null || value === "") continue;
    const strVal = String(value);
    if (DATE_FIELDS.has(canonical)) {
      const d = normalizeDate(strVal);
      if (d) out[canonical] = d;
    } else if (canonical === "funding_source") {
      const f = normalizeFundingSource(strVal);
      if (f) out[canonical] = f;
    } else if (canonical === "status") {
      const s = normalizeStatus(strVal);
      if (s) out[canonical] = s;
    } else {
      out[canonical] = value;
    }
  }
  return out;
}

export class IngestService {
  constructor(private readonly grantService: GrantService) {}

  private ingestRecords(
    orgId: string,
    records: Array<Record<string, unknown>>,
    ctx: ActorContext,
    cap: number | null = null,
  ): IngestResult {
    const result: IngestResult = {
      created: 0,
      duplicates: 0,
      failed: 0,
      total: records.length,
      errors: [],
      createdIds: [],
    };

    records.forEach((raw, index) => {
      const rowNum = index + 1;
      // Enforce the plan's grant limit — new rows beyond the cap fail with an
      // upgrade prompt rather than silently importing.
      if (cap != null && result.created >= cap) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          message: "plan grant limit reached — upgrade to add more grants",
        });
        return;
      }
      const mapped = mapRawGrant(raw);
      const parsed = grantInputSchema.safeParse(mapped);
      if (!parsed.success) {
        result.failed++;
        const first = parsed.error.issues[0];
        result.errors.push({
          row: rowNum,
          grant_number: typeof mapped.grant_number === "string" ? mapped.grant_number : undefined,
          message: first ? `${first.path.join(".") || "record"}: ${first.message}` : "invalid record",
        });
        return;
      }
      try {
        const grant = this.grantService.createGrant(orgId, parsed.data, ctx);
        result.created++;
        result.createdIds.push(grant.id);
      } catch (err) {
        if (err instanceof DuplicateGrantError) {
          result.duplicates++;
          result.errors.push({
            row: rowNum,
            grant_number: parsed.data.grant_number,
            message: "duplicate grant number — skipped",
          });
        } else {
          result.failed++;
          result.errors.push({
            row: rowNum,
            grant_number: parsed.data.grant_number,
            message: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    });
    return result;
  }

  ingestCsv(orgId: string, text: string, ctx: ActorContext, cap: number | null = null): IngestResult {
    const { rows } = parseCsv(text);
    return this.ingestRecords(orgId, rows, ctx, cap);
  }

  ingestJson(orgId: string, text: string, ctx: ActorContext, cap: number | null = null): IngestResult {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return {
        created: 0,
        duplicates: 0,
        failed: 0,
        total: 0,
        errors: [{ row: 0, message: `Invalid JSON: ${(err as Error).message}` }],
        createdIds: [],
      };
    }
    const arr = z
      .union([z.array(z.record(z.unknown())), z.object({ grants: z.array(z.record(z.unknown())) })])
      .safeParse(data);
    let records: Array<Record<string, unknown>> = [];
    if (arr.success) {
      records = Array.isArray(arr.data) ? arr.data : arr.data.grants;
    } else if (data && typeof data === "object") {
      records = [data as Record<string, unknown>];
    }
    return this.ingestRecords(orgId, records, ctx, cap);
  }
}
