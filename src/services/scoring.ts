import type { RiskTier } from "../domain/constants.js";
import { clamp, daysBetween, todayIso } from "../util/dates.js";

/**
 * Compliance risk scoring engine.
 *
 * Pure, deterministic functions: given a grant's financials, deadlines, and
 * compliance tasks (plus an "as of" date), produce a 0–100 risk score and a
 * transparent factor breakdown. Higher = more compliance risk / more urgent.
 *
 * The factor breakdown is deliberately explicit — it is shown in the UI and
 * baked into export packets so a reviewer (or auditor) can see *why* a grant
 * scored the way it did. No black box.
 */

export interface ScoringGrant {
  award_amount: number;
  obligated_amount: number;
  expended_amount: number;
  award_date: string;
  obligation_deadline: string | null;
  expenditure_deadline: string;
  period_of_performance_end?: string | null;
  status: string;
  assigned_to?: string | null;
  department?: string | null;
  category?: string | null;
}

export interface ScoringTask {
  status: string; // open | submitted | completed | waived
  due_date: string;
  outcome: string | null; // on_time | late | missed | waived | null
}

export interface RiskFactor {
  key: string;
  label: string;
  weight: number;
  /** Normalized 0..1 risk contributed by this factor. */
  risk: number;
  /** risk * weight, i.e. points added to the 0..100 score. */
  points: number;
  detail: string;
}

export interface RiskResult {
  score: number; // 0..100 integer
  tier: RiskTier;
  factors: RiskFactor[];
}

const WEIGHTS = {
  burnPace: 30,
  deadlinePressure: 30,
  obligationGap: 15,
  reporting: 20,
  dataCompleteness: 5,
} as const;

