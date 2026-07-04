/**
 * Canonical enumerations for the GrantGuard domain.
 *
 * These are exported as `const` arrays so the same source of truth drives Zod
 * validation, TypeScript types, and the UI dropdowns. Adding a new value in one
 * place propagates everywhere.
 */

export const FUNDING_SOURCES = [
  "ARPA_SLFRF",
  "CDBG",
  "FEMA",
  "EPA",
  "DOT_IIJA",
  "USDA",
  "HUD",
  "STATE",
  "COUNTY",
  "FOUNDATION",
  "OTHER",
] as const;

export const FUNDING_SOURCE_LABELS: Record<(typeof FUNDING_SOURCES)[number], string> = {
  ARPA_SLFRF: "ARPA — State & Local Fiscal Recovery Funds",
  CDBG: "Community Development Block Grant",
  FEMA: "FEMA",
  EPA: "EPA",
  DOT_IIJA: "DOT / Infrastructure (IIJA)",
  USDA: "USDA",
  HUD: "HUD",
  STATE: "State grant",
  COUNTY: "County pass-through",
  FOUNDATION: "Foundation / private",
  OTHER: "Other",
};

export const GRANT_STATUSES = [
  "active",
  "monitoring",
  "at_risk",
  "closeout",
  "closed",
  "deobligated",
] as const;

/** Reviewer classification — proprietary judgment captured per grant. */
export const CLASSIFICATIONS = [
  "unreviewed",
  "compliant",
  "needs_docs",
  "finding",
  "remediation",
  "waived",
] as const;

export const TASK_TYPES = [
  "quarterly_report",
  "annual_report",
  "project_expenditure_report",
  "subrecipient_monitoring",
  "single_audit",
  "closeout",
  "other",
] as const;

export const TASK_STATUSES = [
  "open",
  "submitted",
  "completed",
  "waived",
] as const;

export const TASK_OUTCOMES = ["on_time", "late", "missed", "waived"] as const;

export const EVENT_TYPES = [
  "created",
  "imported",
  "field_changed",
  "status_changed",
  "classification_changed",
  "note_added",
  "task_created",
  "task_completed",
  "scored",
  "evidence_added",
  "anomaly_flagged",
  "anomaly_reviewed",
] as const;

/** Evidence item kinds for case files / audit binders. */
export const EVIDENCE_TYPES = ["attachment", "link", "note"] as const;
export const EVIDENCE_STATUSES = ["active", "superseded"] as const;

/** Anomaly (oversight) severities, workflow statuses, and rule identifiers. */
export const ANOMALY_SEVERITIES = ["low", "medium", "high"] as const;
export const ANOMALY_STATUSES = ["open", "under_review", "cleared"] as const;
export const ANOMALY_RULES = [
  "large_last_minute_change",
  "frequent_edits",
  "repeated_documentation_notes",
] as const;

export const EVENT_SOURCES = ["manual", "csv", "json", "api", "system"] as const;

export const ORG_TYPES = [
  "municipality",
  "county",
  "authority",
  "school_district",
  "nonprofit",
  "other",
] as const;

export const RISK_TIERS = ["low", "medium", "high", "critical"] as const;

/** Subscription plans — the monetization tier attached to each organization. */
export const PLANS = ["trial", "pilot", "standard", "enterprise"] as const;

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
] as const;

/** Metered, billing-relevant actions recorded in usage_events. */
export const USAGE_KINDS = [
  "packet_generated",
  "export_csv",
  "export_json",
  "grant_created",
  "import",
] as const;

/** User roles. `admin` may change billing/subscription; `member` cannot. */
export const USER_ROLES = ["admin", "member"] as const;

export type FundingSource = (typeof FUNDING_SOURCES)[number];
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type EventSource = (typeof EVENT_SOURCES)[number];
export type OrgType = (typeof ORG_TYPES)[number];
export type RiskTier = (typeof RISK_TIERS)[number];
export type Plan = (typeof PLANS)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type UsageKind = (typeof USAGE_KINDS)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];
export type AnomalyRule = (typeof ANOMALY_RULES)[number];
