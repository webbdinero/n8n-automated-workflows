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
| **Dashboard** | `/` | KPIs (portfolio value, unspent, at-risk, expiring ≤90d, overdue reports), risk distribution, funding mix, top alerts, recent activity. |
| **Grants** | `/grants` | Search + filters (status, funding, risk tier, classification, owner) + sorting. |
| **Grant detail** | `/grants/:id` | Overview, inline edit + review, reporting obligations, live risk breakdown, full audit trail. |
| **Add / import** | `/grants/new`, `/import` | Manual entry, or paste/upload CSV or JSON (columns auto-mapped, every row validated). |
| **Alerts** | `/alerts` | Live-derived, severity-ranked (deadline pressure, obligation gaps, overdue reports). |
| **Admin** | `/admin` | Org settings, recompute, exports, **peer benchmarks**, proprietary-data map. |
| **Compliance packet** | `/grants/:id/packet` | Printable, audit-ready packet (print → Save as PDF). |
| **Exports** | `/exports/grants.csv`, `/exports/grants.json` | Portfolio CSV + full structured JSON (the customer's portable copy). |
| **JSON API** | `/api/*` | `grants`, `grants/:id`, `POST/PATCH grants`, `summary`, `alerts`, `benchmarks` — the integration surface for n8n/automation. |

### API examples

```bash
curl localhost:3000/api/summary
curl localhost:3000/api/grants?risk_tier=high
curl -X POST localhost:3000/api/grants -H 'content-type: application/json' -H 'x-actor: jane' \
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

- **Single-tenant UI, multi-tenant-ready data.** The app operates on a default
  org; `org_id` is threaded through every table and query, and peer orgs already
  exist for benchmarking. Org switching + real auth are the next step.
- **No auth yet** — the actor is a fixed "Pilot Admin"; the audit trail already
  records an actor per event, so wiring real identity is drop-in.
- **Money stored as REAL dollars** for MVP simplicity; a future migration to
  integer cents is isolated to the repository layer.
- **File upload** is done client-side (file → textarea via `FileReader`) to avoid
  multipart deps; paste and manual entry are first-class.

## Next 3 highest-value features (monetization + data moat)

1. **Premium "Audit-Ready Packet" + scheduled report delivery.** Turn the existing
   packet into a paid, branded, board/auditor-ready PDF (portfolio-level + single
   audit prep), emailed on a cadence via the JSON API + n8n. Immediate upsell on
   top of the base subscription.
2. **Peer Benchmark Intelligence product.** Productize `benchmarkService` into an
   anonymized, cohort-filtered "how you compare to peers" report (by population
   band, funding source, region). This is the licensable data product and the
   deepest moat — it improves automatically as more tenants onboard.
3. **Deadline & spend-down automation (alerts → action).** Scheduled digests,
   email/Slack escalation on threshold breaches, and auto-created reporting
   obligations from grant metadata — converting GrantGuard from a system of record
   into a system of action, which is what justifies managed-service pricing.
