import type {
  GrantRecord,
  TaskRecord,
  GrantEvent,
  Organization,
  UsageEvent,
} from "../domain/schemas.js";
import type {
  Classification,
  EventSource,
  EventType,
  FundingSource,
  GrantStatus,
  OrgType,
  Plan,
  RiskTier,
  SubscriptionStatus,
  TaskOutcome,
  TaskStatus,
  TaskType,
  UsageKind,
} from "../domain/constants.js";

/** A raw SQLite row is a bag of columns; we map it explicitly to typed records. */
export type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const nnum = (v: unknown): number | null => (v == null ? null : Number(v));

export function rowToOrganization(r: Row): Organization {
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    type: str(r.type) as OrgType,
    state: nstr(r.state),
    population: nnum(r.population),
    region: nstr(r.region),
    data_sharing_opt_in: Number(r.data_sharing_opt_in ?? 0) === 1,
    plan: (str(r.plan) || "trial") as Plan,
    subscription_status: (str(r.subscription_status) || "trialing") as SubscriptionStatus,
    trial_ends_at: nstr(r.trial_ends_at),
    seats: nnum(r.seats),
    created_at: str(r.created_at),
  };
}

export function rowToUsageEvent(r: Row): UsageEvent {
  return {
    id: str(r.id),
    org_id: str(r.org_id),
    at: str(r.at),
    kind: str(r.kind) as UsageKind,
    actor: str(r.actor),
    quantity: num(r.quantity),
    ref: nstr(r.ref),
    meta: nstr(r.meta),
  };
}

export function rowToGrant(r: Row): GrantRecord {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(str(r.tags) || "[]");
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: str(r.id),
    org_id: str(r.org_id),
    grant_number: str(r.grant_number),
    title: str(r.title),
    funding_source: str(r.funding_source) as FundingSource,
    program: nstr(r.program),
    grantor: nstr(r.grantor),
    subrecipient: nstr(r.subrecipient),
    department: nstr(r.department),
    category: nstr(r.category),
    award_amount: num(r.award_amount),
    obligated_amount: num(r.obligated_amount),
    expended_amount: num(r.expended_amount),
    award_date: str(r.award_date),
    obligation_deadline: nstr(r.obligation_deadline),
    expenditure_deadline: str(r.expenditure_deadline),
    period_of_performance_end: nstr(r.period_of_performance_end),
    status: str(r.status) as GrantStatus,
    assigned_to: nstr(r.assigned_to),
    classification: str(r.classification) as Classification,
    review_notes: nstr(r.review_notes),
    last_reviewed_at: nstr(r.last_reviewed_at),
    tags,
    risk_score: num(r.risk_score),
    risk_tier: str(r.risk_tier) as RiskTier,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export function rowToTask(r: Row): TaskRecord {
  return {
    id: str(r.id),
    org_id: str(r.org_id),
    grant_id: str(r.grant_id),
    type: str(r.type) as TaskType,
    title: str(r.title),
    due_date: str(r.due_date),
    status: str(r.status) as TaskStatus,
    completed_at: nstr(r.completed_at),
    outcome: (r.outcome == null ? null : String(r.outcome)) as TaskOutcome | null,
    turnaround_days: nnum(r.turnaround_days),
    assigned_to: nstr(r.assigned_to),
    notes: nstr(r.notes),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export function rowToEvent(r: Row): GrantEvent {
  return {
    id: str(r.id),
    org_id: str(r.org_id),
    grant_id: str(r.grant_id),
    at: str(r.at),
    actor: str(r.actor),
    event_type: str(r.event_type) as EventType,
    field: nstr(r.field),
    old_value: nstr(r.old_value),
    new_value: nstr(r.new_value),
    summary: str(r.summary),
    source: str(r.source) as EventSource,
  };
}
