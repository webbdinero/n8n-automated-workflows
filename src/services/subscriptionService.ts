import type { OrganizationRepository } from "../repositories/organizationRepository.js";
import type { SubscriptionEventRepository } from "../repositories/subscriptionEventRepository.js";
import type { Organization } from "../domain/schemas.js";
import type { Plan, SubscriptionStatus } from "../domain/constants.js";
import { NotFoundError } from "./errors.js";

export interface SubscriptionChange {
  plan?: Plan;
  subscription_status?: SubscriptionStatus;
  trial_ends_at?: string | null;
  seats?: number | null;
  data_sharing_opt_in?: boolean;
}

export interface SubscriptionContext {
  actor: string;
  reason?: string | null;
}

/** Fields whose changes are audited, in the order they render. */
const TRACKED_FIELDS: Array<keyof SubscriptionChange> = [
  "plan",
  "subscription_status",
  "seats",
  "trial_ends_at",
  "data_sharing_opt_in",
];

function display(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Orchestrates subscription changes so that every plan/status change is
 * recorded in the append-only subscription audit log (who, when, old -> new,
 * reason) before the change is persisted. This is the canonical path for
 * subscription mutations, mirroring how GrantService owns grant mutations.
 */
export class SubscriptionService {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly events: SubscriptionEventRepository,
  ) {}

  updateSubscription(
    orgId: string,
    change: SubscriptionChange,
    ctx: SubscriptionContext,
  ): Organization {
    const org = this.orgs.findById(orgId);
    if (!org) throw new NotFoundError(`Organization ${orgId} not found`);

    const orgRecord = org as unknown as Record<string, unknown>;
    const applied: SubscriptionChange = {};
    let anyChange = false;

    for (const field of TRACKED_FIELDS) {
      const next = change[field];
      if (next === undefined) continue;
      const prev = orgRecord[field] ?? null;
      const prevDisp = display(prev);
      const nextDisp = display(next);
      if (prevDisp === nextDisp) continue;

      // Record the audit event first, then include the field in the write.
      this.events.append({
        org_id: orgId,
        actor: ctx.actor,
        field,
        old_value: prevDisp,
        new_value: nextDisp,
        reason: ctx.reason ?? null,
      });
      (applied as Record<string, unknown>)[field] = next;
      anyChange = true;
    }

    if (!anyChange) return org;
    this.orgs.updateSubscription(orgId, applied);
    return this.orgs.findById(orgId) ?? org;
  }

  history(orgId: string, limit = 50) {
    return this.events.listForOrg(orgId, limit);
  }
}
