# GrantGuard

**Vertical SaaS for public-sector grant compliance monitoring & audit-packet automation.**

GrantGuard turns the painful, spreadsheet-driven workflow of tracking government
grants (ARPA/SLFRF, CDBG, FEMA, EPA, DOT/IIJA, HUD, state & county pass-throughs)
into software. Municipalities, authorities, and the consultants who serve them
track award/obligation/expenditure balances, hard federal deadlines, and reporting
obligations — and get a live **compliance risk score**, **alerts**, and
**audit-ready export packets** out the other side.

Every change is captured in an **immutable audit trail**, and every tenant records
grants in the **same canonical schema** — the foundation for cross-org benchmarks
and, later, licensable intelligence products.

> Timely by design: the SLFRF final expenditure deadline is **Dec 31, 2026**, so
> the seed portfolio models the exact spend-down pressure municipalities face now.

---

## Why this is a business, not just an app

| Goal | How GrantGuard delivers it |
| --- | --- |
| Productized service → software | The manual "grant tracker" workflow is fully modeled: ingest → score → alert → report. |
| Proprietary data capture | Immutable audit trail, reporting outcomes + turnaround, reviewer classifications & notes. |
| Recurring revenue | Per-seat SaaS + managed compliance service + premium/on-demand audit packets. |
| Moat / switching cost | The customer's entire longitudinal compliance history lives here; leaving means losing it. |
| Benchmarks / data resale | Uniform cross-tenant schema enables anonymized peer benchmarking (see Admin → Peer benchmarks). |
| Low cost, high automation | One Node process, one SQLite file, no build step, no external services. |

### Which fields are proprietary, and why

- **Immutable `grant_events` audit trail** — appended, never overwritten. A
  tamper-evident, longitudinal record no competitor can reconstruct.
- **Reporting outcomes & turnaround** (`on_time`/`late`/`missed`, days-to-close) —
  measurable operational performance nobody else holds.
- **Reviewer classification & notes** (`compliant`/`finding`/`remediation`, …) —
  encoded human compliance judgment; training data for future automation.
- **Scored risk-factor histories** — the input to trends, cohorts, and benchmarks.
- **Canonical cross-org schema** — makes anonymized benchmarking / licensing possible.

---

## Stack

- **Node 22 + TypeScript**, run with **tsx** (no build step)
- **Express** web server, **EJS** server-rendered semantic HTML (accessible, no SPA)
- **`node:sqlite`** — the built-in SQLite in Node 22 (zero native deps; a single
  file DB). All access is behind a repository layer, so swapping to Postgres later
  is a localized change.
- **Zod** for the canonical, explicit data-model schemas + ingestion validation
- **Vitest** for tests on the critical logic

No microservices, no message bus, no ORM — deliberately.

---

## Quick start

```bash
# 1. Install (Node >= 22.5 required for node:sqlite)
npm install

# 2. Load the pilot org + two peer orgs with realistic sample data
npm run seed

# 3. Run
npm start
# → http://localhost:3000
```

**Sign in.** The app is gated — `npm run seed` prints the pilot login and API
token. Defaults:

- **Email:** `admin@demo-borough.gov`  **Password:** `grantguard-pilot`
  (override with `SEED_ADMIN_PASSWORD`; change before real use)
- **API token** (for the JSON API / n8n): printed by seed and shown in
  **Admin → API access**.

If you start without seeding, the app bootstraps an admin for the default org
and prints a generated password once (set `ADMIN_PASSWORD` to control it). Set
`SESSION_SECRET` so sessions survive restarts.

Then open the dashboard. Useful scripts:

```bash
npm run dev        # auto-reloading dev server (tsx watch)
npm test           # run the vitest suite
npm run typecheck  # tsc --noEmit
npm run reset      # wipe the DB and re-seed
```

Configuration is optional — sensible defaults are baked in. Copy `.env.example`
to `.env` to override the port, DB path, or default org slug.

---

## What you can do

