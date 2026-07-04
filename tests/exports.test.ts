import { describe, it, expect } from "vitest";
import { newCtx, grantInput } from "./support.js";

describe("ExportService.buildPacket", () => {
  it("assembles a self-contained standard packet", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(
      org.id,
      grantInput({ award_amount: 1_000_000, expended_amount: 400_000 }),
      { actor: "u", source: "manual" },
    );
    const packet = c.exportService.buildPacket(g.id);
    expect(packet.grant.id).toBe(g.id);
    expect(packet.premium).toBe(false);
    expect(packet.benchmark).toBeNull();
    expect(packet.risk.factors.length).toBeGreaterThan(0);
    expect(packet.financials.unspent).toBe(600_000);
    expect(packet.events.length).toBeGreaterThan(0); // audit trail included
  });

  it("includes a peer benchmark for premium packets, pooling opted-in orgs only", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });

    // One opted-in peer, one opted-out peer.
    const peerIn = c.orgs.create({ slug: "p-in", name: "Peer In", type: "municipality", data_sharing_opt_in: true });
    const peerOut = c.orgs.create({ slug: "p-out", name: "Peer Out", type: "municipality", data_sharing_opt_in: false });
    c.grantService.createGrant(peerIn.id, grantInput({ grant_number: "PI-1" }), { actor: "u", source: "manual" });
    c.grantService.createGrant(peerOut.id, grantInput({ grant_number: "PO-1" }), { actor: "u", source: "manual" });

    const g = c.grants.listAll(org.id)[0]!;
    const packet = c.exportService.buildPacket(g.id, { premium: true });
    expect(packet.premium).toBe(true);
    expect(packet.benchmark).not.toBeNull();
    expect(packet.benchmark!.peerOrgCount).toBe(1); // only the opted-in peer
  });
});

describe("ExportService portfolio exports", () => {
  it("produces CSV with a header and escaped fields", () => {
    const { c, org } = newCtx();
    c.grantService.createGrant(
      org.id,
      grantInput({ title: "Water, Sewer & Roads" }),
      { actor: "u", source: "manual" },
    );
    const csv = c.exportService.portfolioCsv(org.id);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("grant_number");
    expect(lines[0]).toContain("risk_tier");
    expect(csv).toContain('"Water, Sewer & Roads"'); // comma-containing field quoted
  });

  it("produces structured JSON with grants and tasks", () => {
    const { c, org } = newCtx();
    const g = c.grantService.createGrant(org.id, grantInput(), { actor: "u", source: "manual" });
    c.grantService.addTask(
      { org_id: org.id, grant_id: g.id, type: "quarterly_report", title: "Q", due_date: "2027-01-01" },
      { actor: "u", source: "manual" },
    );
    const data = c.exportService.portfolioJson(org.id);
    expect(data.org?.id).toBe(org.id);
    expect(data.grants).toHaveLength(1);
    expect(data.tasks).toHaveLength(1);
    expect(typeof data.generated_at).toBe("string");
  });
});
