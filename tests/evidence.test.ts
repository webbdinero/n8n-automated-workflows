import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";
import { evidenceInputSchema } from "../src/domain/schemas.js";

describe("evidence input validation", () => {
  it("requires the right field per type", () => {
    expect(evidenceInputSchema.safeParse({ type: "link" }).success).toBe(false); // needs url
    expect(evidenceInputSchema.safeParse({ type: "attachment" }).success).toBe(false); // needs filename
    expect(evidenceInputSchema.safeParse({ type: "note" }).success).toBe(false); // needs note
    expect(evidenceInputSchema.safeParse({ type: "link", url: "https://x" }).success).toBe(true);
    expect(evidenceInputSchema.safeParse({ type: "note", note: "found issue" }).success).toBe(true);
  });
});

describe("EvidenceService", () => {
  it("stores fields, ties to grant + user, and writes an audit event", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    const item = c.evidenceService.addEvidence(
      org.id,
      g.id,
      { type: "link", url: "https://records.example/invoice-42" },
      { email: "auditor@ig.gov", userId: "user-1" },
    );
    expect(item.grant_id).toBe(g.id);
    expect(item.org_id).toBe(org.id);
    expect(item.type).toBe("link");
    expect(item.url).toContain("invoice-42");
    expect(item.created_by_email).toBe("auditor@ig.gov");
    expect(item.created_by_user_id).toBe("user-1");
    expect(item.status).toBe("active");

    const stored = c.evidence.findById(item.id)!;
    expect(stored.url).toBe(item.url);

    // Audit: adding evidence appends an evidence_added event.
    const ev = c.events.listForGrant(g.id).find((e) => e.event_type === "evidence_added");
    expect(ev).toBeTruthy();
    expect(ev!.actor).toBe("auditor@ig.gov");
  });

  it("lists evidence most-recent first", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    c.evidenceService.addEvidence(org.id, g.id, { type: "note", note: "first" }, { email: "a@x.com" });
    c.evidenceService.addEvidence(org.id, g.id, { type: "note", note: "second" }, { email: "a@x.com" });
    const list = c.evidenceService.listForGrant(g.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.note).toBe("second"); // newest first
  });
});
