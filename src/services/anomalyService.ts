import type { AnomalyRepository } from "../repositories/anomalyRepository.js";
import type { GrantRepository } from "../repositories/grantRepository.js";
import type { EventRepository } from "../repositories/eventRepository.js";
import type { EvidenceRepository } from "../repositories/evidenceRepository.js";
import type { AnomalyEvent } from "../domain/schemas.js";
import type { AnomalyStatus } from "../domain/constants.js";
import { NotFoundError } from "./errors.js";
import { todayIso } from "../util/dates.js";
import {
  evaluateAnomalies,
  DEFAULT_ANOMALY_CONFIG,
  type AnomalyRuleConfig,
} from "./anomalyRules.js";

export interface ReviewContext {
  actorEmail: string;
  actorUserId?: string | null;
  note?: string | null;
}

/**
 * Rule-based anomaly detection + investigator workflow. Runs on demand (after a
 * grant update, or via an admin "recompute" action). Deduplicates: an open
 * anomaly for the same rule+grant is not re-created. Every flag and status
 * change is written to the grant's append-only audit trail.
 */
export class AnomalyService {
  constructor(
    private readonly anomalies: AnomalyRepository,
    private readonly grants: GrantRepository,
    private readonly events: EventRepository,
    private readonly evidence: EvidenceRepository,
    private readonly config: AnomalyRuleConfig = DEFAULT_ANOMALY_CONFIG,
  ) {}

  recomputeForGrant(grantId: string, asOf: string = todayIso()): AnomalyEvent[] {
    const grant = this.grants.findById(grantId);
    if (!grant) return [];
    const detections = evaluateAnomalies(
      {
        grant,
        events: this.events.listForGrant(grantId),
        noteEvidenceCount: this.evidence.countForGrantByType(grantId, "note"),
        asOf,
      },
      this.config,
    );
    const created: AnomalyEvent[] = [];
    for (const d of detections) {
      if (this.anomalies.openByRule(grantId, d.rule_name)) continue; // dedupe
      const anomaly = this.anomalies.insert({
        org_id: grant.org_id,
        grant_id: grantId,
        rule_name: d.rule_name,
        severity: d.severity,
        details: d.details,
        created_by: "system",
      });
      this.events.append({
        org_id: grant.org_id,
        grant_id: grantId,
        actor: "system",
        source: "system",
        event_type: "anomaly_flagged",
        field: "anomaly",
        new_value: d.rule_name,
        summary: `Anomaly flagged: ${d.rule_name} (${d.severity}) — ${d.details}`,
      });
      created.push(anomaly);
    }
    return created;
  }

  /** Recompute across the whole org (admin action). Returns count of new flags. */
  recomputeAll(orgId: string, asOf: string = todayIso()): number {
    let count = 0;
    for (const g of this.grants.listAll(orgId)) {
      count += this.recomputeForGrant(g.id, asOf).length;
    }
    return count;
  }

  updateStatus(id: string, status: AnomalyStatus, ctx: ReviewContext): AnomalyEvent {
    const anomaly = this.anomalies.findById(id);
    if (!anomaly) throw new NotFoundError("Anomaly not found");
    this.anomalies.updateStatus(id, status, {
      resolvedByUserId: ctx.actorUserId ?? null,
      note: ctx.note ?? null,
    });
    this.events.append({
      org_id: anomaly.org_id,
      grant_id: anomaly.grant_id,
      actor: ctx.actorEmail,
      source: "manual",
      event_type: "anomaly_reviewed",
      field: "anomaly_status",
      old_value: anomaly.status,
      new_value: status,
      summary: `Anomaly "${anomaly.rule_name}" marked ${status.replace("_", " ")}${ctx.note ? `: ${ctx.note}` : ""}.`,
    });
    return this.anomalies.findById(id)!;
  }

  listOpen(orgId: string): AnomalyEvent[] {
    return this.anomalies.listOpen(orgId);
  }

  listForGrant(grantId: string): AnomalyEvent[] {
    return this.anomalies.listForGrant(grantId);
  }

  /** Open (non-cleared) anomalies for a grant — for the detail-page summary. */
  openForGrant(grantId: string): AnomalyEvent[] {
    return this.anomalies.listForGrant(grantId).filter((a) => a.status !== "cleared");
  }
}
