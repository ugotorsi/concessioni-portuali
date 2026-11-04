import { createHash } from "node:crypto";

import { z } from "zod";

import type { ProfessionalReportDocument } from "@/server/fascicolo-report/professional-export";

export const ACT_DRAFT_SCHEMA_VERSION = "FASCICOLO_ACT_DRAFT_V1" as const;
export const ACT_DRAFT_ENTITY = "FascicoloActDraft" as const;
export const ACT_DRAFT_AUDIT_ACTION = "FASCICOLO_ACT_DRAFT_VERSION_SAVED" as const;
export const ACT_DRAFT_LOCK_NAMESPACE = "fascicolo-act-draft:v1" as const;

export const ACT_DRAFT_STATUSES = ["BOZZA", "IN_REVISIONE", "APPROVATA_INTERNAMENTE", "ARCHIVIATA"] as const;
export type ActDraftStatus = (typeof ACT_DRAFT_STATUSES)[number];

export const ACT_DRAFT_STATUS_LABELS: Record<ActDraftStatus, string> = {
  BOZZA: "Bozza",
  IN_REVISIONE: "In revisione",
  APPROVATA_INTERNAMENTE: "Approvata internamente",
  ARCHIVIATA: "Archiviata",
};

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data non valida");

export const actDraftContentSchema = z.object({
  templateKey: z.string().trim().min(1).max(160),
  issueSemanticKey: z.string().trim().max(256).nullable(),
  title: z.string().trim().min(3).max(300),
  body: z.string().trim().min(1).max(100_000),
  status: z.enum(ACT_DRAFT_STATUSES),
  assignee: z.string().trim().max(200).nullable(),
  dueDate: isoDay.nullable(),
  progress: z.number().int().min(0).max(100),
  dependencies: z.array(z.string().trim().min(1).max(64)).max(20),
  attachments: z.array(z.string().trim().min(1).max(256)).max(50),
  changeNote: z.string().trim().max(2_000).nullable(),
}).strict();

export type ActDraftContent = z.infer<typeof actDraftContentSchema>;

