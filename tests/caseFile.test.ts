import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";

describe("ExportService.buildCaseFile", () => {
  it("assembles grant snapshot, change history, evidence, and anomalies", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u@x.com", source: "manual" });
    c.grantService.updateGrant(g.id, { status: "at_risk" }, { actor: "u@x.com", source: "manual" });
    c.evidenceService.addEvidence(org.id, g.id, { type: "note", note: "site visit finding" }, { email: "u@x.com" });

    const cf = c.exportService.buildCaseFile(g.id);
    expect(cf.grant.id).toBe(g.id);
    expect(cf.org.id).toBe(org.id);
    expect(cf.evidence.some((e) => e.note === "site visit finding")).toBe(true);
    expect(cf.events.some((e) => e.event_type === "status_changed")).toBe(true);
    expect(cf.risk.factors.length).toBeGreaterThan(0);
    expect(Array.isArray(cf.anomalies)).toBe(true);
  });
});

describe("change history filtering (EventRepository.listForGrantFiltered)", () => {
  it("filters by event type and by actor", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "alice@x.com", source: "manual" });
    c.grantService.updateGrant(g.id, { status: "monitoring" }, { actor: "bob@x.com", source: "manual" });
    c.grantService.updateGrant(g.id, { classification: "finding" }, { actor: "alice@x.com", source: "manual" });

    const statusOnly = c.events.listForGrantFiltered(g.id, { eventType: "status_changed" });
    expect(statusOnly.length).toBeGreaterThan(0);
    expect(statusOnly.every((e) => e.event_type === "status_changed")).toBe(true);

    const byBob = c.events.listForGrantFiltered(g.id, { actor: "bob@x.com" });
    expect(byBob.length).toBeGreaterThan(0);
    expect(byBob.every((e) => e.actor === "bob@x.com")).toBe(true);

    // Distinct actors are available for the filter dropdown.
    const actors = c.events.distinctActorsForGrant(g.id);
    expect(actors).toContain("alice@x.com");
    expect(actors).toContain("bob@x.com");
  });
});
