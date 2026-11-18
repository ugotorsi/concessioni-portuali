import { stableActDraftKey, type ActDraft, type ActDraftStatus } from "./model";

export interface ActDraftGroupMember {
  readonly draftKey: string;
  readonly title: string;
  readonly status: ActDraftStatus;
  readonly version: number;
  readonly bodySha256: string;
  readonly recipient: string | null;
  readonly lastSavedAt: Date;
  /** Draft created with the deterministic key of the current idempotent model. */
  readonly stableIdentity: boolean;
  readonly linkedToActivity: boolean;
  /** Non-destructive suggestion; nothing is applied automatically. */
  readonly reconciliation: "KEEP_AS_REFERENCE" | "IDENTICAL_DUPLICATE" | "DIVERGENT_CONTENT";
}

export interface ActDraftGroup {
  readonly issueSemanticKey: string | null;
  readonly templateKey: string;
  readonly members: readonly ActDraftGroupMember[];
  readonly duplicated: boolean;
  readonly distinctContents: number;
  readonly reconciliationNote: string | null;
}

const STATUS_RANK: Record<ActDraftStatus, number> = { APPROVATA_INTERNAMENTE: 3, IN_REVISIONE: 2, BOZZA: 1, ARCHIVIATA: 0 };

/** Recipient only when the text states it explicitly; never inferred. */
export function actDraftRecipient(body: string): string | null {
  const explicit = body.match(/^\s*(?:Destinatari[oa]|Al(?:la)?\s+cortese\s+attenzione|Spett\.?\s*le|A:)\s*[:\-–]?\s*(.{3,160})$/im);
  const value = explicit?.[1]?.trim().replace(/[.;,]+$/, "");
  if (!value || /^\[.*\]$/.test(value)) return null;
  return value;
}

function lastSavedAt(draft: ActDraft): Date {
  return draft.history.reduce((latest, version) => version.savedAt > latest ? version.savedAt : latest, draft.current.savedAt);
}

/**
 * Groups drafts by issue and document type and flags historical duplicates (e.g. drafts created with random keys
 * before idempotent creation). The result is a read-only simulation: no draft, version or audit event is changed.
 */
export function groupActDraftsForReview(drafts: readonly ActDraft[], linkedDraftKeys: ReadonlySet<string> = new Set()): ActDraftGroup[] {
  const groups = new Map<string, ActDraft[]>();
  for (const draft of drafts) {
    const key = `${draft.current.issueSemanticKey ?? ""}\u0000${draft.current.templateKey}`;
    groups.set(key, [...(groups.get(key) ?? []), draft]);
  }
  return [...groups.values()].map((members) => {
    const { issueSemanticKey, templateKey } = members[0]!.current;
    const stableKey = stableActDraftKey(templateKey, issueSemanticKey);
    const ranked = [...members].sort((left, right) =>
      Number(right.draftKey === stableKey) - Number(left.draftKey === stableKey)
      || Number(linkedDraftKeys.has(right.draftKey)) - Number(linkedDraftKeys.has(left.draftKey))
      || STATUS_RANK[right.current.status] - STATUS_RANK[left.current.status]
      || right.current.version - left.current.version
      || lastSavedAt(right).getTime() - lastSavedAt(left).getTime()
      || left.draftKey.localeCompare(right.draftKey));
    const reference = ranked[0]!;
    const duplicated = ranked.length > 1;
    const result: ActDraftGroupMember[] = ranked.map((draft) => ({
      draftKey: draft.draftKey,
      title: draft.current.title,
      status: draft.current.status,
      version: draft.current.version,
      bodySha256: draft.current.bodySha256,
      recipient: actDraftRecipient(draft.current.body),
      lastSavedAt: lastSavedAt(draft),
      stableIdentity: draft.draftKey === stableKey,
      linkedToActivity: linkedDraftKeys.has(draft.draftKey),
      reconciliation: draft === reference
        ? "KEEP_AS_REFERENCE"
        : draft.current.bodySha256 === reference.current.bodySha256 ? "IDENTICAL_DUPLICATE" : "DIVERGENT_CONTENT",
    }));
    const distinctContents = new Set(ranked.map((draft) => draft.current.bodySha256)).size;
    const identical = result.filter((member) => member.reconciliation === "IDENTICAL_DUPLICATE").length;
    const divergent = result.filter((member) => member.reconciliation === "DIVERGENT_CONTENT").length;
    return {
      issueSemanticKey,
      templateKey,
      members: result,
      duplicated,
      distinctContents,
      reconciliationNote: duplicated
        ? [
          `${ranked.length} bozze per lo stesso documento della stessa problematica, con ${distinctContents} ${distinctContents === 1 ? "contenuto" : "contenuti"} ${distinctContents === 1 ? "identico" : "distinti"}.`,
          `Proposta non applicata: mantenere come riferimento «${reference.current.title}» (versione ${reference.current.version})`,
          identical ? `; ${identical} ${identical === 1 ? "copia identica può essere archiviata" : "copie identiche possono essere archiviate"}` : "",
          divergent ? `; ${divergent} ${divergent === 1 ? "bozza con contenuto diverso va confrontata" : "bozze con contenuto diverso vanno confrontate"} e le eventuali differenze utili riportate come nuova versione della bozza di riferimento` : "",
          ". Nessuna bozza, versione o evento di audit viene eliminato; l'archiviazione richiede autorizzazione.",
        ].join("")
        : null,
    };
  });
}
