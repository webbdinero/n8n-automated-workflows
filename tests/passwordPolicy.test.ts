import { describe, it, expect } from "vitest";
import { checkPasswordStrength } from "../src/auth/passwordPolicy.js";

describe("checkPasswordStrength", () => {
  it("rejects too-short passwords", () => {
    const r = checkPasswordStrength("Ab1!", 10);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("10 characters");
  });

  it("rejects single-character-class passwords", () => {
    expect(checkPasswordStrength("abcdefghijkl", 10).ok).toBe(false); // letters only
  });

  it("rejects common passwords", () => {
    expect(checkPasswordStrength("password1", 8).ok).toBe(false);
    expect(checkPasswordStrength("grantguard-pilot", 8).ok).toBe(false);
  });

  it("accepts a strong password", () => {
    expect(checkPasswordStrength("Str0ng-Pass!", 10).ok).toBe(true);
    expect(checkPasswordStrength("river2026table", 10).ok).toBe(true); // letters + number
  });

  it("honors a configurable minimum length", () => {
    expect(checkPasswordStrength("Ab1defgh", 8).ok).toBe(true);
    expect(checkPasswordStrength("Ab1defgh", 12).ok).toBe(false);
  });
});
