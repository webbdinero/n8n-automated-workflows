import { randomUUID } from "node:crypto";
import type { GrantRepository } from "../repositories/grantRepository.js";
import type { TaskRepository, NewTask } from "../repositories/taskRepository.js";
import type { EventRepository } from "../repositories/eventRepository.js";
import type {
  GrantInput,
  GrantRecord,
  GrantUpdate,
  TaskRecord,
} from "../domain/schemas.js";
import type { EventSource, TaskOutcome } from "../domain/constants.js";
import { nowIso, todayIso, daysBetween } from "../util/dates.js";
import {
  scoreGrant,
  type ScoringGrant,
  type ScoringTask,
} from "./scoring.js";
import { DuplicateGrantError, NotFoundError, ValidationError } from "./errors.js";

export interface ActorContext {
  actor: string;
  source: EventSource;
}

function toScoringGrant(g: GrantRecord): ScoringGrant {
  return {
    award_amount: g.award_amount,
    obligated_amount: g.obligated_amount,
    expended_amount: g.expended_amount,
    award_date: g.award_date,
    obligation_deadline: g.obligation_deadline,
    expenditure_deadline: g.expenditure_deadline,
    period_of_performance_end: g.period_of_performance_end,
    status: g.status,
    assigned_to: g.assigned_to,
    department: g.department,
    category: g.category,
  };
}

function toScoringTasks(tasks: TaskRecord[]): ScoringTask[] {
  return tasks.map((t) => ({
    status: t.status,
    due_date: t.due_date,
    outcome: t.outcome,
  }));
}

