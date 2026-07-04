import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { TaskRecord } from "../domain/schemas.js";
import type { TaskOutcome, TaskType } from "../domain/constants.js";
import { nowIso } from "../util/dates.js";
import { rowToTask, type Row } from "./serialize.js";

export interface NewTask {
  org_id: string;
  grant_id: string;
  type: TaskType;
  title: string;
  due_date: string;
  assigned_to?: string | null;
  notes?: string | null;
}

export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: NewTask): TaskRecord {
    const now = nowIso();
    const task: TaskRecord = {
      id: randomUUID(),
      org_id: input.org_id,
      grant_id: input.grant_id,
      type: input.type,
      title: input.title,
      due_date: input.due_date,
      status: "open",
      completed_at: null,
      outcome: null,
      turnaround_days: null,
      assigned_to: input.assigned_to ?? null,
      notes: input.notes ?? null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO compliance_tasks
           (id, org_id, grant_id, type, title, due_date, status, completed_at,
            outcome, turnaround_days, assigned_to, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.org_id,
        task.grant_id,
        task.type,
        task.title,
        task.due_date,
        task.status,
        task.completed_at,
        task.outcome,
        task.turnaround_days,
        task.assigned_to,
        task.notes,
        task.created_at,
        task.updated_at,
      );
    return task;
  }

  findById(id: string): TaskRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM compliance_tasks WHERE id = ?`)
      .get(id);
    return row ? rowToTask(row as Row) : null;
  }

  markCompleted(
    id: string,
    outcome: TaskOutcome,
    turnaroundDays: number | null,
    completedAt: string,
  ): void {
    this.db
      .prepare(
        `UPDATE compliance_tasks
           SET status = 'completed', outcome = ?, turnaround_days = ?,
               completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(outcome, turnaroundDays, completedAt, nowIso(), id);
  }

  listForGrant(grantId: string): TaskRecord[] {
    return this.db
      .prepare(`SELECT * FROM compliance_tasks WHERE grant_id = ? ORDER BY due_date ASC`)
      .all(grantId)
      .map((r) => rowToTask(r as Row));
  }

  listForOrg(orgId: string): TaskRecord[] {
    return this.db
      .prepare(`SELECT * FROM compliance_tasks WHERE org_id = ? ORDER BY due_date ASC`)
      .all(orgId)
      .map((r) => rowToTask(r as Row));
  }
}
