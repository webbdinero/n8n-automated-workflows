/**
 * Canonical relational schema for GrantGuard.
 *
 * Design notes tied to the product's data moat:
 *  - `grant_events` is APPEND-ONLY. Every mutation writes a row here; we never
 *    overwrite history. This is the longitudinal record competitors cannot
 *    reconstruct and the raw material for benchmarks and premium reports.
 *  - `compliance_tasks` captures outcomes + turnaround_days, so on-time /
 *    late / missed reporting becomes measurable and benchmarkable.
 *  - Money is stored as REAL dollars for MVP simplicity. A future migration
 *    can move to integer cents; all access is centralized in repositories.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS organizations (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,
  state                TEXT,
  population           INTEGER,
  region               TEXT,
  data_sharing_opt_in  INTEGER NOT NULL DEFAULT 0,
  plan                 TEXT NOT NULL DEFAULT 'trial',
  subscription_status  TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at        TEXT,
  seats                INTEGER,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL REFERENCES organizations(id),
  grant_number              TEXT NOT NULL,
  title                     TEXT NOT NULL,
  funding_source            TEXT NOT NULL,
  program                   TEXT,
  grantor                   TEXT,
  subrecipient              TEXT,
  department                TEXT,
  category                  TEXT,

  award_amount              REAL NOT NULL DEFAULT 0,
  obligated_amount          REAL NOT NULL DEFAULT 0,
  expended_amount           REAL NOT NULL DEFAULT 0,

  award_date                TEXT NOT NULL,
  obligation_deadline       TEXT,
  expenditure_deadline      TEXT NOT NULL,
  period_of_performance_end TEXT,

  status                    TEXT NOT NULL DEFAULT 'active',
  assigned_to               TEXT,

  classification            TEXT NOT NULL DEFAULT 'unreviewed',
  review_notes              TEXT,
  last_reviewed_at          TEXT,
  tags                      TEXT NOT NULL DEFAULT '[]',

  risk_score                REAL NOT NULL DEFAULT 0,
  risk_tier                 TEXT NOT NULL DEFAULT 'low',

  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,

  UNIQUE (org_id, grant_number)
);

CREATE INDEX IF NOT EXISTS idx_grants_org         ON grants(org_id);
CREATE INDEX IF NOT EXISTS idx_grants_status      ON grants(org_id, status);
CREATE INDEX IF NOT EXISTS idx_grants_risk        ON grants(org_id, risk_score);
CREATE INDEX IF NOT EXISTS idx_grants_exp_deadline ON grants(org_id, expenditure_deadline);

CREATE TABLE IF NOT EXISTS compliance_tasks (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id),
  grant_id       TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'other',
  title          TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  completed_at   TEXT,
  outcome        TEXT,
  turnaround_days REAL,
  assigned_to    TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_grant ON compliance_tasks(grant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due   ON compliance_tasks(org_id, due_date);

-- Append-only audit trail. Never UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS grant_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  grant_id    TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  summary     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_events_grant ON grant_events(grant_id, at);
CREATE INDEX IF NOT EXISTS idx_events_org   ON grant_events(org_id, at);

-- Metered, billing-relevant actions (packet/report generation, exports).
-- The basis for usage-based pricing and premium-report accounting.
CREATE TABLE IF NOT EXISTS usage_events (
  id        TEXT PRIMARY KEY,
  org_id    TEXT NOT NULL REFERENCES organizations(id),
  at        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  actor     TEXT NOT NULL,
  quantity  INTEGER NOT NULL DEFAULT 1,
  ref       TEXT,
  meta      TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_org ON usage_events(org_id, at);

-- Append-only audit log of subscription/plan changes. Billing-sensitive, so
-- who/when/old->new/reason is recorded and never mutated.
CREATE TABLE IF NOT EXISTS subscription_events (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_events_org ON subscription_events(org_id, at);

-- Operator accounts. Password hashes are scrypt (salt embedded); the app never
-- stores or logs plaintext. Roles: admin (may change billing) vs member.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id),
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'member',
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT,
  deactivated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- Append-only audit of user-management actions (create / deactivate / role).
CREATE TABLE IF NOT EXISTS user_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_id   TEXT,
  target_email TEXT,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_events_org ON user_events(org_id, at);
`;

/**
 * Idempotent column additions for databases created before the subscription /
 * benchmark fields existed. CREATE TABLE IF NOT EXISTS won't alter an existing
 * table, so we add missing columns explicitly. Safe to run on every boot.
 */
export const ORG_MIGRATION_COLUMNS: Array<[string, string]> = [
  ["region", "region TEXT"],
  ["data_sharing_opt_in", "data_sharing_opt_in INTEGER NOT NULL DEFAULT 0"],
  ["plan", "plan TEXT NOT NULL DEFAULT 'trial'"],
  ["subscription_status", "subscription_status TEXT NOT NULL DEFAULT 'trialing'"],
  ["trial_ends_at", "trial_ends_at TEXT"],
  ["seats", "seats INTEGER"],
  ["api_token", "api_token TEXT"],
];

/** Idempotent column additions for the users table. */
export const USER_MIGRATION_COLUMNS: Array<[string, string]> = [
  ["deactivated_at", "deactivated_at TEXT"],
];
