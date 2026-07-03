import { z } from "zod";
import {
  CLASSIFICATIONS,
  EVENT_SOURCES,
  EVENT_TYPES,
  FUNDING_SOURCES,
  GRANT_STATUSES,
  ORG_TYPES,
  PLANS,
  RISK_TIERS,
  SUBSCRIPTION_STATUSES,
  TASK_OUTCOMES,
  TASK_STATUSES,
  TASK_TYPES,
  USAGE_KINDS,
  USER_ROLES,
} from "./constants.js";

/* -------------------------------------------------------------------------- */
/* Primitive helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Non-negative dollar amount; coerces "1,250.00" / "$1250" style strings and
 * rounds to whole cents so REAL storage never accumulates float drift.
 */
export const money = z.preprocess((v) => {
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
  }
  if (typeof v === "number") return Math.round(v * 100) / 100;
  return v;
}, z.number().finite().nonnegative());

/** Optional dollar amount. */
export const optionalMoney = money.optional();

/** ISO calendar date (YYYY-MM-DD). Ingestion normalizes other formats first. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

export const optionalIsoDate = isoDate.optional().nullable();

const trimmed = z.string().trim();

/* -------------------------------------------------------------------------- */
/* Organization                                                               */
/* -------------------------------------------------------------------------- */

export const organizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(ORG_TYPES),
  state: z.string().length(2).nullable(),
  population: z.number().int().nonnegative().nullable(),
  // Benchmark-ready cohorting.
  region: z.string().nullable(),
  // Consent to contribute anonymized data to peer benchmarks (moat / data product).
  data_sharing_opt_in: z.boolean(),
  // Monetization / subscription.
  plan: z.enum(PLANS),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  seats: z.number().int().nonnegative().nullable(),
  // Per-org bearer token gating the JSON API (n8n / automation integration).
  api_token: z.string().nullable(),
  created_at: z.string(),
});
export type Organization = z.infer<typeof organizationSchema>;

/* -------------------------------------------------------------------------- */
/* User (authentication)                                                       */
/* -------------------------------------------------------------------------- */

/** Public user record — never carries the password hash. */
export const userSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  created_at: z.string(),
  last_login_at: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

/* -------------------------------------------------------------------------- */
/* Grant — input (what an importer / form / API supplies)                     */
/* -------------------------------------------------------------------------- */

export const grantInputSchema = z
  .object({
    grant_number: trimmed.min(1, "grant_number is required"),
    title: trimmed.min(1, "title is required"),
    funding_source: z.enum(FUNDING_SOURCES).default("OTHER"),
    program: trimmed.optional().nullable(),
    grantor: trimmed.optional().nullable(),
    subrecipient: trimmed.optional().nullable(),
    department: trimmed.optional().nullable(),
    category: trimmed.optional().nullable(),

    award_amount: money,
    obligated_amount: optionalMoney,
    expended_amount: optionalMoney,

    award_date: isoDate,
    obligation_deadline: optionalIsoDate,
    expenditure_deadline: isoDate,
    period_of_performance_end: optionalIsoDate,

    status: z.enum(GRANT_STATUSES).default("active"),
    assigned_to: trimmed.optional().nullable(),

    // Proprietary reviewer fields — optional on intake, enriched over time.
    classification: z.enum(CLASSIFICATIONS).default("unreviewed"),
    review_notes: z.string().optional().nullable(),
    tags: z.array(z.string()).optional().default([]),
  })
  .transform((g) => ({
    ...g,
    obligated_amount: g.obligated_amount ?? 0,
    expended_amount: g.expended_amount ?? 0,
  }))
  .superRefine((g, ctx) => {
    if (g.expended_amount > g.award_amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expended_amount"],
        message: "expended_amount cannot exceed award_amount",
      });
    }
    if (g.obligated_amount > g.award_amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["obligated_amount"],
        message: "obligated_amount cannot exceed award_amount",
      });
    }
    // Expenditure deadline must not precede the award date.
    if (g.expenditure_deadline < g.award_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expenditure_deadline"],
        message: "expenditure_deadline cannot be before award_date",
      });
    }
    if (g.obligation_deadline && g.obligation_deadline < g.award_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["obligation_deadline"],
        message: "obligation_deadline cannot be before award_date",
      });
    }
  });

