import { createHash } from "node:crypto";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProviderAnalysisPayloadV1 } from "@/server/ai/fascicoloAnalysis";
import { FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloAutomaticContracts";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import type { ResearchMission } from "@/server/legal-research/bridge";

const provenanceSchema = z.array(z.object({
  reference: z.string().regex(/^DOCUMENT_[1-9][0-9]*\.PAGE_[1-9][0-9]*$/),
  documentVersionId: z.string().trim().min(1).max(256),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pageNumber: z.number().int().positive(),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractionMethod: z.string().trim().min(1).max(64),
  ocrConfidence: z.number().min(0).max(1).nullable(),
}).strict()).min(1).max(10_000);

const corpusDocumentSchema = z.object({
  documentVersionId: z.string().trim().min(1).max(256),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface AutomaticFascicoloReportPersistenceInput {
  readonly reportId: string;
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly neutralIntakeId: string;
  readonly documentVersionId: string;
  readonly artifactSha256: string;
  readonly corpusFingerprint: string;
  readonly documents: readonly z.output<typeof corpusDocumentSchema>[];
  readonly actorId: string;
  readonly analysis: ProviderAnalysisPayloadV1;
  readonly provenance: ReadonlyArray<z.output<typeof provenanceSchema>[number]>;
  readonly missions: readonly ResearchMission[];
}

export interface AutomaticFascicoloReportReference {
  readonly reportId: string;
  readonly documentVersionId: string;
  readonly corpusFingerprint: string;
  readonly missionCount: number;
  readonly supersededCount: number;
}

export class AutomaticFascicoloReportRepositoryError extends Error {
  constructor(readonly code:
    | "INVALID_INPUT"
    | "AUTHORITY_MISMATCH"
    | "MISSION_SCOPE_MISMATCH"
    | "IDEMPOTENCY_CONFLICT") {
    super(code);
    this.name = "AutomaticFascicoloReportRepositoryError";
  }
}

type RepositoryClient = Pick<Prisma.TransactionClient,
  | "procedimento"
  | "neutralIntakeExtractionAttempt"
  | "researchMissionRecord"
  | "automaticFascicoloReport"
  | "automaticFascicoloReportMission"
  | "automaticFascicoloReportDocument"
>;

interface RepositoryContext {
  readonly read: RepositoryClient;
  readonly transaction: <T>(callback: (tx: RepositoryClient) => Promise<T>) => Promise<T>;
}

const defaultContext: RepositoryContext = {
  read: prisma,
  transaction: (callback) => runSerializableTransactionWithRetry(callback),
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fingerprint(input: AutomaticFascicoloReportPersistenceInput): string {
  return createHash("sha256").update(stableStringify({
    contractVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    neutralIntakeId: input.neutralIntakeId,
    documentVersionId: input.documentVersionId,
    artifactSha256: input.artifactSha256,
    corpusFingerprint: input.corpusFingerprint,
    documents: input.documents,
    analysis: input.analysis,
    provenance: input.provenance,
    missionIds: input.missions.map((mission) => mission.missionId),
  }), "utf8").digest("hex");
}

function assertBasicInput(input: AutomaticFascicoloReportPersistenceInput): void {
  const missionIds = input.missions.map((mission) => mission.missionId);
  if (!input.reportId.trim() || input.reportId.length > 96
    || !input.tenantId.trim() || !input.procedimentoId.trim()
    || !input.neutralIntakeId.trim() || !input.documentVersionId.trim()
    || !input.actorId.trim() || !/^[a-f0-9]{64}$/.test(input.artifactSha256)
    || !/^[a-f0-9]{64}$/.test(input.corpusFingerprint)
    || input.documents.length === 0
    || !input.documents.every((document) => corpusDocumentSchema.safeParse(document).success)
    || new Set(input.documents.map((document) => document.documentVersionId)).size !== input.documents.length
    || new Set(missionIds).size !== missionIds.length
    || !provenanceSchema.safeParse(input.provenance).success) {
    throw new AutomaticFascicoloReportRepositoryError("INVALID_INPUT");
  }
}

async function assertAuthority(tx: RepositoryClient, input: AutomaticFascicoloReportPersistenceInput): Promise<void> {
  const [procedure, attempts, missionCount] = await Promise.all([
    tx.procedimento.findUnique({
      where: { id: input.procedimentoId },
      select: { concessione: { select: { enteId: true } } },
    }),
    tx.neutralIntakeExtractionAttempt.findMany({
      where: { id: { in: input.documents.map((document) => document.documentVersionId) } },
      select: {
        id: true,
        neutralIntakeId: true,
        artifactSha256: true,
        outcome: true,
        neutralIntake: {
          select: {
            enteId: true,
            destination: { select: { procedimentoId: true } },
          },
        },
      },
    }),
    tx.researchMissionRecord.count({
      where: {
        id: { in: input.missions.map((mission) => mission.missionId) },
        tenantId: input.tenantId,
        caseId: input.procedimentoId,
      },
    }),
  ]);
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const corpusMatches = input.documents.every((document) => {
    const attempt = attemptsById.get(document.documentVersionId);
    return attempt?.neutralIntake.enteId === input.tenantId
      && attempt.neutralIntake.destination?.procedimentoId === input.procedimentoId
      && attempt.artifactSha256 === document.artifactSha256
      && attempt.outcome === "SUCCEEDED";
  });
  const trigger = attemptsById.get(input.documentVersionId);
  if (procedure?.concessione.enteId !== input.tenantId
    || attempts.length !== input.documents.length
    || !corpusMatches
    || trigger?.neutralIntakeId !== input.neutralIntakeId
    || trigger.artifactSha256 !== input.artifactSha256) {
    throw new AutomaticFascicoloReportRepositoryError("AUTHORITY_MISMATCH");
  }
  if (missionCount !== input.missions.length) {
    throw new AutomaticFascicoloReportRepositoryError("MISSION_SCOPE_MISMATCH");
  }
}

export async function findAutomaticFascicoloReportByVersion(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
}, overrides: Partial<RepositoryContext> = {}): Promise<AutomaticFascicoloReportReference | null> {
  const ctx = { ...defaultContext, ...overrides };
  const report = await ctx.read.automaticFascicoloReport.findUnique({
    where: {
      tenantId_procedimentoId_corpusFingerprint_contractVersion: {
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        corpusFingerprint: input.corpusFingerprint,
        contractVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
      },
    },
    select: {
      id: true,
      documentVersionId: true,
      corpusFingerprint: true,
      _count: { select: { missionLinks: true, supersedes: true } },
    },
  });
  return report ? {
    reportId: report.id,
    documentVersionId: report.documentVersionId,
    corpusFingerprint: report.corpusFingerprint,
    missionCount: report._count.missionLinks,
    supersededCount: report._count.supersedes,
  } : null;
}

export async function persistAutomaticFascicoloReport(
  input: AutomaticFascicoloReportPersistenceInput,
  overrides: Partial<RepositoryContext> = {},
): Promise<{ outcome: "CREATED" | "REUSED"; report: AutomaticFascicoloReportReference }> {
  assertBasicInput(input);
  const ctx = { ...defaultContext, ...overrides };
  const expectedFingerprint = fingerprint(input);
  return ctx.transaction(async (tx) => {
    await assertAuthority(tx, input);
    const existing = await tx.automaticFascicoloReport.findUnique({ where: { id: input.reportId } });
    if (existing && (existing.tenantId !== input.tenantId
      || existing.procedimentoId !== input.procedimentoId
      || existing.documentVersionId !== input.documentVersionId
      || existing.corpusFingerprint !== input.corpusFingerprint
      || existing.payloadFingerprint !== expectedFingerprint)) {
      throw new AutomaticFascicoloReportRepositoryError("IDEMPOTENCY_CONFLICT");
    }
    let outcome: "CREATED" | "REUSED" = existing ? "REUSED" : "CREATED";
    const report = existing ?? await tx.automaticFascicoloReport.upsert({
      where: {
        tenantId_procedimentoId_corpusFingerprint_contractVersion: {
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          corpusFingerprint: input.corpusFingerprint,
          contractVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
        },
      },
      update: {},
      create: {
        id: input.reportId,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        neutralIntakeId: input.neutralIntakeId,
        documentVersionId: input.documentVersionId,
        contractVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
        artifactSha256: input.artifactSha256,
        corpusFingerprint: input.corpusFingerprint,
        payloadFingerprint: expectedFingerprint,
        analysisPayload: json(input.analysis),
        provenancePayload: json(input.provenance),
        status: "ANALYSIS_COMPLETE",
        verificationStatus: "DISCOVERY_PENDING",
        createdByActorId: input.actorId,
      },
    });
    if (report.id !== input.reportId || report.payloadFingerprint !== expectedFingerprint) {
      throw new AutomaticFascicoloReportRepositoryError("IDEMPOTENCY_CONFLICT");
    }
    await tx.automaticFascicoloReportMission.createMany({
      data: input.missions.map((mission) => ({
        reportId: report.id,
        missionId: mission.missionId,
        purpose: "PRELIMINARY_DISCOVERY",
      })),
      skipDuplicates: true,
    });
    await tx.automaticFascicoloReportDocument.createMany({
      data: input.documents.map((document, ordinal) => ({
        reportId: report.id,
        documentVersionId: document.documentVersionId,
        artifactSha256: document.artifactSha256,
        ordinal,
      })),
      skipDuplicates: true,
    });
    const superseded = await tx.automaticFascicoloReport.updateMany({
      where: {
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        id: { not: report.id },
        supersededByReportId: null,
      },
      data: {
        status: "SUPERSEDED",
        verificationStatus: "SUPERSEDED",
        supersededByReportId: report.id,
      },
    });
    const missionCount = await tx.automaticFascicoloReportMission.count({
      where: { reportId: report.id },
    });
    const documentCount = await tx.automaticFascicoloReportDocument.count({
      where: { reportId: report.id },
    });
    if (missionCount !== input.missions.length || documentCount !== input.documents.length) {
      throw new AutomaticFascicoloReportRepositoryError("IDEMPOTENCY_CONFLICT");
    }
    if (existing) outcome = "REUSED";
    return {
      outcome,
      report: {
        reportId: report.id,
        documentVersionId: report.documentVersionId,
        corpusFingerprint: report.corpusFingerprint,
        missionCount,
        supersededCount: superseded.count,
      },
    };
  });
}