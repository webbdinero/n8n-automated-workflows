import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Organization } from "../domain/schemas.js";
import type { OrgType } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToOrganization } from "./serialize.js";

export interface NewOrganization {
  slug: string;
  name: string;
  type: OrgType;
  state?: string | null;
  population?: number | null;
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
      created_at: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO organizations (id, slug, name, type, state, population, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        org.id,
        org.slug,
        org.name,
        org.type,
        org.state,
        org.population,
        org.created_at,
      );
    return org;
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