/** Human-readable, comparable representation of a field for the audit log. */
function displayValue(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

interface GrantInvariantFields {
  award_amount: number;
  obligated_amount: number;
  expended_amount: number;
  award_date: string;
  expenditure_deadline: string;
  obligation_deadline: string | null;
}

/**
 * Enforce the same financial/date invariants the create schema enforces, but
 * against an already-merged record (used by partial updates). Throws
 * ValidationError so web routes can surface it inline and the API returns 400.
 */
function assertGrantInvariants(g: GrantInvariantFields): void {
  const issues: Array<{ path: string; message: string }> = [];
  if (g.expended_amount > g.award_amount) {
    issues.push({ path: "expended_amount", message: "expended_amount cannot exceed award_amount" });
  }
  if (g.obligated_amount > g.award_amount) {
    issues.push({ path: "obligated_amount", message: "obligated_amount cannot exceed award_amount" });
  }
  if (g.expenditure_deadline < g.award_date) {
    issues.push({ path: "expenditure_deadline", message: "expenditure_deadline cannot be before award_date" });
  }
  if (g.obligation_deadline && g.obligation_deadline < g.award_date) {
    issues.push({ path: "obligation_deadline", message: "obligation_deadline cannot be before award_date" });
  }
  if (issues.length > 0) {
    throw new ValidationError(issues[0]!.message, issues);
  }
}

/**
 * Orchestrates all grant mutations. Every change flows through here so that:
 *   (1) the append-only audit trail is written, and
 *   (2) the risk score is recomputed and persisted.
 * Repositories stay dumb (SQL only); this is where the invariants live.
 */
export class GrantService {
  constructor(
    private readonly grants: GrantRepository,
    private readonly tasks: TaskRepository,
    private readonly events: EventRepository,
  ) {}

  createGrant(
    orgId: string,
    input: GrantInput,
    ctx: ActorContext,
  ): GrantRecord {
    if (this.grants.findByNumber(orgId, input.grant_number)) {
      throw new DuplicateGrantError(input.grant_number);
    }
    const now = nowIso();
    const base: GrantRecord = {
      id: randomUUID(),
      org_id: orgId,
      grant_number: input.grant_number,
      title: input.title,
      funding_source: input.funding_source,
      program: input.program ?? null,
      grantor: input.grantor ?? null,
      subrecipient: input.subrecipient ?? null,
      department: input.department ?? null,
      category: input.category ?? null,
      award_amount: input.award_amount,
      obligated_amount: input.obligated_amount,
      expended_amount: input.expended_amount,
      award_date: input.award_date,
      obligation_deadline: input.obligation_deadline ?? null,
      expenditure_deadline: input.expenditure_deadline,
      period_of_performance_end: input.period_of_performance_end ?? null,
      status: input.status,
      assigned_to: input.assigned_to ?? null,
      classification: input.classification,
      review_notes: input.review_notes ?? null,
      last_reviewed_at: null,
      tags: input.tags ?? [],
      risk_score: 0,
      risk_tier: "low",
      created_at: now,
      updated_at: now,
    };
    const { score, tier } = scoreGrant(toScoringGrant(base), [], todayIso());
    base.risk_score = score;
    base.risk_tier = tier;

    this.grants.insert(base);
    this.events.append({
      org_id: orgId,
      grant_id: base.id,
      actor: ctx.actor,
      event_type: ctx.source === "csv" || ctx.source === "json" ? "imported" : "created",
      source: ctx.source,
      summary: `Grant ${base.grant_number} (${base.title}) recorded — award $${base.award_amount.toLocaleString()}.`,
      new_value: `risk ${score} (${tier})`,
    });
    return base;
  }

  updateGrant(
    id: string,
    update: GrantUpdate,
    ctx: ActorContext,
  ): GrantRecord {
    const current = this.grants.findById(id);
    if (!current) throw new NotFoundError(`Grant ${id} not found`);

    // Re-validate cross-field invariants against the MERGED record. The edit
    // form and API PATCH are partial updates that would otherwise bypass the
    // create-time checks and let a grant end up with expended > award or a
    // deadline before its award date — corrupting metrics and scoring.
    assertGrantInvariants({
      award_amount: update.award_amount ?? current.award_amount,
      obligated_amount: update.obligated_amount ?? current.obligated_amount,
      expended_amount: update.expended_amount ?? current.expended_amount,
      award_date: update.award_date ?? current.award_date,
      expenditure_deadline: update.expenditure_deadline ?? current.expenditure_deadline,
      obligation_deadline:
        update.obligation_deadline !== undefined
          ? update.obligation_deadline
          : current.obligation_deadline,
    });

    const changes: Record<string, unknown> = {};
    const current2 = current as unknown as Record<string, unknown>;

    for (const [key, rawNext] of Object.entries(update)) {
      if (rawNext === undefined) continue;
      const next = rawNext === "" ? null : rawNext;
      const prev = current2[key] ?? null;
      const prevNorm = typeof prev === "number" ? prev : prev ?? null;
      const nextNorm = typeof next === "number" ? next : next ?? null;
      if (String(prevNorm) === String(nextNorm)) continue;

      changes[key] = next;
      let eventType:
        | "field_changed"
        | "status_changed"
        | "classification_changed"
        | "note_added" = "field_changed";
      if (key === "status") eventType = "status_changed";
      else if (key === "classification") eventType = "classification_changed";
      else if (key === "review_notes") eventType = "note_added";

      this.events.append({
        org_id: current.org_id,
        grant_id: id,
        actor: ctx.actor,
        source: ctx.source,
        event_type: eventType,
        field: key,
        old_value: displayValue(prev),
        new_value: displayValue(next),
        summary:
          eventType === "note_added"
            ? `Review note updated by ${ctx.actor}.`
            : `${key.replace(/_/g, " ")} changed from ${displayValue(prev)} to ${displayValue(next)}.`,
      });
    }

    if (Object.keys(changes).length === 0) return current;

    // Any human review touches the last-reviewed timestamp.
    if ("classification" in changes || "review_notes" in changes) {
      changes.last_reviewed_at = nowIso();
    }

    this.grants.update(id, changes);
    return this.rescoreGrant(id);
  }

  /** Recompute and persist the risk score from the current grant + tasks. */
  rescoreGrant(id: string, asOf: string = todayIso()): GrantRecord {
    const grant = this.grants.findById(id);
    if (!grant) throw new NotFoundError(`Grant ${id} not found`);
    const tasks = this.tasks.listForGrant(id);
    const before = grant.risk_score;
    const { score, tier } = scoreGrant(
      toScoringGrant(grant),
      toScoringTasks(tasks),
      asOf,
    );
    if (score !== before || tier !== grant.risk_tier) {
      this.grants.setScore(id, score, tier);
      this.events.append({
        org_id: grant.org_id,
        grant_id: id,
        actor: "system",
        source: "system",
        event_type: "scored",
        field: "risk_score",
        old_value: String(before),
        new_value: `${score} (${tier})`,
        summary: `Risk score recalculated: ${before} → ${score} (${tier}).`,
      });
    }
    return { ...grant, risk_score: score, risk_tier: tier };
  }

  /** Recompute scores for every grant in an org (used at boot + admin action). */
  refreshAllScores(orgId: string, asOf: string = todayIso()): number {
    const grants = this.grants.listAll(orgId);
    let changed = 0;
    for (const g of grants) {
      const before = g.risk_score;
      const tasks = this.tasks.listForGrant(g.id);
      const { score, tier } = scoreGrant(
        toScoringGrant(g),
        toScoringTasks(tasks),
        asOf,
      );
      if (score !== before || tier !== g.risk_tier) {
        this.grants.setScore(g.id, score, tier);
        changed++;
      }
    }
    return changed;
  }

  /* ----------------------------- Tasks ---------------------------------- */

  addTask(input: NewTask, ctx: ActorContext): TaskRecord {
    const task = this.tasks.insert(input);
    this.events.append({
      org_id: input.org_id,
      grant_id: input.grant_id,
      actor: ctx.actor,
      source: ctx.source,
      event_type: "task_created",
      field: "task",
      new_value: task.title,
      summary: `Reporting obligation added: "${task.title}" due ${task.due_date}.`,
    });
    this.rescoreGrant(input.grant_id);
    return task;
  }

  completeTask(
    taskId: string,
    ctx: ActorContext,
    outcomeOverride?: TaskOutcome,
  ): TaskRecord {
    const task = this.tasks.findById(taskId);
    if (!task) throw new NotFoundError(`Task ${taskId} not found`);
    // Idempotent: completing an already-completed task is a no-op (guards
    // against double-submits corrupting turnaround/outcome).
    if (task.status === "completed") return task;
    const completedAt = nowIso();
    const completedDate = todayIso(new Date(completedAt));
    const outcome: TaskOutcome =
      outcomeOverride ??
      (daysBetween(completedDate, task.due_date) >= 0 ? "on_time" : "late");
    const turnaround = daysBetween(
      task.created_at.slice(0, 10),
      completedDate,
    );
    this.tasks.markCompleted(taskId, outcome, turnaround, completedAt);
    this.events.append({
      org_id: task.org_id,
      grant_id: task.grant_id,
      actor: ctx.actor,
      source: ctx.source,
      event_type: "task_completed",
      field: "task",
      old_value: task.title,
      new_value: outcome,
      summary: `Obligation "${task.title}" completed ${outcome.replace("_", " ")} (${turnaround} day turnaround).`,
    });
    this.rescoreGrant(task.grant_id);
    return { ...task, status: "completed", outcome, turnaround_days: turnaround, completed_at: completedAt };
  }
}
