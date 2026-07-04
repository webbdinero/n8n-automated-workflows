import type { EvidenceRepository } from "../repositories/evidenceRepository.js";
import type { EventRepository } from "../repositories/eventRepository.js";
import type { EvidenceInput, EvidenceItem } from "../domain/schemas.js";

export interface EvidenceActor {
  email: string;
  userId?: string | null;
}

/** Short, human-readable description of an evidence item for lists/audits. */
export function describeEvidence(item: Pick<EvidenceItem, "type" | "filename" | "url" | "note">): string {
  if (item.type === "attachment") return item.filename ?? "(file)";
  if (item.type === "link") return item.url ?? "(link)";
  const note = item.note ?? "";
  return note.length > 80 ? `${note.slice(0, 80)}…` : note || "(note)";
}

/**
 * Evidence management for grants. Every add is append-only and writes an audit
 * event so the chain of custody is attributable (who / when / what).
 */
export class EvidenceService {
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly events: EventRepository,
  ) {}

  addEvidence(
    orgId: string,
    grantId: string,
    input: EvidenceInput,
    actor: EvidenceActor,
  ): EvidenceItem {
    const item = this.evidence.insert({
      org_id: orgId,
      grant_id: grantId,
      type: input.type,
      filename: input.filename ?? null,
      url: input.url ?? null,
      note: input.note ?? null,
      content_hash: input.content_hash ?? null,
      created_by_user_id: actor.userId ?? null,
      created_by_email: actor.email,
    });
    this.events.append({
      org_id: orgId,
      grant_id: grantId,
      actor: actor.email,
      source: "manual",
      event_type: "evidence_added",
      field: "evidence",
      new_value: item.type,
      summary: `Evidence added (${item.type}): ${describeEvidence(item)}`,
    });
    return item;
  }

  listForGrant(grantId: string): EvidenceItem[] {
    return this.evidence.listForGrant(grantId);
  }
}
