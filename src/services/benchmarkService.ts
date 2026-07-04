import type { GrantRecord, TaskRecord } from "../domain/schemas.js";

/**
 * Cross-organization benchmarking — the intelligence layer and long-term data
 * moat. Because every customer's grants, outcomes, and reporting turnaround are
 * captured in the same canonical schema, we can compute anonymized peer
 * benchmarks that no single municipality could produce alone. This is the seed
 * of a licensable "how do you compare to peers" reporting product.
 */

export interface OrgMetrics {
  grantCount: number;
  totalAward: number;
  burnRatePct: number; // expended / award
  unspentPct: number;
  onTimeReportPct: number; // completed on_time / completed
  avgTurnaroundDays: number | null;
  atRiskPct: number; // high|critical / active grants
}

const TERMINAL = new Set(["closed", "deobligated"]);

export function orgMetrics(grants: GrantRecord[], tasks: TaskRecord[]): OrgMetrics {
  const totalAward = grants.reduce((s, g) => s + g.award_amount, 0);
  const totalExpended = grants.reduce((s, g) => s + g.expended_amount, 0);

  const completed = tasks.filter((t) => t.status === "completed");
  const onTime = completed.filter((t) => t.outcome === "on_time").length;
  const turnarounds = completed
    .map((t) => t.turnaround_days)
    .filter((d): d is number => typeof d === "number");

  const active = grants.filter((g) => !TERMINAL.has(g.status));
  const atRisk = active.filter(
    (g) => g.risk_tier === "high" || g.risk_tier === "critical",
  ).length;

  return {
    grantCount: grants.length,
    totalAward,
    burnRatePct: totalAward > 0 ? totalExpended / totalAward : 0,
    unspentPct: totalAward > 0 ? Math.max(0, totalAward - totalExpended) / totalAward : 0,
    onTimeReportPct: completed.length > 0 ? onTime / completed.length : 0,
    avgTurnaroundDays:
      turnarounds.length > 0
        ? turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length
        : null,
    atRiskPct: active.length > 0 ? atRisk / active.length : 0,
  };
}

export interface BenchmarkComparison {
  org: OrgMetrics;
  peer: OrgMetrics;
  peerOrgCount: number;
}

/**
 * Compare one org against the pooled anonymized peer set (all other orgs).
 */
export function comparePeers(
  current: { grants: GrantRecord[]; tasks: TaskRecord[] },
  peers: Array<{ grants: GrantRecord[]; tasks: TaskRecord[] }>,
): BenchmarkComparison {
  const pooledGrants = peers.flatMap((p) => p.grants);
  const pooledTasks = peers.flatMap((p) => p.tasks);
  return {
    org: orgMetrics(current.grants, current.tasks),
    peer: orgMetrics(pooledGrants, pooledTasks),
    peerOrgCount: peers.length,
  };
}