export type GrantInput = z.infer<typeof grantInputSchema>;

/* -------------------------------------------------------------------------- */
/* Grant — full stored record (adds identity + computed risk)                 */
/* -------------------------------------------------------------------------- */

export const grantRecordSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  grant_number: z.string(),
  title: z.string(),
  funding_source: z.enum(FUNDING_SOURCES),
  program: z.string().nullable(),
  grantor: z.string().nullable(),
  subrecipient: z.string().nullable(),
  department: z.string().nullable(),
  category: z.string().nullable(),

  award_amount: z.number(),
  obligated_amount: z.number(),
  expended_amount: z.number(),

  award_date: z.string(),
  obligation_deadline: z.string().nullable(),
  expenditure_deadline: z.string(),
  period_of_performance_end: z.string().nullable(),

  status: z.enum(GRANT_STATUSES),
  assigned_to: z.string().nullable(),

  classification: z.enum(CLASSIFICATIONS),
  review_notes: z.string().nullable(),
  last_reviewed_at: z.string().nullable(),
  tags: z.array(z.string()),

  risk_score: z.number(),
  risk_tier: z.enum(RISK_TIERS),

  created_at: z.string(),
  updated_at: z.string(),
});
export type GrantRecord = z.infer<typeof grantRecordSchema>;

/* -------------------------------------------------------------------------- */
/* Compliance task                                                            */
/* -------------------------------------------------------------------------- */

export const taskInputSchema = z.object({
  grant_id: z.string(),
  type: z.enum(TASK_TYPES).default("other"),
  title: trimmed.min(1),
  due_date: isoDate,
  assigned_to: trimmed.optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskRecordSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  grant_id: z.string(),
  type: z.enum(TASK_TYPES),
  title: z.string(),
  due_date: z.string(),
  status: z.enum(TASK_STATUSES),
  completed_at: z.string().nullable(),
  outcome: z.enum(TASK_OUTCOMES).nullable(),
  turnaround_days: z.number().nullable(),
  assigned_to: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

/* -------------------------------------------------------------------------- */
/* Audit-trail event (append-only)                                            */
/* -------------------------------------------------------------------------- */

export const grantEventSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  grant_id: z.string(),
  at: z.string(),
  actor: z.string(),
  event_type: z.enum(EVENT_TYPES),
  field: z.string().nullable(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  summary: z.string(),
  source: z.enum(EVENT_SOURCES),
});
export type GrantEvent = z.infer<typeof grantEventSchema>;

/* -------------------------------------------------------------------------- */
/* Usage event (metering — billing basis for metered/premium actions)          */
/* -------------------------------------------------------------------------- */

export const usageEventSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  at: z.string(),
  kind: z.enum(USAGE_KINDS),
  actor: z.string(),
  quantity: z.number().int().nonnegative(),
  ref: z.string().nullable(),
  meta: z.string().nullable(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

/* -------------------------------------------------------------------------- */
/* Subscription event (append-only audit of plan/status changes)               */
/* -------------------------------------------------------------------------- */

export const subscriptionEventSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  at: z.string(),
  actor: z.string(),
  field: z.string(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  reason: z.string().nullable(),
});
export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>;

/* -------------------------------------------------------------------------- */
/* Partial update payload (from the detail page / API)                        */
/* -------------------------------------------------------------------------- */

export const grantUpdateSchema = z
  .object({
    title: trimmed.min(1).optional(),
    funding_source: z.enum(FUNDING_SOURCES).optional(),
    program: trimmed.optional().nullable(),
    grantor: trimmed.optional().nullable(),
    subrecipient: trimmed.optional().nullable(),
    department: trimmed.optional().nullable(),
    category: trimmed.optional().nullable(),
    award_amount: money.optional(),
    obligated_amount: money.optional(),
    expended_amount: money.optional(),
    award_date: isoDate.optional(),
    obligation_deadline: optionalIsoDate,
    expenditure_deadline: isoDate.optional(),
    period_of_performance_end: optionalIsoDate,
    status: z.enum(GRANT_STATUSES).optional(),
    assigned_to: trimmed.optional().nullable(),
    classification: z.enum(CLASSIFICATIONS).optional(),
    review_notes: z.string().optional().nullable(),
  })
  .strip();
export type GrantUpdate = z.infer<typeof grantUpdateSchema>;
