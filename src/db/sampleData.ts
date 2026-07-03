import type { Container } from "../container.js";
import { grantInputSchema } from "../domain/schemas.js";
import type { OrgType, TaskType, TaskOutcome } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";

/**
 * Realistic seed data for a pilot municipality plus two anonymized peers (so
 * the benchmark surface has something to compare against). Dates are chosen
 * relative to a mid-2026 "today" so the portfolio spans low → critical risk,
 * including live SLFRF expenditure-deadline pressure (final deadline 2026-12-31).
 */

interface SampleTask {
  type: TaskType;
  title: string;
  due_date: string;
  /** If set, the task is seeded as already completed with this outcome + turnaround. */
  completed?: { outcome: TaskOutcome; turnaround_days: number; completed_at: string };
}

interface SampleGrant {
  grant: Record<string, unknown>;
  tasks?: SampleTask[];
}

const PILOT_GRANTS: SampleGrant[] = [
  {
    grant: {
      grant_number: "SLFRF-2022-001",
      title: "Water & Sewer Infrastructure Modernization",
      funding_source: "ARPA_SLFRF",
      program: "Coronavirus State & Local Fiscal Recovery Funds",
      grantor: "US Treasury",
      department: "Public Works",
      category: "Water/Sewer Infrastructure",
      award_amount: 2_500_000,
      obligated_amount: 2_500_000,
      expended_amount: 900_000,
      award_date: "2022-06-01",
      obligation_deadline: "2024-12-31",
      expenditure_deadline: "2026-12-31",
      status: "monitoring",
      assigned_to: "J. Rivera",
      classification: "needs_docs",
    },
    tasks: [
      { type: "project_expenditure_report", title: "Q1 2026 Project & Expenditure Report", due_date: "2026-04-30", completed: { outcome: "on_time", turnaround_days: 9, completed_at: "2026-04-24T15:00:00Z" } },
      { type: "project_expenditure_report", title: "Q2 2026 Project & Expenditure Report", due_date: "2026-07-31" },
    ],
  },
  {
    grant: {
      grant_number: "SLFRF-2022-004",
      title: "Municipal Broadband Expansion",
      funding_source: "ARPA_SLFRF",
      grantor: "US Treasury",
      department: "IT",
      category: "Broadband Infrastructure",
      award_amount: 1_200_000,
      obligated_amount: 1_200_000,
      expended_amount: 1_150_000,
      award_date: "2022-09-15",
      obligation_deadline: "2024-12-31",
      expenditure_deadline: "2026-12-31",
      status: "active",
      assigned_to: "A. Chen",
      classification: "compliant",
    },
    tasks: [
      { type: "project_expenditure_report", title: "Q2 2026 P&E Report", due_date: "2026-07-31" },
    ],
  },
  {
    grant: {
      grant_number: "SLFRF-2023-011",
      title: "Essential Worker Premium Pay",
      funding_source: "ARPA_SLFRF",
      grantor: "US Treasury",
      department: "Human Resources",
      category: "Premium Pay",
      award_amount: 400_000,
      obligated_amount: 400_000,
      expended_amount: 0,
      award_date: "2023-01-10",
      obligation_deadline: "2024-12-31",
      expenditure_deadline: "2026-12-31",
      status: "at_risk",
      assigned_to: "J. Rivera",
      classification: "finding",
      review_notes: "No disbursements recorded 18 months after obligation. Escalated to finance director.",
    },
    tasks: [
      { type: "quarterly_report", title: "Overdue: Q4 2025 Compliance Report", due_date: "2026-01-31" },
      { type: "project_expenditure_report", title: "Q1 2026 P&E Report", due_date: "2026-04-30" },
    ],
  },
  {
    grant: {
      grant_number: "CDBG-2024-07",
      title: "Owner-Occupied Housing Rehabilitation",
      funding_source: "CDBG",
      grantor: "HUD via PA DCED",
      department: "Community Development",
      category: "Housing Rehabilitation",
      award_amount: 600_000,
      obligated_amount: 400_000,
      expended_amount: 250_000,
      award_date: "2024-03-01",
      obligation_deadline: "2026-08-15",
      expenditure_deadline: "2027-06-30",
      status: "monitoring",
      assigned_to: "M. Okafor",
      classification: "needs_docs",
    },
    tasks: [
      { type: "subrecipient_monitoring", title: "Subrecipient monitoring site visit", due_date: "2026-08-01" },
    ],
  },
  {
    grant: {
      grant_number: "FEMA-PA-2024-19",
      title: "Severe Storm Public Assistance",
      funding_source: "FEMA",
      grantor: "FEMA",
      department: "Emergency Management",
      category: "Disaster Recovery",
      award_amount: 850_000,
      obligated_amount: 850_000,
      expended_amount: 300_000,
      award_date: "2024-08-20",
      expenditure_deadline: "2026-09-30",
      status: "monitoring",
      assigned_to: "A. Chen",
      classification: "unreviewed",
    },
    tasks: [
      { type: "quarterly_report", title: "Overdue: FEMA quarterly progress report", due_date: "2026-06-15" },
    ],
  },
  {
    grant: {
      grant_number: "EPA-DWSRF-2024-03",
      title: "Lead Service Line Replacement",
      funding_source: "EPA",
      grantor: "EPA / PA DEP",
      department: "Public Works",
      category: "Water/Sewer Infrastructure",
      award_amount: 500_000,
      obligated_amount: 250_000,
      expended_amount: 100_000,
      award_date: "2024-05-01",
      obligation_deadline: "2026-07-31",
      expenditure_deadline: "2027-12-31",
      status: "at_risk",
      assigned_to: "J. Rivera",
      classification: "remediation",
      review_notes: "Half the award still unobligated with the obligation deadline weeks away.",
    },
  },
  {
    grant: {
      grant_number: "IIJA-BRIDGE-2023-02",
      title: "Main Street Bridge Rehabilitation",
      funding_source: "DOT_IIJA",
      grantor: "US DOT / PennDOT",
      department: "Public Works",
      category: "Transportation",
      award_amount: 3_400_000,
      obligated_amount: 2_000_000,
      expended_amount: 800_000,
      award_date: "2023-11-01",
      obligation_deadline: "2027-09-30",
      expenditure_deadline: "2028-12-31",
      status: "active",
      assigned_to: "M. Okafor",
      classification: "compliant",
    },
    tasks: [
      { type: "annual_report", title: "2025 Annual Performance Report", due_date: "2026-03-31", completed: { outcome: "late", turnaround_days: 21, completed_at: "2026-04-18T12:00:00Z" } },
    ],
  },
  {
    grant: {
      grant_number: "HUD-CoC-2024-05",
      title: "Continuum of Care — Homeless Services",
      funding_source: "HUD",
      grantor: "HUD",
      department: "Human Services",
      category: "Housing / Homeless Services",
      award_amount: 300_000,
      obligated_amount: 300_000,
      expended_amount: 285_000,
      award_date: "2024-01-15",
      expenditure_deadline: "2026-12-31",
      status: "active",
      assigned_to: "M. Okafor",
      classification: "compliant",
    },
  },
  {
    grant: {
      grant_number: "STATE-PARKS-2023-08",
      title: "Riverfront Park Improvements",
      funding_source: "STATE",
      grantor: "PA DCNR",
      department: "Parks & Recreation",
      category: "Parks / Recreation",
      award_amount: 150_000,
      obligated_amount: 150_000,
      expended_amount: 150_000,
      award_date: "2023-04-01",
      expenditure_deadline: "2025-12-31",
      status: "closed",
      assigned_to: "A. Chen",
      classification: "compliant",
    },
    tasks: [
      { type: "closeout", title: "Grant closeout package", due_date: "2026-01-31", completed: { outcome: "on_time", turnaround_days: 12, completed_at: "2026-01-19T10:00:00Z" } },
    ],
  },
  {
    grant: {
      grant_number: "USDA-RD-2024-14",
      title: "Rural Water System Upgrade",
      funding_source: "USDA",
      grantor: "USDA Rural Development",
      department: "Public Works",
      category: "Water/Sewer Infrastructure",
      award_amount: 220_000,
      obligated_amount: 220_000,
      expended_amount: 120_000,
      award_date: "2024-06-01",
      expenditure_deadline: "2027-03-31",
      status: "monitoring",
      assigned_to: "J. Rivera",
      classification: "unreviewed",
    },
  },
];

