import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";

describe("record lifecycle", () => {
  it("captures a full audit trail across create → task → complete → review", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "clerk", source: "manual" });
    const task = c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Q report", due_date: "2099-01-01" },
      { actor: "clerk", source: "manual" },
    );
    c.grantService.completeTask(task.id, { actor: "clerk", source: "manual" });
    c.grantService.updateGrant(
      g.id,
      { classification: "compliant", review_notes: "Reviewed and clean" },
      { actor: "reviewer", source: "manual" },
    );

    const types = c.events.listForGrant(g.id).map((e) => e.event_type);
    expect(types).toContain("created");
    expect(types).toContain("task_created");
    expect(types).toContain("task_completed");
    expect(types).toContain("classification_changed");
    expect(types).toContain("note_added");

    // History only grows — nothing is deleted/overwritten.
    expect(c.events.listForGrant(g.id).length).toBeGreaterThanOrEqual(5);
    expect(c.grants.findById(g.id)!.last_reviewed_at).not.toBeNull();
  });

  it("completeTask is idempotent (no duplicate completion events)", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    const task = c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Q", due_date: "2099-01-01" },
      { actor: "u", source: "manual" },
    );
    const first = c.grantService.completeTask(task.id, { actor: "u", source: "manual" });
    const second = c.grantService.completeTask(task.id, { actor: "u", source: "manual" });
    expect(second.outcome).toBe(first.outcome);
    const completions = c.events
      .listForGrant(g.id)
      .filter((e) => e.event_type === "task_completed");
    expect(completions).toHaveLength(1);
  });
});

describe("usage metering", () => {
  it("records and aggregates metered actions by kind", () => {
    const { c, org } = newCtx();
    c.usage.record({ org_id: org.id, kind: "packet_generated", actor: "u", ref: "g1" });
    c.usage.record({ org_id: org.id, kind: "packet_generated", actor: "u", ref: "g2" });
    c.usage.record({ org_id: org.id, kind: "export_csv", actor: "u" });
    const counts = c.usage.countsByKind(org.id);
    expect(counts.packet_generated).toBe(2);
    expect(counts.export_csv).toBe(1);
    expect(c.usage.recent(org.id, 10)).toHaveLength(3);
  });
});

describe("subscription updates", () => {
  it("persists plan/status/opt-in changes", () => {
    const { c, org } = newCtx();
    expect(org.plan).toBe("trial");
    c.orgs.updateSubscription(org.id, {
      plan: "pilot",
      subscription_status: "active",
      data_sharing_opt_in: true,
    });
    const updated = c.orgs.findById(org.id)!;
    expect(updated.plan).toBe("pilot");
    expect(updated.subscription_status).toBe("active");
    expect(updated.data_sharing_opt_in).toBe(true);
  });
});
