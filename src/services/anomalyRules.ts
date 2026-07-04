import type { GrantRecord, GrantEvent } from "../domain/schemas.js";
import type { AnomalySeverity } from "../domain/constants.js";
import { daysBetween, todayIso } from "../util/dates.js";

/**
 * Transparent, deterministic anomaly rules for grant oversight. Thresholds live
 * in one config object (no magic constants scattered in code) so investigators
 * can tune sensitivity. Rules never block changes — they only flag.
 */
export interface AnomalyRuleConfig {
  /** Fractional change (e.g. 0.25 = 25%) in award/expended that counts as large. */
  largeChangePct: number;
  /** "Near a deadline" window, in days, for the last-minute-change rule. */
  deadlineWindowDays: number;
  /** Number of edits that counts as "frequent". */
  frequentEditsCount: number;
  /** Window (days) over which frequent edits are counted. */
  frequentEditsWindowDays: number;
  /** Award amount at/above which a grant is "high value". */
  highValueThreshold: number;
  /** Count of note-type evidence items that flags documentation concerns. */
  repeatedNoteCount: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyRuleConfig = {
  largeChangePct: 0.25,
  deadlineWindowDays: 30,
  frequentEditsCount: 5,
  frequentEditsWindowDays: 7,
  highValueThreshold: 1_000_000,
  repeatedNoteCount: 3,
};

export interface AnomalyDetection {
  rule_name: string;
  severity: AnomalySeverity;
  details: string;
}

export interface AnomalyInput {
  grant: GrantRecord;
  events: GrantEvent[];
  noteEvidenceCount: number;
  asOf?: string;
}

const CHANGE_EVENT_TYPES = new Set([
  "field_changed",
  "status_changed",
  "classification_changed",
]);

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Rule 1 — a large award/expended change close to a deadline. */
function largeLastMinuteChange(input: AnomalyInput, cfg: AnomalyRuleConfig, asOf: string): AnomalyDetection | null {
  const days = daysBetween(asOf, input.grant.expenditure_deadline);
  if (!Number.isFinite(days) || Math.abs(days) > cfg.deadlineWindowDays) return null;
  for (const e of input.events) {
    if (e.field !== "award_amount" && e.field !== "expended_amount") continue;
    const oldV = num(e.old_value);
    const newV = num(e.new_value);
    if (oldV == null || newV == null || oldV <= 0) continue;
    const pct = Math.abs(newV - oldV) / oldV;
    if (pct >= cfg.largeChangePct) {
      return {
        rule_name: "large_last_minute_change",
        severity: "high",
        details: `${e.field.replace("_", " ")} changed ${Math.round(pct * 100)}% (${oldV.toLocaleString()} → ${newV.toLocaleString()}) within ${cfg.deadlineWindowDays} days of the expenditure deadline (${Math.abs(days)}d away).`,
      };
    }
  }
  return null;
}

/** Rule 2 — many edits to a high-value grant in a short window. */
function frequentEdits(input: AnomalyInput, cfg: AnomalyRuleConfig, asOf: string): AnomalyDetection | null {
  if (input.grant.award_amount < cfg.highValueThreshold) return null;
  const recent = input.events.filter(
    (e) =>
      CHANGE_EVENT_TYPES.has(e.event_type) &&
      daysBetween(e.at.slice(0, 10), asOf) <= cfg.frequentEditsWindowDays,
  );
  if (recent.length >= cfg.frequentEditsCount) {
    return {
      rule_name: "frequent_edits",
      severity: "medium",
      details: `${recent.length} edits in the last ${cfg.frequentEditsWindowDays} days on a high-value grant ($${input.grant.award_amount.toLocaleString()}).`,
    };
  }
  return null;
}

/** Rule 3 — repeated documentation notes (proxy for unclear/missing docs). */
function repeatedDocumentationNotes(input: AnomalyInput, cfg: AnomalyRuleConfig): AnomalyDetection | null {
  if (input.noteEvidenceCount >= cfg.repeatedNoteCount) {
    return {
      rule_name: "repeated_documentation_notes",
      severity: "low",
      details: `${input.noteEvidenceCount} note-type evidence items recorded — repeated documentation concerns.`,
    };
  }
  return null;
}

export function evaluateAnomalies(
  input: AnomalyInput,
  cfg: AnomalyRuleConfig = DEFAULT_ANOMALY_CONFIG,
): AnomalyDetection[] {
  const asOf = input.asOf ?? todayIso();
  const detections: Array<AnomalyDetection | null> = [
    largeLastMinuteChange(input, cfg, asOf),
    frequentEdits(input, cfg, asOf),
    repeatedDocumentationNotes(input, cfg),
  ];
  return detections.filter((d): d is AnomalyDetection => d !== null);
}