const PEER_A_GRANTS: SampleGrant[] = [
  {
    grant: {
      grant_number: "P1-SLFRF-01", title: "Sewer Plant Upgrade", funding_source: "ARPA_SLFRF",
      grantor: "US Treasury", department: "Public Works", category: "Water/Sewer Infrastructure",
      award_amount: 1_800_000, obligated_amount: 1_800_000, expended_amount: 1_500_000,
      award_date: "2022-05-01", obligation_deadline: "2024-12-31", expenditure_deadline: "2026-12-31",
      status: "monitoring", assigned_to: "Peer Staff", classification: "compliant",
    },
    tasks: [
      { type: "project_expenditure_report", title: "Q1 2026 P&E", due_date: "2026-04-30", completed: { outcome: "on_time", turnaround_days: 5, completed_at: "2026-04-25T12:00:00Z" } },
    ],
  },
  {
    grant: {
      grant_number: "P1-CDBG-02", title: "Downtown Facade Program", funding_source: "CDBG",
      grantor: "HUD", department: "Community Development", category: "Economic Development",
      award_amount: 450_000, obligated_amount: 450_000, expended_amount: 400_000,
      award_date: "2023-07-01", expenditure_deadline: "2026-12-31",
      status: "active", assigned_to: "Peer Staff", classification: "compliant",
    },
  },
];

