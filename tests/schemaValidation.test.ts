import { describe, it, expect } from "vitest";
import { money, grantInputSchema } from "../src/domain/schemas.js";
import { grantInput } from "./support.js";

describe("money coercion", () => {
  it("strips currency formatting", () => {
    expect(money.parse("$1,234")).toBe(1234);
    expect(money.parse("1000.50")).toBe(1000.5);
    expect(money.parse("")).toBe(0);
  });
  it("rounds to whole cents to avoid float drift", () => {
    expect(money.parse(9.999)).toBe(10);
    expect(money.parse("2.005")).toBeCloseTo(2.01, 5);
  });
  it("rejects negatives", () => {
    expect(money.safeParse(-1).success).toBe(false);
  });
});

describe("grant cross-field validation", () => {
  it("rejects expenditure_deadline before award_date", () => {
    const res = grantInputSchema.safeParse({
      grant_number: "X",
      title: "X",
      funding_source: "OTHER",
      award_amount: 1000,
      award_date: "2025-01-01",
      expenditure_deadline: "2024-01-01",
    });
    expect(res.success).toBe(false);
  });

  it("rejects expended greater than award", () => {
    const res = grantInputSchema.safeParse({
      grant_number: "X",
      title: "X",
      funding_source: "OTHER",
      award_amount: 1000,
      expended_amount: 2000,
      award_date: "2024-01-01",
      expenditure_deadline: "2026-01-01",
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid grant", () => {
    expect(() => grantInput()).not.toThrow();
  });
});
