import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";
import { DuplicateGrantError } from "../src/services/errors.js";

describe("GrantService.createGrant", () => {
  it("persists the grant, computes a score, and writes a creation event", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    expect(g.id).toBeTruthy();
    expect(c.grants.findById(g.id)).not.toBeNull();
    const events = c.events.listForGrant(g.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("created");
    expect(typeof g.risk_score).toBe("number");
  });

  it("rejects duplicate grant numbers within an org", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    expect(() =>
      c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" }),
    ).toThrow(DuplicateGrantError);
  });
});

describe("GrantService.updateGrant", () => {
  it("records a field-change event per changed field and rescopes review timestamp", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    c.grantService.updateGrant(
      g.id,
      { expended_amount: 10_000, classification: "finding", review_notes: "Concern noted" },
      { actor: "reviewer", source: "manual" },
    );
    const after = c.grants.findById(g.id)!;
    expect(after.expended_amount).toBe(10_000);
    expect(after.classification).toBe("finding");
    expect(after.last_reviewed_at).not.toBeNull();

    const types = c.events.listForGrant(g.id).map((e) => e.event_type);
    expect(types).toContain("field_changed");
    expect(types).toContain("classification_changed");
    expect(types).toContain("note_added");
  });

  it("does not overwrite history — audit trail only grows", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    const before = c.events.listForGrant(g.id).length;
    c.grantService.updateGrant(g.id, { status: "at_risk" }, { actor: "u", source: "manual" });
    const after = c.events.listForGrant(g.id).length;
    expect(after).toBeGreaterThan(before);
  });

  it("recomputes the risk score after a financial change", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(
      org.id,
      grantInput({ expended_amount: 950_000 }),
      { actor: "u", source: "manual" },
    );
    const low = c.grants.findById(g.id)!.risk_score;
    c.grantService.updateGrant(g.id, { expended_amount: 0 }, { actor: "u", source: "manual" });
    const high = c.grants.findById(g.id)!.risk_score;
    expect(high).toBeGreaterThan(low);
  });
});

describe("GrantService tasks", () => {
  it("adds a task, writes an event, and rescopes", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Q3 report", due_date: "2026-09-30" },
      { actor: "u", source: "manual" },
    );
    expect(c.tasks.listForGrant(g.id)).toHaveLength(1);
    expect(c.events.listForGrant(g.id).map((e) => e.event_type)).toContain("task_created");
  });

  it("derives on-time outcome and turnaround on completion", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    const task = c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Future report", due_date: "2099-01-01" },
      { actor: "u", source: "manual" },
    );
    const done = c.grantService.completeTask(task.id, { actor: "u", source: "manual" });
    expect(done.outcome).toBe("on_time");
    expect(done.turnaround_days).toBe(0);
    const stored = c.tasks.findById(task.id)!;
    expect(stored.status).toBe("completed");
  });

  it("derives late outcome when completed past due date", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    const task = c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Past report", due_date: "2000-01-01" },
      { actor: "u", source: "manual" },
    );
    const done = c.grantService.completeTask(task.id, { actor: "u", source: "manual" });
    expect(done.outcome).toBe("late");
  });
});