const PEER_B_GRANTS: SampleGrant[] = [
  {
    grant: {
      grant_number: "P2-SLFRF-01", title: "Community Center HVAC", funding_source: "ARPA_SLFRF",
      grantor: "US Treasury", department: "Facilities", category: "Public Facilities",
      award_amount: 900_000, obligated_amount: 900_000, expended_amount: 300_000,
      award_date: "2022-10-01", obligation_deadline: "2024-12-31", expenditure_deadline: "2026-12-31",
      status: "at_risk", assigned_to: "Peer Staff", classification: "finding",
    },
    tasks: [
      { type: "project_expenditure_report", title: "Q4 2025 P&E", due_date: "2026-01-31", completed: { outcome: "late", turnaround_days: 34, completed_at: "2026-03-05T12:00:00Z" } },
      { type: "quarterly_report", title: "Overdue: Q1 2026 report", due_date: "2026-05-01" },
    ],
  },
  {
    grant: {
      grant_number: "P2-FEMA-02", title: "Flood Mitigation", funding_source: "FEMA",
      grantor: "FEMA", department: "Emergency Management", category: "Disaster Recovery",
      award_amount: 650_000, obligated_amount: 400_000, expended_amount: 150_000,
      award_date: "2024-02-01", obligation_deadline: "2026-09-30", expenditure_deadline: "2027-06-30",
      status: "monitoring", assigned_to: "Peer Staff", classification: "needs_docs",
    },
  },
];

function seedOrg(
  c: Container,
  slug: string,
  name: string,
  type: OrgType,
  population: number,
  samples: SampleGrant[],
): void {
  const org = c.orgs.ensure({ slug, name, type, state: "PA", population });
  if (c.grants.listAll(org.id).length > 0) return; // idempotent

  for (const sample of samples) {
    const input = grantInputSchema.parse(sample.grant);
    const grant = c.grantService.createGrant(org.id, input, {
      actor: "seed",
      source: "csv",
    });
    for (const t of sample.tasks ?? []) {
      const task = c.tasks.insert({
        org_id: org.id,
        grant_id: grant.id,
        type: t.type,
        title: t.title,
        due_date: t.due_date,
      });
      if (t.completed) {
        c.tasks.markCompleted(
          task.id,
          t.completed.outcome,
          t.completed.turnaround_days,
          t.completed.completed_at,
        );
        c.events.append({
          org_id: org.id,
          grant_id: grant.id,
          actor: "seed",
          source: "system",
          event_type: "task_completed",
          field: "task",
          new_value: t.completed.outcome,
          summary: `Obligation "${t.title}" completed ${t.completed.outcome.replace("_", " ")} (${t.completed.turnaround_days} day turnaround).`,
          at: t.completed.completed_at,
        });
      } else {
        c.events.append({
          org_id: org.id,
          grant_id: grant.id,
          actor: "seed",
          source: "system",
          event_type: "task_created",
          field: "task",
          new_value: t.title,
          summary: `Reporting obligation added: "${t.title}" due ${t.due_date}.`,
          at: nowIso(),
        });
      }
    }
  }
  c.grantService.refreshAllScores(org.id);
}

/** Populate the database with the pilot org + two peer orgs. Idempotent. */
export function seedDatabase(c: Container): void {
  seedOrg(c, "demo-borough", "Demo Borough (Pilot)", "municipality", 18_500, PILOT_GRANTS);
  seedOrg(c, "peer-township", "Peer Township", "municipality", 14_200, PEER_A_GRANTS);
  seedOrg(c, "peer-authority", "Regional Water Authority", "authority", 42_000, PEER_B_GRANTS);
}
