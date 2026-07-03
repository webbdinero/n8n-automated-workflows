import { describe, it, expect } from "vitest";
import { scoreGrant, tierForScore, type ScoringGrant } from "../src/services/scoring.js";

const ASOF = "2026-07-03";

function grant(overrides: Partial<ScoringGrant> = {}): ScoringGrant {
  return {
    award_amount: 1_000_000,
    obligated_amount: 1_000_000,
    expended_amount: 500_000,
    award_date: "2023-01-01",
    obligation_deadline: "2024-12-31",
    expenditure_deadline: "2026-12-31",
    status: "monitoring",
    assigned_to: "Owner",
    department: "Public Works",
    category: "Water",
    ...overrides,
  };
}

function factor(res: ReturnType<typeof scoreGrant>, key: string) {
  const f = res.factors.find((x) => x.key === key);
  if (!f) throw new Error(`factor ${key} missing`);
  return f;
}

describe("tierForScore", () => {
  it("maps score ranges to tiers at the boundaries", () => {
    expect(tierForScore(0)).toBe("low");
    expect(tierForScore(24)).toBe("low");
    expect(tierForScore(25)).toBe("medium");
    expect(tierForScore(49)).toBe("medium");
    expect(tierForScore(50)).toBe("high");
    expect(tierForScore(74)).toBe("high");
    expect(tierForScore(75)).toBe("critical");
    expect(tierForScore(100)).toBe("critical");
  });
});

describe("scoreGrant", () => {
  it("returns 0 for terminal (closed/deobligated) grants", () => {
    expect(scoreGrant(grant({ status: "closed" }), [], ASOF).score).toBe(0);
    expect(scoreGrant(grant({ status: "deobligated" }), [], ASOF).score).toBe(0);
  });

  it("keeps a well-managed, fully-obligated, on-pace grant low", () => {
    const res = scoreGrant(
      grant({ expended_amount: 950_000, obligated_amount: 1_000_000 }),
      [],
      ASOF,
    );
    expect(res.tier).toBe("low");
    expect(res.score).toBeLessThan(25);
    expect(factor(res, "burnPace").risk).toBe(0); // ahead of pace
  });

  it("flags behind-pace spending via the burn factor", () => {
    const res = scoreGrant(grant({ expended_amount: 50_000 }), [], ASOF);
    // ~88% of window elapsed, 5% spent -> large gap
    expect(factor(res, "burnPace").risk).toBeGreaterThan(0.7);
    expect(res.score).toBeGreaterThan(35);
  });

  it("maxes deadline pressure when funds are unspent past the deadline", () => {
    const res = scoreGrant(
      grant({ expenditure_deadline: "2026-01-01", expended_amount: 100_000 }),
      [],
      ASOF,
    );
    expect(factor(res, "deadlinePressure").risk).toBe(1);
    expect(res.tier === "high" || res.tier === "critical").toBe(true);
  });

  it("maxes obligation gap when funds remain unobligated past the obligation deadline", () => {
    const res = scoreGrant(
      grant({ obligated_amount: 250_000, obligation_deadline: "2026-06-01" }),
      [],
      ASOF,
    );
    expect(factor(res, "obligationGap").risk).toBe(1);
  });

  it("raises reporting risk for overdue obligations", () => {
    const res = scoreGrant(grant(), [
      { status: "open", due_date: "2026-01-01", outcome: null }, // overdue
      { status: "completed", due_date: "2026-05-01", outcome: "on_time" },
    ], ASOF);
    expect(factor(res, "reporting").risk).toBeGreaterThan(0);
  });

  it("penalizes missing structured data (drives data capture)", () => {
    const complete = scoreGrant(grant(), [], ASOF);
    const sparse = scoreGrant(
      grant({ assigned_to: null, department: null, category: null, obligation_deadline: null }),
      [],
      ASOF,
    );
    expect(factor(sparse, "dataCompleteness").risk).toBeGreaterThan(
      factor(complete, "dataCompleteness").risk,
    );
  });

  it("produces a critical score for a badly compounded grant", () => {
    const res = scoreGrant(
      grant({
        expended_amount: 0,
        obligated_amount: 200_000,
        obligation_deadline: "2026-06-01",
        expenditure_deadline: "2026-09-30",
      }),
      [{ status: "open", due_date: "2026-01-01", outcome: null }],
      ASOF,
    );
    expect(res.score).toBeGreaterThanOrEqual(75);
    expect(res.tier).toBe("critical");
  });

  it("keeps points within each factor weight and total within 0..100", () => {
    const res = scoreGrant(grant({ expended_amount: 0, obligated_amount: 0 }), [], ASOF);
    for (const f of res.factors) {
      expect(f.points).toBeGreaterThanOrEqual(0);
      expect(f.points).toBeLessThanOrEqual(f.weight + 1e-9);
    }
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThanOrEqual(100);
  });
});
