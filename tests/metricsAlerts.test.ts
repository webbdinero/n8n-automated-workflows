import { describe, it, expect } from "vitest";
import { portfolioSummary } from "../src/services/metrics.js";
import { deriveAlerts } from "../src/services/alertService.js";
import { orgMetrics, comparePeers } from "../src/services/benchmarkService.js";
import { newCtx, grantInput } from "./support.js";

const ASOF = "2026-07-03";

describe("portfolioSummary", () => {
  it("aggregates totals and flags unspent exposure near the deadline", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(
      org.id,
      grantInput({ grant_number: "S-1", award_amount: 1_000_000, expended_amount: 100_000, expenditure_deadline: "2026-08-01" }),
      { actor: "u", source: "manual" },
    );
    c.grantService.createGrant(
      org.id,
      grantInput({ grant_number: "S-2", award_amount: 500_000, expended_amount: 500_000, expenditure_deadline: "2027-12-31" }),
      { actor: "u", source: "manual" },
    );
    const summary = portfolioSummary(c.grants.listAll(org.id), c.tasks.listForOrg(org.id), ASOF);
    expect(summary.totalGrants).toBe(2);
    expect(summary.totalAward).toBe(1_500_000);
    expect(summary.totalUnspent).toBe(900_000);
    expect(summary.expiringSoonCount).toBe(1);
    expect(summary.expiringSoonUnspent).toBe(900_000);
  });
});

describe("deriveAlerts", () => {
  it("raises a critical alert for unspent funds past the expenditure deadline", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(
      org.id,
      grantInput({ grant_number: "P-1", award_amount: 1_000_000, expended_amount: 200_000, expenditure_deadline: "2026-01-01" }),
      { actor: "u", source: "manual" },
    );
    const alerts = deriveAlerts(c.grants.listAll(org.id), c.tasks.listForOrg(org.id), ASOF);
    const crit = alerts.find((a) => a.kind === "Expenditure deadline passed");
    expect(crit).toBeTruthy();
    expect(crit?.severity).toBe("critical");
  });

  it("raises an overdue-report alert", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput({ grant_number: "R-1" }), { actor: "u", source: "manual" });
    c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Old report", due_date: "2026-01-01" },
      { actor: "u", source: "manual" },
    );
    const alerts = deriveAlerts(c.grants.listAll(org.id), c.tasks.listForOrg(org.id), ASOF);
    expect(alerts.some((a) => a.kind === "Overdue report")).toBe(true);
  });

  it("excludes closed grants from alerts", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(
      org.id,
      grantInput({ grant_number: "C-1", status: "closed", expended_amount: 0, expenditure_deadline: "2020-01-01" }),
      { actor: "u", source: "manual" },
    );
    const alerts = deriveAlerts(c.grants.listAll(org.id), c.tasks.listForOrg(org.id), ASOF);
    expect(alerts).toHaveLength(0);
  });
});

describe("benchmarks", () => {
  it("computes org metrics and compares to a peer pool", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(
      org.id,
      grantInput({ grant_number: "B-1", award_amount: 1_000_000, expended_amount: 400_000 }),
      { actor: "u", source: "manual" },
    );
    const me = { grants: c.grants.listAll(org.id), tasks: c.tasks.listForOrg(org.id) };
    const metrics = orgMetrics(me.grants, me.tasks);
    expect(metrics.burnRatePct).toBeCloseTo(0.4, 5);

    const cmp = comparePeers(me, [{ grants: [], tasks: [] }]);
    expect(cmp.peerOrgCount).toBe(1);
    expect(cmp.org.burnRatePct).toBeCloseTo(0.4, 5);
  });
});
