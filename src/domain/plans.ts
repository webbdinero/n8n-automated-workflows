import type { Plan } from "./constants.js";
import type { Organization } from "./schemas.js";

/**
 * Plan entitlements — the single source of truth for what each subscription
 * tier unlocks. Routes gate premium capabilities against this, and the Admin
 * screen renders it. Changing a plan's offering is a one-line edit here.
 *
 * Boolean features are checked with {@link can}; `maxGrants` (null = unlimited)
 * is enforced with {@link remainingGrants} so trial accounts convert.
 */
export interface Entitlements {
  /** Cross-org peer benchmarking (Admin + API). */
  benchmarks: boolean;
  /** JSON API access. */
  apiAccess: boolean;
  /** Premium compliance packet (adds the peer-benchmark section). */
  premiumPackets: boolean;
  /** Full structured JSON portfolio export. */
  jsonExport: boolean;
  /** Max grants the org may store; null = unlimited. */
  maxGrants: number | null;
  /** Seats included in the plan. */
  seatsIncluded: number;
}

export type BooleanFeature = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];

export const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  trial: {
    benchmarks: false,
    apiAccess: true,
    premiumPackets: false,
    jsonExport: false,
    maxGrants: 15,
    seatsIncluded: 2,
  },
  pilot: {
    benchmarks: true,
    apiAccess: true,
    premiumPackets: true,
    jsonExport: true,
    maxGrants: null,
    seatsIncluded: 5,
  },
  standard: {
    benchmarks: true,
    apiAccess: true,
    premiumPackets: true,
    jsonExport: true,
    maxGrants: 250,
    seatsIncluded: 10,
  },
  enterprise: {
    benchmarks: true,
    apiAccess: true,
    premiumPackets: true,
    jsonExport: true,
    maxGrants: null,
    seatsIncluded: 50,
  },
};

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Trial",
  pilot: "Pilot",
  standard: "Standard",
  enterprise: "Enterprise",
};

export function entitlementsFor(org: Pick<Organization, "plan">): Entitlements {
  return PLAN_ENTITLEMENTS[org.plan] ?? PLAN_ENTITLEMENTS.trial;
}

export function can(
  org: Pick<Organization, "plan">,
  feature: BooleanFeature,
): boolean {
  return Boolean(entitlementsFor(org)[feature]);
}

/** Grants the org may still add; null = unlimited. */
export function remainingGrants(
  org: Pick<Organization, "plan">,
  currentCount: number,
): number | null {
  const max = entitlementsFor(org).maxGrants;
  if (max == null) return null;
  return Math.max(0, max - currentCount);
}
