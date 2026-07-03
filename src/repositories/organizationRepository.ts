import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Organization } from "../domain/schemas.js";
import type { OrgType, Plan, SubscriptionStatus } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToOrganization } from "./serialize.js";

export interface NewOrganization {
  slug: string;
  name: string;
  type: OrgType;
  state?: string | null;
  population?: number | null;
  region?: string | null;
  data_sharing_opt_in?: boolean;
  plan?: Plan;
  subscription_status?: SubscriptionStatus;
  trial_ends_at?: string | null;
  seats?: number | null;
}

export class OrganizationRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: NewOrganization): Organization {
    const org: Organization = {
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      type: input.type,
      state: input.state ?? null,
      population: input.population ?? null,
      region: input.region ?? null,
      data_sharing_opt_in: input.data_sharing_opt_in ?? false,
      plan: input.plan ?? "trial",
      subscription_status: input.subscription_status ?? "trialing",
      trial_ends_at: input.trial_ends_at ?? null,
      seats: input.seats ?? null,
      created_at: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO organizations
           (id, slug, name, type, state, population, region, data_sharing_opt_in,
            plan, subscription_status, trial_ends_at, seats, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        org.id,
        org.slug,
        org.name,
        org.type,
        org.state,
        org.population,
        org.region,
        org.data_sharing_opt_in ? 1 : 0,
        org.plan,
        org.subscription_status,
        org.trial_ends_at,
        org.seats,
        org.created_at,
      );
    return org;
  }

  /** Update subscription/plan fields (admin-driven). */
  updateSubscription(
    id: string,
    changes: Partial<Pick<Organization, "plan" | "subscription_status" | "trial_ends_at" | "seats" | "data_sharing_opt_in">>,
  ): void {
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    if (changes.plan !== undefined) { cols.push("plan = ?"); vals.push(changes.plan); }
    if (changes.subscription_status !== undefined) { cols.push("subscription_status = ?"); vals.push(changes.subscription_status); }
    if (changes.trial_ends_at !== undefined) { cols.push("trial_ends_at = ?"); vals.push(changes.trial_ends_at); }
    if (changes.seats !== undefined) { cols.push("seats = ?"); vals.push(changes.seats); }
    if (changes.data_sharing_opt_in !== undefined) { cols.push("data_sharing_opt_in = ?"); vals.push(changes.data_sharing_opt_in ? 1 : 0); }
    if (cols.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE organizations SET ${cols.join(", ")} WHERE id = ?`).run(...vals);
  }

  findBySlug(slug: string): Organization | null {
    const row = this.db
      .prepare(`SELECT * FROM organizations WHERE slug = ?`)
      .get(slug);
    return row ? rowToOrganization(row as Record<string, unknown>) : null;
  }

  findById(id: string): Organization | null {
    const row = this.db
      .prepare(`SELECT * FROM organizations WHERE id = ?`)
      .get(id);
    return row ? rowToOrganization(row as Record<string, unknown>) : null;
  }

  list(): Organization[] {
    return this.db
      .prepare(`SELECT * FROM organizations ORDER BY name`)
      .all()
      .map((r) => rowToOrganization(r as Record<string, unknown>));
  }

  /** Get an org by slug, creating it if absent (used to guarantee a tenant). */
  ensure(input: NewOrganization): Organization {
    return this.findBySlug(input.slug) ?? this.create(input);
  }
}
