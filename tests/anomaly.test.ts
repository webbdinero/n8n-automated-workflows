import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";
import { evaluateAnomalies, DEFAULT_ANOMALY_CONFIG } from "../src/services/anomalyRules.js";
import type { GrantEvent, GrantRecord } from "../src/domain/schemas.js";

const ASOF = "2026-07-03";

function evt(over: Partial<GrantEvent>): GrantEvent {
  return {
    id: "e",
    org_id: "o",
    grant_id: "g",
    at: `${ASOF}T12:00:00.000Z`,
    actor: "u@x.com",
    event_type: "field_changed",
    field: null,
    old_value: null,
    new_value: null,
    summary: "",
    source: "manual",
    ...over,
  };
}

function baseGrant(over: Partial<GrantRecord> = {}): GrantRecord {
  const { c, org } = newCtx();
  const g = c.grantService.createGrant(
    org.id,
    grantInput({ award_amount: 2_000_000, expended_amount: 100_000, expenditure_deadline: "2026-07-20" }),
    { actor: "seed", source: "manual" },
  );
  return { ...g, ...over };
}

describe("anomaly rules (evaluateAnomalies)", () => {
  it("flags a large last-minute change near the deadline", () => {
    const grant = baseGrant(); // deadline 2026-07-20, ~17 days from ASOF
    const events = [evt({ field: "expended_amount", old_value: "100000", new_value: "900000" })];
    const dets = evaluateAnomalies({ grant, events, noteEvidenceCount: 0, asOf: ASOF });
    const d = dets.find((x) => x.rule_name === "large_last_minute_change");
    expect(d).toBeTruthy();
    expect(d!.severity).toBe("high");
  });

  it("does NOT flag a large change when far from the deadline", () => {
    const grant = baseGrant({ expenditure_deadline: "2027-12-31" });
    const events = [evt({ field: "award_amount", old_value: "1000000", new_value: "2000000" })];
    const dets = evaluateAnomalies({ grant, events, noteEvidenceCount: 0, asOf: ASOF });
    expect(dets.some((d) => d.rule_name === "large_last_minute_change")).toBe(false);
  });

  it("flags frequent edits on a high-value grant", () => {
    const grant = baseGrant({ award_amount: 2_000_000, expenditure_deadline: "2027-12-31" });
    const events = Array.from({ length: 6 }, () =>
      evt({ event_type: "field_changed", at: `${ASOF}T09:00:00.000Z` }),
    );
    const dets = evaluateAnomalies({ grant, events, noteEvidenceCount: 0, asOf: ASOF });
    expect(dets.some((d) => d.rule_name === "frequent_edits")).toBe(true);
  });

  it("does NOT flag frequent edits below the high-value threshold", () => {
    const grant = baseGrant({ award_amount: 50_000, expenditure_deadline: "2027-12-31" });
    const events = Array.from({ length: 8 }, () => evt({ at: `${ASOF}T09:00:00.000Z` }));
    expect(evaluateAnomalies({ grant, events, noteEvidenceCount: 0, asOf: ASOF }).some((d) => d.rule_name === "frequent_edits")).toBe(false);
  });

  it("flags repeated documentation notes at/above the threshold", () => {
    const grant = baseGrant({ expenditure_deadline: "2027-12-31" });
    const dets = evaluateAnomalies({ grant, events: [], noteEvidenceCount: DEFAULT_ANOMALY_CONFIG.repeatedNoteCount, asOf: ASOF });
    expect(dets.some((d) => d.rule_name === "repeated_documentation_notes")).toBe(true);
  });
});

describe("AnomalyService", () => {
  it("creates, dedupes, and audits anomaly flags", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(
      org.id,
      grantInput({ expenditure_deadline: "2026-07-20" }),
      { actor: "u", source: "manual" },
    );
    // Add a large expended change event, then recompute near the deadline.
    c.events.append({
      org_id: org.id,
      grant_id: g.id,
      actor: "u",
      event_type: "field_changed",
      field: "expended_amount",
      old_value: "100000",
      new_value: "900000",
      summary: "big change",
    });
    const first = c.anomalyService.recomputeForGrant(g.id, ASOF);
    expect(first.length).toBeGreaterThanOrEqual(1);
    // Dedupe: running again creates nothing new while the anomaly stays open.
    const second = c.anomalyService.recomputeForGrant(g.id, ASOF);
    expect(second.length).toBe(0);
    // Audit trail records the flag.
    expect(c.events.listForGrant(g.id).some((e) => e.event_type === "anomaly_flagged")).toBe(true);
  });

  it("records status transitions with resolver + audit", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput({ expenditure_deadline: "2026-07-20" }), { actor: "u", source: "manual" });
    c.events.append({ org_id: org.id, grant_id: g.id, actor: "u", event_type: "field_changed", field: "expended_amount", old_value: "100000", new_value: "900000", summary: "x" });
    const [anomaly] = c.anomalyService.recomputeForGrant(g.id, ASOF);
    expect(anomaly).toBeTruthy();

    c.anomalyService.updateStatus(anomaly!.id, "under_review", { actorEmail: "inv@x.com", actorUserId: "u1" });
    expect(c.anomalies.findById(anomaly!.id)!.status).toBe("under_review");

    const cleared = c.anomalyService.updateStatus(anomaly!.id, "cleared", { actorEmail: "inv@x.com", actorUserId: "u1", note: "reviewed, ok" });
    expect(cleared.status).toBe("cleared");
    expect(cleared.resolved_by_user_id).toBe("u1");
    expect(cleared.resolved_at).not.toBeNull();
    expect(cleared.resolution_note).toBe("reviewed, ok");

    // Cleared anomalies drop out of the open queue.
    expect(c.anomalyService.listOpen(org.id).some((a) => a.id === anomaly!.id)).toBe(false);
    // Status change is auditable.
    expect(c.events.listForGrant(g.id).filter((e) => e.event_type === "anomaly_reviewed").length).toBe(2);
  });
});
