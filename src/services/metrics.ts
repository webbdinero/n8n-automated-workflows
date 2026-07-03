import type { GrantRecord, TaskRecord } from "../domain/schemas.js";
import type { RiskTier } from "../domain/constants.js";
import { daysBetween, todayIso } from "../util/dates.js";

const TERMINAL = new Set(["closed", "deobligated"]);

export interface FundingBreakdown {
  source: string;
  count: number;
  award: number;
  unspent: number;
}

export interface PortfolioSummary {
  totalGrants: number;
  activeGrants: number;
  totalAward: number;
  totalObligated: number;
  totalExpended: number;
  totalUnspent: number;
  pctSpent: number;
  pctObligated: number;
  byTier: Record<RiskTier, number>;
  atRiskCount: number;
  expiringSoonCount: number;
  expiringSoonUnspent: number;
  unobligatedExposure: number;
  overdueTasks: number;
  upcomingTasks: number;
  byFundingSource: FundingBreakdown[];
}

/**
 * Compute portfolio-level metrics for the dashboard. Pure function of the
 * grant + task lists and the "as of" date, so it is trivially testable and
 * always reflects the current day.
 */
export function portfolioSummary(
  grants: GrantRecord[],
  tasks: TaskRecord[],
  asOf: string = todayIso(),
): PortfolioSummary {
  const byTier: Record<RiskTier, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const fundingMap = new Map<string, FundingBreakdown>();

  let totalAward = 0;
  let totalObligated = 0;
  let totalExpended = 0;
  let activeGrants = 0;
  let atRiskCount = 0;
  let expiringSoonCount = 0;
  let expiringSoonUnspent = 0;
  let unobligatedExposure = 0;

  for (const g of grants) {
    totalAward += g.award_amount;
    totalObligated += g.obligated_amount;
    totalExpended += g.expended_amount;
    const unspent = Math.max(0, g.award_amount - g.expended_amount);

    const fb = fundingMap.get(g.funding_source) ?? {
      source: g.funding_source,
      count: 0,
      award: 0,
      unspent: 0,
    };
    fb.count++;
    fb.award += g.award_amount;
    fb.unspent += unspent;
    fundingMap.set(g.funding_source, fb);

    byTier[g.risk_tier]++;

    const isTerminal = TERMINAL.has(g.status);
    if (!isTerminal) {
      activeGrants++;
      if (g.risk_tier === "high" || g.risk_tier === "critical") atRiskCount++;

      const daysToExp = daysBetween(asOf, g.expenditure_deadline);
      if (unspent > 0 && Number.isFinite(daysToExp) && daysToExp <= 90) {
        expiringSoonCount++;
        expiringSoonUnspent += unspent;
      }

      if (g.obligation_deadline) {
        const unobligated = Math.max(0, g.award_amount - g.obligated_amount);
        const daysToOb = daysBetween(asOf, g.obligation_deadline);
        if (unobligated > 0 && Number.isFinite(daysToOb) && daysToOb <= 60) {
          unobligatedExposure += unobligated;
        }
      }
    }
  }

  const totalUnspent = Math.max(0, totalAward - totalExpended);
  const overdueTasks = tasks.filter(
    (t) =>
      (t.status === "open" || t.status === "submitted") &&
      daysBetween(asOf, t.due_date) < 0,
  ).length;
  const upcomingTasks = tasks.filter((t) => {
    if (t.status !== "open" && t.status !== "submitted") return false;
    const d = daysBetween(asOf, t.due_date);
    return d >= 0 && d <= 30;
  }).length;

  return {
    totalGrants: grants.length,
    activeGrants,
    totalAward,
    totalObligated,
    totalExpended,
    totalUnspent,
    pctSpent: totalAward > 0 ? totalExpended / totalAward : 0,
    pctObligated: totalAward > 0 ? totalObligated / totalAward : 0,
    byTier,
    atRiskCount,
    expiringSoonCount,
    expiringSoonUnspent,
    unobligatedExposure,
    overdueTasks,
    upcomingTasks,
    byFundingSource: [...fundingMap.values()].sort((a, b) => b.award - a.award),
  };
}