| Area | Route | Notes |
| --- | --- | --- |
| **Sign in** | `/login` | Session-based auth gates all web routes; roles are `admin` / `member`. |
| **Dashboard** | `/` | KPIs (portfolio value, unspent, at-risk, expiring ≤90d, overdue reports), risk distribution, funding mix, top alerts, recent activity. |
| **Grants** | `/grants` | Search + filters (status, funding, risk tier, classification, owner) + sorting. |
| **Grant detail** | `/grants/:id` | Overview, inline edit + review, reporting obligations, live risk breakdown, **Evidence**, filterable **Change History**, and open **Anomalies**. |
| **Anomalies** | `/anomalies` | Investigator queue of open, rule-based anomaly flags; admins mark under-review / cleared (audited). |
| **Case file** | `/grants/:id/casefile` | Standalone, audit-binder-ready HTML: grant snapshot + change history + evidence + anomalies (`?download=1` to save). |
| **Add / import** | `/grants/new`, `/import` | Manual entry, or paste/upload CSV or JSON (columns auto-mapped, every row validated). |
| **Alerts** | `/alerts` | Live-derived, severity-ranked (deadline pressure, obligation gaps, overdue reports). |
| **Admin** | `/admin` | Org settings, recompute, exports, **peer benchmarks**, proprietary-data map. |
| **Compliance packet** | `/grants/:id/packet` | Printable, audit-ready packet (print → Save as PDF). |
| **Exports** | `/exports/grants.csv`, `/exports/grants.json` | Portfolio CSV (all plans) + full structured JSON (premium — the customer's portable copy). |
| **JSON API** | `/api/*` | `grants`, `grants/:id`, `POST/PATCH grants`, `summary`, `alerts`, `benchmarks` — the integration surface for n8n/automation. |

### Subscription plans, gating & usage metering

Each organization carries a **plan** (`trial`/`pilot`/`standard`/`enterprise`),
`subscription_status`, trial end, and a `data_sharing_opt_in` consent flag.
Entitlements live in `src/domain/plans.ts` (single source of truth) and gate
premium capabilities:

- **Benchmarks** (Admin + `/api/benchmarks`) — premium; only pools opted-in peers.
- **Premium compliance packet** — adds an anonymized peer-benchmark section.
- **Full JSON export** — premium; CSV is available on every plan.
- **Grant limit** — trial caps at 15 grants (enforced on manual create, API, and import).

Billing-relevant actions (packet generation, exports, imports) are recorded in
`usage_events` as a **metering basis** for usage-based / premium-report pricing,
and surfaced in Admin. Manage the plan at **Admin → Subscription** (`POST /admin/subscription`).

### Oversight & investigation (Inspector General features)

Built for municipal IGs, internal auditors, and oversight teams:

- **Evidence & chain of custody** (`evidence_items`) — attach links/notes (and
  filenames as attachment stubs; real file storage is out of scope for now) to a
  grant. Append-only: items are superseded, never hard-deleted. Every add is
  audited. Extensible to other entities by generalizing `grant_id`.
- **Change History** — a filterable view over the existing append-only
  `grant_events` (no parallel tracking system): filter by actor, event type, and
  date range; shows actor role, field-level old→new, and summary.
- **Anomalies** (`anomaly_events`) — transparent, deterministic, **config-driven**
  rules (`src/services/anomalyRules.ts`): large last-minute change near a
  deadline, frequent edits to a high-value grant, and repeated documentation
  notes. Rules run on grant update and via an admin **Recompute**; they flag,
  never block. Workflow: `open → under_review → cleared`, all audited.
- **Case File export** — a standalone HTML packet (grant snapshot + change
  history + evidence + anomalies) for an audit binder.

### Authentication

- **Web UI:** session-based login (`/login`), scrypt-hashed passwords, signed
  HttpOnly `SameSite=Lax` session cookie. Roles: `admin` (may change
  billing/subscription, rotate the API token, manage users) vs `member`. The
  audit trail records the **real signed-in user** as the actor on every change.
- **JSON API:** per-org **bearer token** (`Authorization: Bearer <token>` or
  `x-api-key`). Without a valid token, every `/api/*` route returns `401`. Manage
  and rotate the token in **Admin → API access**.
- **Login rate limiting:** failed logins are throttled per `email+IP`
  (default **5 attempts / 15-min window**, then a **15-min lockout** → `429`).
  In-memory (single-instance pilot); swap the Map for Redis to scale out.
- **CSRF:** state-changing web POSTs (grant create/update, tasks, subscription,
  token rotation, user management, import) require a session-bound token
  (hidden `_csrf` field = HMAC of the session cookie); missing/invalid → `403`.
  The bearer-token API is exempt (no ambient cookie). Layers on top of SameSite.
- **User management** (**Admin → Manage users**, admin-only): list users, create
  an operator with a **generated one-time password** (shown once), and
  deactivate access. No self-signup, no in-app password change yet. A
  deactivated account cannot log in and its existing session is treated as
  signed-out. Every create/deactivate is written to an append-only user audit.

### API examples

```bash
TOKEN=gg_...   # from `npm run seed` output or Admin → API access
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/summary
curl -H "Authorization: Bearer $TOKEN" 'localhost:3000/api/grants?risk_tier=high'
curl -X POST localhost:3000/api/grants \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'x-actor: jane' \
  -d '{"grant_number":"SLFRF-9","title":"Park HVAC","funding_source":"ARPA_SLFRF",
       "award_amount":250000,"award_date":"2024-01-01","expenditure_deadline":"2026-12-31"}'
```

---

## Architecture

```
src/
  config.ts                 # env + paths
  index.ts                  # entrypoint (boot + refresh scores)
  server.ts                 # Express app factory + middleware
  domain/
    constants.ts            # canonical enums (single source of truth)
    schemas.ts              # Zod schemas + inferred types (the data model)
  db/
    schema.ts               # SQL DDL (grants, compliance_tasks, grant_events, orgs)
    connection.ts           # node:sqlite connection (singleton / in-memory)
    sampleData.ts, seed.ts  # realistic seed data (pilot + peers)
  repositories/             # thin SQL data access (one per aggregate)
  services/
    scoring.ts              # risk engine (pure, weighted, explainable)
    alertService.ts         # live alert derivation (pure)
    metrics.ts              # portfolio summary (pure)
    benchmarkService.ts     # cross-org benchmarks (pure)
    ingestService.ts, csv.ts# CSV/JSON ingestion + column mapping
    grantService.ts         # orchestration: mutations → audit trail + rescore
    exportService.ts        # compliance packet + CSV/JSON exports
  routes/                   # webRoutes (HTML) + apiRoutes (JSON)
  views/                    # EJS templates
  public/                   # styles.css + progressive-enhancement JS
tests/                      # vitest suites for the critical logic
```

**Design rule:** repositories only do SQL; **services own the invariants**. Every
grant mutation flows through `GrantService`, which (1) writes the append-only audit
event(s) and (2) recomputes and persists the risk score. Adding a new vertical means
adding a new domain module beside these — the plumbing is reusable.

### The scoring model (transparent, not a black box)

A grant's 0–100 compliance risk score is a weighted blend of five explainable
factors, each shown in the UI and the export packet:

| Factor | Weight | Signal |
| --- | --- | --- |
| Spend pace vs. timeline | 30 | Behind the expected burn-down given elapsed time. |
| Expenditure deadline pressure | 30 | Unspent funds as the hard deadline nears / passes (clawback risk). |
| Obligation gap | 15 | Unobligated funds near/after the obligation deadline (deobligation risk). |
| Reporting compliance | 20 | Overdue and missed reporting obligations. |
| Data completeness | 5 | Missing structured fields (also nudges proprietary data capture). |

Tiers: `low` <25, `medium` <50, `high` <75, `critical` ≥75. Closed/deobligated
grants are excluded from active monitoring. Scores refresh on boot, on every
change, and via **Admin → Recompute** (they are date-relative).

---

## Testing

```bash
npm test
```

Covers the logic that matters: the scoring engine (each factor + tier boundaries +
terminal states), CSV parsing/serialization, ingestion column-mapping & validation,
audit-trail + rescore behavior on create/update/task-completion, portfolio metrics,
alert derivation, and benchmarks. In-memory SQLite makes the data-layer tests fast
and isolated.

---

## Assumptions & scope (MVP)

- **Auth is wired** (session login, roles, per-org API token); **multi-tenancy is
  data-ready but the UI serves one active org.** `org_id` is threaded through every
  table/query and users belong to an org — per-user org switching is the next step.
- **Money stored as REAL dollars** (rounded to whole cents on input) for MVP
  simplicity; a future migration to integer cents is isolated to the repository layer.
- **File upload** is done client-side (file → textarea via `FileReader`) to avoid
  multipart deps; paste and manual entry are first-class.
- **Billing is metered, not charged.** `usage_events` + plan entitlements + roles
  are the hooks; wiring a payment processor (e.g. Stripe) is the next commercial step.
- **CSRF** uses per-session HMAC form tokens plus `SameSite=Lax` cookies.
- **Login throttling** is in-memory (per instance) — fine for the single-instance
  pilot; move to Redis for horizontal scale.

## Next 5 features (defensibility + recurring revenue)

1. **Stripe billing on the existing hooks.** Plans, entitlements, roles, and
   `usage_events` are already in place; connect Stripe Checkout + webhooks to turn
   the metering into actual recurring revenue and self-serve upgrades.
2. **Scheduled report delivery.** Email the premium packet / portfolio digest on a
   cadence via the JSON API + n8n. Turns a one-off artifact into a recurring,
   billable deliverable — the core of the managed-service tier.
3. **Peer Benchmark Intelligence product.** Cohort-filtered, anonymized "how you
   compare to peers" reports (by population band, funding source, region) built on
   the opt-in data set. The licensable data product and deepest moat — improves
   automatically as tenants onboard.
4. **Alerts → action automation.** Threshold-based email/Slack escalation and
   auto-created reporting obligations from grant metadata — a system of action,
   which justifies managed-service pricing and raises switching cost.
5. **Full multi-tenant self-serve.** User management UI (invite/roles), org
   switching, and signup — turning the data-ready multi-tenancy into a
   self-onboarding funnel with seat-based expansion.
