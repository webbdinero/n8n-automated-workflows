import { openMemoryDb } from "../src/db/connection.js";
import { createContainer, type Container } from "../src/container.js";
import { grantInputSchema } from "../src/domain/schemas.js";
import type { Organization } from "../src/domain/schemas.js";

export interface TestCtx {
  c: Container;
  org: Organization;
}

/** Fresh in-memory container with one organization. */
export function newCtx(): TestCtx {
  const db = openMemoryDb();
  const c = createContainer(db);
  const org = c.orgs.create({
    slug: "test-org",
    name: "Test Org",
    type: "municipality",
    state: "PA",
    population: 10_000,
  });
  return { c, org };
}

/** Build a validated GrantInput from a partial raw object, with sane defaults. */
export function grantInput(overrides: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = {
    grant_number: "G-001",
    title: "Test Grant",
    funding_source: "ARPA_SLFRF",
    award_amount: 1_000_000,
    expended_amount: 500_000,
    award_date: "2023-01-01",
    expenditure_deadline: "2026-12-31",
    ...overrides,
  };
  // Default obligated to fully obligated unless explicitly overridden.
  if (merged.obligated_amount === undefined) merged.obligated_amount = merged.award_amount;
  return grantInputSchema.parse(merged);
}
