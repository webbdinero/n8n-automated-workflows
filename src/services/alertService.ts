import type { GrantRecord, TaskRecord } from "../domain/schemas.js";
import { daysBetween, todayIso } from "../util/dates.js";

export type AlertSeverity = "critical" | "high" | "medium";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  kind: string;
  grant_id: string;
  grant_number: string;
  title: string;
  message: string;
  /** Days until the relevant deadline; negative means overdue/past. */
  days?: number;
}

const TERMINAL = new Set(["closed", "deobligated"]);
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Derive actionable alerts live from grants + tasks. Alerts are computed, not
 * stored, so they are always current for the given "as of" date. Each alert is
 * specific and explains itself — this is what a compliance officer acts on.
 */
export function deriveAlerts(
  grants: GrantRecord[],
  tasks: TaskRecord[],
  asOf: string = todayIso(),
): Alert[] {
  const alerts: Alert[] = [];
  const tasksByGrant = new Map<string, TaskRecord[]>();
  for (const t of tasks) {
    const arr = tasksByGrant.get(t.grant_id) ?? [];
    arr.push(t);
    tasksByGrant.set(t.grant_id, arr);
  }

  for (const g of grants) {
    if (TERMINAL.has(g.status)) continue;
    const unspent = Math.max(0, g.award_amount - g.expended_amount);
    const unobligated = Math.max(0, g.award_amount - g.obligated_amount);

    // 1. Unspent funds past the hard expenditure deadline (clawback exposure).
    const daysToExp = daysBetween(asOf, g.expenditure_deadline);
    if (unspent > 0 && Number.isFinite(daysToExp)) {
      if (daysToExp < 0) {
        alerts.push({
          id: `${g.id}:exp-passed`,
          severity: "critical",
          kind: "Expenditure deadline passed",
          grant_id: g.id,
          grant_number: g.grant_number,
          title: g.title,
          days: daysToExp,
          message: `$${unspent.toLocaleString()} unspent — expenditure deadline passed ${Math.abs(daysToExp)} day(s) ago. Funds may be subject to recoupment.`,
        });
      } else if (daysToExp <= 90) {
        alerts.push({
          id: `${g.id}:exp-soon`,
          severity: daysToExp <= 30 ? "critical" : "high",
          kind: "Expenditure deadline approaching",
          grant_id: g.id,
          grant_number: g.grant_number,
          title: g.title,
          days: daysToExp,
          message: `$${unspent.toLocaleString()} unspent with ${daysToExp} day(s) to the expenditure deadline.`,
        });
      }
    }

    // 2. Unobligated funds near / past the obligation deadline.
    if (g.obligation_deadline && unobligated > 0) {
      const daysToOb = daysBetween(asOf, g.obligation_deadline);
      if (Number.isFinite(daysToOb)) {
        if (daysToOb < 0) {
          alerts.push({
            id: `${g.id}:ob-passed`,
            severity: "critical",
            kind: "Obligation deadline passed",
            grant_id: g.id,
            grant_number: g.grant_number,
            title: g.title,
            days: daysToOb,
            message: `$${unobligated.toLocaleString()} unobligated past the obligation deadline — deobligation risk.`,
          });
        } else if (daysToOb <= 60) {
          alerts.push({
            id: `${g.id}:ob-soon`,
            severity: "high",
            kind: "Obligation deadline approaching",
            grant_id: g.id,
            grant_number: g.grant_number,
            title: g.title,
            days: daysToOb,
            message: `$${unobligated.toLocaleString()} still unobligated with ${daysToOb} day(s) to obligate.`,
          });
        }
      }
    }

    // 3. Overdue reporting obligations.
    const grantTasks = tasksByGrant.get(g.id) ?? [];
    for (const t of grantTasks) {
      if (t.status !== "open" && t.status !== "submitted") continue;
      const d = daysBetween(asOf, t.due_date);
      if (Number.isFinite(d) && d < 0) {
        alerts.push({
          id: `${t.id}:task-overdue`,
          severity: d <= -30 ? "critical" : "high",
          kind: "Overdue report",
          grant_id: g.id,
          grant_number: g.grant_number,
          title: g.title,
          days: d,
          message: `"${t.title}" was due ${Math.abs(d)} day(s) ago and is not yet completed.`,
        });
      }
    }

    // 4. Critical composite risk score (catch-all for compound risk).
    if (g.risk_tier === "critical") {
      alerts.push({
        id: `${g.id}:risk-critical`,
        severity: "high",
        kind: "Critical risk score",
        grant_id: g.id,
        grant_number: g.grant_number,
        title: g.title,
        message: `Composite compliance risk score is ${g.risk_score}/100 (critical).`,
      });
    }
  }

  alerts.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    return (a.days ?? 9999) - (b.days ?? 9999);
  });
  return alerts;
}