export const actDraftVersionMetadataSchema = actDraftContentSchema.extend({
  schema: z.literal(ACT_DRAFT_SCHEMA_VERSION),
  procedimentoId: z.string().min(1),
  draftKey: z.string().min(1).max(64),
  version: z.number().int().positive(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type ActDraftVersionMetadata = z.infer<typeof actDraftVersionMetadataSchema>;

export interface ActDraftVersion extends ActDraftVersionMetadata {
  savedAt: Date;
  savedBy: string | null;
  auditHash: string;
}

export interface ActDraft {
  draftKey: string;
  current: ActDraftVersion;
  history: readonly ActDraftVersion[];
  openDependencies: readonly string[];
}

export function actDraftMatchesTemplate(
  draft: ActDraft,
  input: { templateKey: string; issueSemanticKey: string | null; legacyTemplateKey?: string; legacyTemplateKeys?: readonly string[] },
): boolean {
  const keys = new Set([input.templateKey, ...(input.legacyTemplateKeys ?? []), ...(input.legacyTemplateKey ? [input.legacyTemplateKey] : [])]);
  return draft.current.issueSemanticKey === input.issueSemanticKey
    && keys.has(draft.current.templateKey);
}

export function actDraftEntityId(procedimentoId: string, draftKey: string): string {
  return `${procedimentoId}::${draftKey}`;
}

export function stableActDraftKey(
  templateKey: string,
  issueSemanticKey: string | null,
): string {
  const identity = `${issueSemanticKey ?? "unassigned"}\u0000${templateKey}\u0000default`;
  return `act_${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24)}`;
}

export function bodySha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function normalizeActDraftContent(content: ActDraftContent, ownDraftKey: string | null): ActDraftContent {
  const parsed = actDraftContentSchema.parse(content);
  return {
    ...parsed,
    assignee: parsed.assignee || null,
    changeNote: parsed.changeNote || null,
    progress: parsed.status === "APPROVATA_INTERNAMENTE" ? 100 : parsed.progress,
    dependencies: [...new Set(parsed.dependencies)].filter((key) => key !== ownDraftKey).sort(),
    attachments: [...new Set(parsed.attachments)].sort(),
  };
}

export function projectActDrafts(versions: readonly ActDraftVersion[]): ActDraft[] {
  const byDraft = new Map<string, ActDraftVersion[]>();
  for (const version of versions) {
    const list = byDraft.get(version.draftKey) ?? [];
    if (list.some((existing) => existing.version === version.version)) {
      throw new Error("La cronologia della bozza contiene versioni duplicate.");
    }
    list.push(version);
    byDraft.set(version.draftKey, list);
  }
  const drafts = [...byDraft.entries()].map(([draftKey, list]) => {
    const history = [...list].sort((left, right) => right.version - left.version);
    if (history.some((version, index) => version.version !== history.length - index)) {
      throw new Error("La cronologia della bozza non è continua.");
    }
    return { draftKey, current: history[0], history };
  });
  const statusByKey = new Map(drafts.map((draft) => [draft.draftKey, draft.current.status]));
  return drafts
    .map((draft) => ({
      ...draft,
      openDependencies: draft.current.dependencies.filter((key) => statusByKey.get(key) !== "APPROVATA_INTERNAMENTE"),
    }))
    .sort((left, right) => {
      const leftArchived = left.current.status === "ARCHIVIATA" ? 1 : 0;
      const rightArchived = right.current.status === "ARCHIVIATA" ? 1 : 0;
      if (leftArchived !== rightArchived) return leftArchived - rightArchived;
      const leftDue = left.current.dueDate ?? "9999-12-31";
      const rightDue = right.current.dueDate ?? "9999-12-31";
      return leftDue.localeCompare(rightDue) || left.current.title.localeCompare(right.current.title, "it");
    });
}

const FIELD_LABELS: Record<keyof ActDraftContent, string> = {
  templateKey: "modello",
  issueSemanticKey: "criticità",
  title: "titolo",
  body: "testo",
  status: "stato",
  assignee: "assegnatario",
  dueDate: "scadenza",
  progress: "avanzamento",
  dependencies: "dipendenze",
  attachments: "allegati",
  changeNote: "nota",
};

export function changedActDraftFields(previous: ActDraftContent | null, next: ActDraftContent): string[] {
  if (!previous) return ["prima versione"];
  return (Object.keys(FIELD_LABELS) as Array<keyof ActDraftContent>)
    .filter((key) => key !== "changeNote")
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .map((key) => FIELD_LABELS[key]);
}

export function buildActExportDocument(input: {
  version: ActDraftVersion;
  procedimentoLabel: string;
  attachmentNames: ReadonlyMap<string, string>;
  dependencyTitles: ReadonlyMap<string, string>;
}): ProfessionalReportDocument {
  const { version } = input;
  const paragraphs = version.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const management = [
    `Stato: ${ACT_DRAFT_STATUS_LABELS[version.status]} – versione ${version.version} del ${version.savedAt.toLocaleDateString("it-IT")}.`,
    version.assignee ? `Assegnatario: ${version.assignee}.` : "Assegnatario: da individuare.",
    version.dueDate ? `Scadenza interna: ${new Date(`${version.dueDate}T00:00:00.000Z`).toLocaleDateString("it-IT", { timeZone: "UTC" })}.` : "Scadenza interna: non fissata.",
    `Avanzamento: ${version.progress}%.`,
    ...(version.dependencies.length
      ? [`Atti presupposti: ${version.dependencies.map((key) => input.dependencyTitles.get(key) ?? "atto non più disponibile").join("; ")}.`]
      : []),
    ...(version.attachments.length
      ? [`Allegati: ${version.attachments.map((id) => input.attachmentNames.get(id) ?? "documento non più disponibile").join("; ")}.`]
      : []),
    `Impronta del testo (SHA-256): ${version.bodySha256}.`,
  ];
  return {
    title: version.title,
    subtitle: `${input.procedimentoLabel} – facsimile non firmato, non protocollato e non inviato`,
    generatedAt: version.savedAt,
    sections: [
      { title: "Testo dell'atto", paragraphs },
      { title: "Gestione interna", paragraphs: management },
    ],
  };
}

export function buildActFileName(draftKey: string, version: number, extension: "pdf" | "rtf"): string {
  const safeKey = draftKey.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  return `atto-${safeKey}-v${version}.${extension}`;
}
