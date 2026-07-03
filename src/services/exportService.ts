import type { GrantRepository } from "../repositories/grantRepository.js";
import type { TaskRepository } from "../repositories/taskRepository.js";
import type { EventRepository } from "../repositories/eventRepository.js";
import type { OrganizationRepository } from "../repositories/organizationRepository.js";
import type {
  GrantRecord,
  Organization,
  TaskRecord,
  GrantEvent,
} from "../domain/schemas.js";
import { NotFoundError } from "./errors.js";
import { scoreGrant, type RiskResult } from "./scoring.js";
import { comparePeers, type BenchmarkComparison } from "./benchmarkService.js";
import { toCsv } from "./csv.js";
import { nowIso, todayIso } from "../util/dates.js";

export interface CompliancePacket {
  generated_at: string;
  as_of: string;
  premium: boolean;
  org: Organization;
  grant: GrantRecord;
  risk: RiskResult;
  tasks: TaskRecord[];
  events: GrantEvent[];
  financials: {
    unspent: number;
    unobligated: number;
    pctSpent: number;
    pctObligated: number;
  };
  /** Populated only for premium packets: peer benchmark comparison. */
  benchmark: BenchmarkComparison | null;
}

export interface PacketOptions {
  asOf?: string;
  /** Include the premium peer-benchmark section. */
  premium?: boolean;
}

/**
 * Report / export generation. Produces the audit-ready "compliance packet" per
 * grant (a printable, self-contained record) plus portfolio-level CSV and JSON
 * exports. These packets are the tangible deliverable customers pay for and a
 * natural upsell into premium/on-demand reports.
 */
export class ExportService {
  constructor(
    private readonly grants: GrantRepository,
    private readonly tasks: TaskRepository,
    private readonly events: EventRepository,
    private readonly orgs: OrganizationRepository,
  ) {}

  buildPacket(grantId: string, opts: PacketOptions = {}): CompliancePacket {
    const asOf = opts.asOf ?? todayIso();
    const premium = opts.premium ?? false;
    const grant = this.grants.findById(grantId);
    if (!grant) throw new NotFoundError(`Grant ${grantId} not found`);
    const org = this.orgs.findById(grant.org_id);
    if (!org) throw new NotFoundError("Organization not found");
    const tasks = this.tasks.listForGrant(grantId);
    const events = this.events.listForGrant(grantId);

    // Premium packets include an anonymized peer-benchmark comparison, pooled
    // from organizations that have opted in to data sharing.
    let benchmark: BenchmarkComparison | null = null;
    if (premium) {
      const peers = this.orgs
        .list()
        .filter((o) => o.id !== org.id && o.data_sharing_opt_in)
        .map((o) => ({
          grants: this.grants.listAll(o.id),
          tasks: this.tasks.listForOrg(o.id),
        }));
      benchmark = comparePeers(
        { grants: this.grants.listAll(org.id), tasks: this.tasks.listForOrg(org.id) },
        peers,
      );
    }
    const risk = scoreGrant(
      {
        award_amount: grant.award_amount,
        obligated_amount: grant.obligated_amount,
        expended_amount: grant.expended_amount,
        award_date: grant.award_date,
        obligation_deadline: grant.obligation_deadline,
        expenditure_deadline: grant.expenditure_deadline,
        period_of_performance_end: grant.period_of_performance_end,
        status: grant.status,
        assigned_to: grant.assigned_to,
        department: grant.department,
        category: grant.category,
      },
      tasks.map((t) => ({ status: t.status, due_date: t.due_date, outcome: t.outcome })),
      asOf,
    );

    return {
      generated_at: nowIso(),
      as_of: asOf,
      premium,
      org,
      grant,
      risk,
      tasks,
      events,
      financials: {
        unspent: Math.max(0, grant.award_amount - grant.expended_amount),
        unobligated: Math.max(0, grant.award_amount - grant.obligated_amount),
        pctSpent: grant.award_amount > 0 ? grant.expended_amount / grant.award_amount : 0,
        pctObligated: grant.award_amount > 0 ? grant.obligated_amount / grant.award_amount : 0,
      },
      benchmark,
    };
  }

  portfolioCsv(orgId: string): string {
    const grants = this.grants.listAll(orgId);
    const rows = grants.map((g) => ({
      grant_number: g.grant_number,
      title: g.title,
      funding_source: g.funding_source,
      grantor: g.grantor ?? "",
      status: g.status,
      classification: g.classification,
      award_amount: g.award_amount,
      obligated_amount: g.obligated_amount,
      expended_amount: g.expended_amount,
      unspent: Math.max(0, g.award_amount - g.expended_amount),
      award_date: g.award_date,
      obligation_deadline: g.obligation_deadline ?? "",
      expenditure_deadline: g.expenditure_deadline,
      assigned_to: g.assigned_to ?? "",
      risk_score: g.risk_score,
      risk_tier: g.risk_tier,
    }));
    return toCsv(rows, [
      "grant_number",
      "title",
      "funding_source",
      "grantor",
      "status",
      "classification",
      "award_amount",
      "obligated_amount",
      "expended_amount",
      "unspent",
      "award_date",
      "obligation_deadline",
      "expenditure_deadline",
      "assigned_to",
      "risk_score",
      "risk_tier",
    ]);
  }

  /** Full structured export — the proprietary dataset, portable for the customer. */
  portfolioJson(orgId: string): {
    org: Organization | null;
    generated_at: string;
    grants: GrantRecord[];
    tasks: TaskRecord[];
  } {
    return {
      org: this.orgs.findById(orgId),
      generated_at: nowIso(),
      grants: this.grants.listAll(orgId),
      tasks: this.tasks.listForOrg(orgId),
    };
  }
}
