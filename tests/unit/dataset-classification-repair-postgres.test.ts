import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { buildDatasetDocumentoWhere, buildDatasetProcedimentoWhere } from "@/lib/dataset-visibility";
import { prisma } from "@/lib/prisma";
import {
  DATASET_CLASSIFICATION_REPAIR_ACTION,
  previewDatasetClassificationRepair,
  repairDatasetClassification,
} from "@/server/dataset-classification/repair";

const databaseUrl = process.env.NOETRA_GUIDED_E2E_PG_URL;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!databaseUrl)("dataset classification repair on isolated PostgreSQL", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let prismaConfigured = false;

  afterAll(async () => {
    if (prismaConfigured) await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("moves only dataset roots and preserves linked corpus, jobs, reports, and audit history", async () => {
    if (!databaseUrl) throw new Error("A dedicated database URL is required.");
    const url = new URL(databaseUrl);
    if (
      url.protocol !== "postgresql:"
      || url.hostname !== "127.0.0.1"
      || url.port !== "55432"
      || url.username !== "noetra_test"
      || url.pathname !== "/noetra_test_workflow"
      || process.env.NOETRA_GUIDED_E2E !== "1"
      || process.env.AI_REAL_DATA_ENABLED !== "false"
      || process.env.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
      || process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED !== "false"
    ) {
      throw new Error("Refusing dataset repair outside the dedicated local test database.");
    }
    process.env.DATABASE_URL = databaseUrl;
    prismaConfigured = true;

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.local" },
      select: { id: true, email: true },
    });
    const suffix = randomUUID();
    const tenantId = `dataset-repair-tenant-${suffix}`;
    const procedimentoId = `dataset-repair-procedure-${suffix}`;
    const intakeId = `dataset-repair-intake-${suffix}`;
    const documentId = `dataset-repair-document-${suffix}`;
    const revisionId = `dataset-repair-revision-${suffix}`;
    const reportId = `dataset-repair-report-${suffix}`;
    const jobId = `dataset-repair-job-${suffix}`;
    await prisma.ente.create({
      data: {
        id: tenantId,
        codice: `DEMO-REPAIR-${suffix}`,
        nome: "Tenant sintetico di verifica",
      },
    });
    await prisma.procedimento.create({
      data: {
        id: procedimentoId,
        enteId: tenantId,
        datasetClass: "PROFESSIONAL",
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
    });
    await prisma.fascicoloIntake.create({
      data: {
        id: intakeId,
        enteId: tenantId,
        procedimentoId,
        datasetClass: "PROFESSIONAL",
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "Fascicolo sintetico preesistente",
      },
    });
    await prisma.documento.create({
      data: {
        id: documentId,
        nome: "documento-sintetico.pdf",
        tipologia: "NOTA",
        enteId: tenantId,
        procedimentoId,
      },
    });
    await prisma.fascicoloKnowledgeRevision.create({
      data: {
        id: revisionId,
        tenantId,
        procedimentoId,
        corpusFingerprint: sha(`corpus-${suffix}`),
        contractVersion: "TEST",
        status: "CURRENT",
        completedAt: new Date(),
      },
    });
    await prisma.structuredFascicoloReportSnapshot.create({
      data: {
        id: reportId,
        tenantId,
        procedimentoId,
        knowledgeRevisionId: revisionId,
        contractVersion: "TEST",
        reportFingerprint: sha(`report-${suffix}`),
        corpusFingerprint: sha(`corpus-${suffix}`),
        researchStateFingerprint: sha(`research-${suffix}`),
        sourceStateFingerprint: sha(`source-${suffix}`),
        payload: { synthetic: true },
      },
    });
    await prisma.asyncJob.create({
      data: {
        id: jobId,
        idempotencyKey: sha(`idempotency-${suffix}`),
        requestFingerprint: sha(`request-${suffix}`),
        operation: "TEST",
        logicalOperationId: `dataset-repair-${suffix}`,
        purpose: "Verify dataset repair preservation",
        correlationId: suffix,
        inputReference: { synthetic: true },
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId,
        procedimentoId,
        actorId: admin.id,
        actorEmail: admin.email,
        actorRole: "ADMIN",
        status: "SUCCEEDED",
        maxAttempts: 1,
        attemptCount: 1,
        availableAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const preview = await previewDatasetClassificationRepair(procedimentoId);
    expect(preview).toMatchObject({
      targetClass: "DEMO",
      targetScope: "SYNTHETIC",
    });
    expect(preview.changes).toHaveLength(2);

    const result = await repairDatasetClassification({
      procedimentoId,
      expectedFingerprint: preview.fingerprint,
      reason: "Il tenant e il fascicolo sono sintetici e devono essere riallineati.",
      actor: { id: admin.id, email: admin.email, role: "ADMIN" },
    });
    expect(result).toMatchObject({ targetClass: "DEMO", changedRootCount: 2 });

    const [procedimento, intake, document, revision, report, job, audit] =
      await Promise.all([
        prisma.procedimento.findUniqueOrThrow({ where: { id: procedimentoId } }),
        prisma.fascicoloIntake.findUniqueOrThrow({ where: { id: intakeId } }),
        prisma.documento.findUniqueOrThrow({ where: { id: documentId } }),
        prisma.fascicoloKnowledgeRevision.findUniqueOrThrow({ where: { id: revisionId } }),
        prisma.structuredFascicoloReportSnapshot.findUniqueOrThrow({ where: { id: reportId } }),
        prisma.asyncJob.findUniqueOrThrow({ where: { id: jobId } }),
        prisma.activityLog.findFirstOrThrow({
          where: {
            azione: DATASET_CLASSIFICATION_REPAIR_ACTION,
            entitaId: procedimentoId,
          },
        }),
      ]);
    expect(procedimento.datasetClass).toBe("DEMO");
    expect(intake.datasetClass).toBe("DEMO");
    expect(document).toMatchObject({ enteId: tenantId, procedimentoId });
    expect(revision).toMatchObject({ tenantId, procedimentoId });
    expect(report).toMatchObject({ tenantId, procedimentoId, knowledgeRevisionId: revisionId });
    expect(job).toMatchObject({ tenantId, procedimentoId, status: "SUCCEEDED" });
    expect(audit).toMatchObject({
      userId: admin.id,
      userRole: "ADMIN",
      enteId: tenantId,
      esito: "SUCCESS",
      metadata: expect.objectContaining({
        targetClass: "DEMO",
        preservedChildren: true,
        providerCalled: false,
        workerActivated: false,
      }),
    });

    await expect(repairDatasetClassification({
      procedimentoId,
      expectedFingerprint: preview.fingerprint,
      reason: "Questo comando usa intenzionalmente uno snapshot ormai superato.",
      actor: { id: admin.id, email: admin.email, role: "ADMIN" },
    })).rejects.toThrow("DATASET_CLASSIFICATION_FINGERPRINT_MISMATCH");
    expect(await prisma.activityLog.count({
      where: {
        azione: DATASET_CLASSIFICATION_REPAIR_ACTION,
        entitaId: procedimentoId,
      },
    })).toBe(1);
    expect(await prisma.procedimento.count({
      where: { id: procedimentoId, ...buildDatasetProcedimentoWhere("PROFESSIONAL") },
    })).toBe(0);
    expect(await prisma.procedimento.count({
      where: { id: procedimentoId, ...buildDatasetProcedimentoWhere("SYNTHETIC") },
    })).toBe(1);
    expect(await prisma.documento.count({
      where: { id: documentId, ...buildDatasetDocumentoWhere("PROFESSIONAL") },
    })).toBe(0);
    expect(await prisma.documento.count({
      where: { id: documentId, ...buildDatasetDocumentoWhere("SYNTHETIC") },
    })).toBe(1);
  }, 30_000);
});