export function tierForScore(score: number): RiskTier {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function unspentFraction(g: ScoringGrant): number {
  if (g.award_amount <= 0) return 0;
  return clamp(1 - g.expended_amount / g.award_amount, 0, 1);
}

function unobligatedFraction(g: ScoringGrant): number {
  if (g.award_amount <= 0) return 0;
  return clamp(1 - g.obligated_amount / g.award_amount, 0, 1);
}

/** Are we spending fast enough given elapsed time to the expenditure deadline? */
function burnPaceFactor(g: ScoringGrant, asOf: string): RiskFactor {
  const unspent = unspentFraction(g);
  const totalDays = daysBetween(g.award_date, g.expenditure_deadline);
  const elapsedDays = daysBetween(g.award_date, asOf);
  let timeElapsed = 1;
  if (Number.isFinite(totalDays) && totalDays > 0) {
    timeElapsed = clamp(elapsedDays / totalDays, 0, 1);
  }
  const spentFraction = clamp(1 - unspent, 0, 1);
  const gap = clamp(timeElapsed - spentFraction, 0, 1); // behind pace
  return {
    key: "burnPace",
    label: "Spend pace vs. timeline",
    weight: WEIGHTS.burnPace,
    risk: gap,
    points: gap * WEIGHTS.burnPace,
    detail: `${Math.round(timeElapsed * 100)}% of the performance window has elapsed but only ${Math.round(
      spentFraction * 100,
    )}% of funds are spent.`,
  };
}

/** Proximity of the hard expenditure deadline while funds remain unspent. */
function deadlinePressureFactor(g: ScoringGrant, asOf: string): RiskFactor {
  const unspent = unspentFraction(g);
  const days = daysBetween(asOf, g.expenditure_deadline);
  let risk = 0;
  let detail = "No unspent funds exposed to the expenditure deadline.";
  if (unspent > 0) {
    if (!Number.isFinite(days)) {
      risk = 0;
    } else if (days <= 0) {
      risk = 1;
      detail = `Expenditure deadline passed ${Math.abs(days)} day(s) ago with ${Math.round(
        unspent * 100,
      )}% of funds unspent — clawback exposure.`;
    } else {
      const proximity = clamp((365 - days) / 365, 0, 1);
      risk = proximity * clamp(0.5 + 0.5 * unspent, 0, 1);
      detail = `${days} day(s) to the expenditure deadline with ${Math.round(
        unspent * 100,
      )}% of funds unspent.`;
    }
  }
  return {
    key: "deadlinePressure",
    label: "Expenditure deadline pressure",
    weight: WEIGHTS.deadlinePressure,
    risk,
    points: risk * WEIGHTS.deadlinePressure,
    detail,
  };
}

/** Unobligated funds approaching / past the obligation deadline. */
function obligationGapFactor(g: ScoringGrant, asOf: string): RiskFactor {
  const unobligated = unobligatedFraction(g);
  let risk = 0;
  let detail = "Funds fully obligated or no obligation deadline tracked.";
  if (g.obligation_deadline && unobligated > 0) {
    const days = daysBetween(asOf, g.obligation_deadline);
    if (!Number.isFinite(days)) {
      risk = 0;
    } else if (days <= 0) {
      risk = 1;
      detail = `Obligation deadline passed with ${Math.round(
        unobligated * 100,
      )}% of the award unobligated — deobligation risk.`;
    } else {
      const proximity = clamp((180 - days) / 180, 0, 1);
      risk = proximity * unobligated;
      detail = `${days} day(s) to the obligation deadline with ${Math.round(
        unobligated * 100,
      )}% unobligated.`;
    }
  }
  return {
    key: "obligationGap",
    label: "Obligation gap",
    weight: WEIGHTS.obligationGap,
    risk,
    points: risk * WEIGHTS.obligationGap,
    detail,
  };
}

/** Overdue and missed compliance / reporting obligations. */
function reportingFactor(tasks: ScoringTask[], asOf: string): RiskFactor {
  const relevant = tasks.filter((t) => t.status !== "waived");
  const overdue = relevant.filter(
    (t) =>
      (t.status === "open" || t.status === "submitted") &&
      daysBetween(asOf, t.due_date) < 0,
  ).length;
  const missed = tasks.filter((t) => t.outcome === "missed").length;
  let risk = 0;
  let detail = "No reporting obligations tracked yet.";
  if (relevant.length > 0 || missed > 0) {
    const denom = Math.max(relevant.length, 1);
    risk = clamp((overdue + 2 * missed) / denom, 0, 1);
    detail = `${overdue} overdue and ${missed} missed of ${relevant.length} tracked reporting obligation(s).`;
  }
  return {
    key: "reporting",
    label: "Reporting compliance",
    weight: WEIGHTS.reporting,
    risk,
    points: risk * WEIGHTS.reporting,
    detail,
  };
}

/** Missing structured data — a small risk that also nudges data capture. */
function dataCompletenessFactor(g: ScoringGrant): RiskFactor {
  const checks: Array<[string, boolean]> = [
    ["owner", Boolean(g.assigned_to)],
    ["department", Boolean(g.department)],
    ["category", Boolean(g.category)],
    ["obligation deadline", Boolean(g.obligation_deadline)],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const risk = checks.length === 0 ? 0 : missing.length / checks.length;
  return {
    key: "dataCompleteness",
    label: "Data completeness",
    weight: WEIGHTS.dataCompleteness,
    risk,
    points: risk * WEIGHTS.dataCompleteness,
    detail:
      missing.length === 0
        ? "All key structured fields are populated."
        : `Missing: ${missing.join(", ")}.`,
  };
}

export function scoreGrant(
  g: ScoringGrant,
  tasks: ScoringTask[] = [],
  asOf: string = todayIso(),
): RiskResult {
  // Terminal states are no longer "at risk" — they are historical.
  if (g.status === "closed" || g.status === "deobligated") {
    return {
      score: 0,
      tier: "low",
      factors: [
        {
          key: "terminal",
          label: "Grant closed",
          weight: 0,
          risk: 0,
          points: 0,
          detail: `Grant is ${g.status}; excluded from active risk monitoring.`,
        },
      ],
    };
  }

  const factors = [
    burnPaceFactor(g, asOf),
    deadlinePressureFactor(g, asOf),
    obligationGapFactor(g, asOf),
    reportingFactor(tasks, asOf),
    dataCompletenessFactor(g),
  ];
  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.round(clamp(raw, 0, 100));
  return { score, tier: tierForScore(score), factors };
}
