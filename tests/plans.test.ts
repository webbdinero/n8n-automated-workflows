import { describe, it, expect } from "vitest";
import { entitlementsFor, can, remainingGrants } from "../src/domain/plans.js";

describe("plan entitlements", () => {
  it("gates premium features on the trial plan", () => {
    const trial = { plan: "trial" as const };
    expect(can(trial, "benchmarks")).toBe(false);
    expect(can(trial, "jsonExport")).toBe(false);
    expect(can(trial, "premiumPackets")).toBe(false);
    expect(can(trial, "apiAccess")).toBe(true);
    expect(entitlementsFor(trial).maxGrants).toBe(15);
  });

  it("unlocks premium features on paid plans", () => {
    for (const plan of ["pilot", "standard", "enterprise"] as const) {
      const org = { plan };
      expect(can(org, "benchmarks")).toBe(true);
      expect(can(org, "jsonExport")).toBe(true);
      expect(can(org, "premiumPackets")).toBe(true);
    }
  });

  it("computes remaining grants against the plan limit", () => {
    expect(remainingGrants({ plan: "trial" }, 10)).toBe(5);
    expect(remainingGrants({ plan: "trial" }, 20)).toBe(0);
    expect(remainingGrants({ plan: "pilot" }, 9999)).toBeNull(); // unlimited
    expect(remainingGrants({ plan: "standard" }, 250)).toBe(0);
  });
});
