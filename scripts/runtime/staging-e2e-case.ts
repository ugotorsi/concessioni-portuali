import { pathToFileURL } from "node:url";

import { prisma } from "../../src/lib/prisma";
import { createAuditLogInTransaction } from "../../src/server/audit/auditLog";

export const STAGING_E2E_CASE = Object.freeze({
  projectId: "aged-smoke-22484639",
  branchId: "br-frosty-moon-atdf29s8",
  endpointId: "ep-jolly-hall-atts00ke",
  tenantCode: "DEMO-COMUNE-COSTIERO",
  concessionarioId: "staging-e2e-test-001-concessionario",
  concessionarioName: "E2E TEST SOGGETTO",
  concessioneId: "staging-e2e-test-001-concessione",
  numeroAtto: "E2E-TEST-001",
  procedimentoId: "staging-e2e-test-001-procedimento",
  protectedMissionId: "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63",
  protectedCaseId: "ACCEPTANCE_TEST_LEGAL_RESEARCH_V1",
});

type ScriptMode = "create" | "cleanup";

export function parseStagingE2eCaseMode(argv: readonly string[]): ScriptMode {
  if (argv.length === 0) return "create";
  if (argv.length === 1 && argv[0] === "--cleanup") return "cleanup";
  throw new Error("Usage: tsx scripts/runtime/staging-e2e-case.ts [--cleanup]");
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function assertStagingE2eCaseEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.ALLOW_STAGING_E2E_CASE_CREATION !== "true") {
    throw new Error("ALLOW_STAGING_E2E_CASE_CREATION_REQUIRED");
  }
  if (requiredEnvironment(environment, "NEON_PROJECT_ID") !== STAGING_E2E_CASE.projectId) {
    throw new Error("STAGING_E2E_PROJECT_MISMATCH");
  }
  if (requiredEnvironment(environment, "NEON_BRANCH_ID") !== STAGING_E2E_CASE.branchId) {
    throw new Error("STAGING_E2E_BRANCH_MISMATCH");
  }

  const databaseUrl = new URL(requiredEnvironment(environment, "DATABASE_URL"));
  if (
    databaseUrl.protocol !== "postgresql:"
    || !databaseUrl.hostname.startsWith(STAGING_E2E_CASE.endpointId)
    || databaseUrl.pathname.replace(/^\//, "") !== "neondb"
  ) {
    throw new Error("STAGING_E2E_DATABASE_MISMATCH");
  }
}

async function assertProtectedMissionIsolation(): Promise<{ protectedTenantId: string }> {
  const procedimentoId: string = STAGING_E2E_CASE.procedimentoId;
  const protectedMission = await prisma.researchMissionRecord.findUnique({
    where: { id: STAGING_E2E_CASE.protectedMissionId },
    select: { caseId: true, tenantId: true },
  });
  if (
    !protectedMission
    || protectedMission.caseId !== STAGING_E2E_CASE.protectedCaseId
    || !protectedMission.tenantId
  ) {
    throw new Error("PROTECTED_RESEARCH_MISSION_INVARIANT_FAILED");
  }
  if (procedimentoId === protectedMission.caseId) {
    throw new Error("STAGING_E2E_PROTECTED_CASE_COLLISION");
  }
  const linkedMission = await prisma.researchMissionRecord.findFirst({
    where: { caseId: procedimentoId },
    select: { id: true },
  });
  if (linkedMission) throw new Error("STAGING_E2E_RESEARCH_MISSION_LINK_DETECTED");
  return { protectedTenantId: protectedMission.tenantId };
}

async function createCase(): Promise<Readonly<Record<string, unknown>>> {
  const { protectedTenantId } = await assertProtectedMissionIsolation();
  const tenant = await prisma.ente.findUnique({
    where: { codice: STAGING_E2E_CASE.tenantCode },
    select: { id: true, codice: true },
  });
  if (!tenant || tenant.id === protectedTenantId) {
    throw new Error("STAGING_E2E_SAFE_TENANT_NOT_AVAILABLE");
  }

  return prisma.$transaction(async (tx) => {
    const concessionari = await tx.concessionario.findMany({
      where: {
        OR: [
          { id: STAGING_E2E_CASE.concessionarioId },
          { denominazione: STAGING_E2E_CASE.concessionarioName },
        ],
      },
      select: { id: true, denominazione: true },
    });
    if (
      concessionari.length > 1
      || concessionari.some((record) =>
        record.id !== STAGING_E2E_CASE.concessionarioId
        || record.denominazione !== STAGING_E2E_CASE.concessionarioName)
    ) {
      throw new Error("STAGING_E2E_CONCESSIONARIO_COLLISION");
    }
    const concessionario = concessionari[0] ?? await tx.concessionario.create({
      data: {
        id: STAGING_E2E_CASE.concessionarioId,
        denominazione: STAGING_E2E_CASE.concessionarioName,
        note: "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI",
      },
      select: { id: true, denominazione: true },
    });

    const concessioni = await tx.concessione.findMany({
      where: {
        OR: [
          { id: STAGING_E2E_CASE.concessioneId },
          { numeroAtto: STAGING_E2E_CASE.numeroAtto },
        ],
      },
      select: {
        id: true,
        numeroAtto: true,
        concessionarioId: true,
        enteId: true,
      },
    });
    if (
      concessioni.length > 1
      || concessioni.some((record) =>
        record.id !== STAGING_E2E_CASE.concessioneId
        || record.numeroAtto !== STAGING_E2E_CASE.numeroAtto
        || record.concessionarioId !== concessionario.id
        || record.enteId !== tenant.id)
    ) {
      throw new Error("STAGING_E2E_CONCESSIONE_COLLISION");
    }
    const concessione = concessioni[0] ?? await tx.concessione.create({
      data: {
        id: STAGING_E2E_CASE.concessioneId,
        numeroAtto: STAGING_E2E_CASE.numeroAtto,
        dataRilascio: new Date("2024-01-15T00:00:00.000Z"),
        dataScadenza: new Date("2026-09-30T00:00:00.000Z"),
        normaRiferimento: "ALTRO",
        tipologiaBene: "AREA_SCOPERTA",
        attivita: "ALTRO",
        concessionVertical: "PORTUALE_ADSP",
        stato: "ATTIVA",
        descrizioneBene: "Area portuale sintetica E2E-TEST-001",
        ubicazione: "Porto Test",
        note: "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI",
        concessionarioId: concessionario.id,
        enteId: tenant.id,
      },
      select: { id: true, numeroAtto: true, concessionarioId: true, enteId: true },
    });

    const procedures = await tx.procedimento.findMany({
      where: {
        OR: [
          { id: STAGING_E2E_CASE.procedimentoId },
          { concessioneId: concessione.id },
        ],
      },
      select: { id: true, concessioneId: true, noteIstruttorie: true },
    });
    if (
      procedures.length > 1
      || procedures.some((record) =>
        record.id !== STAGING_E2E_CASE.procedimentoId
        || record.concessioneId !== concessione.id
        || record.noteIstruttorie !== "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI")
    ) {
      throw new Error("STAGING_E2E_PROCEDIMENTO_COLLISION");
    }
    const procedimento = procedures[0] ?? await tx.procedimento.create({
      data: {
        id: STAGING_E2E_CASE.procedimentoId,
        concessioneId: concessione.id,
        tipologia: "ALTRO",
        origineProcedimento: "UFFICIO",
        procedimentoUfficio: true,
        riferimentoNormativo: "TEST SINTETICO - NESSUN EFFETTO GIURIDICO",
        dataAvvio: new Date("2026-09-23T00:00:00.000Z"),
        stato: "DA_AVVIARE",
        noteIstruttorie: "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI",
      },
      select: { id: true, concessioneId: true },
    });

    await createAuditLogInTransaction(tx, {
      azione: procedures.length === 0 ? "STAGING_E2E_CASE_CREATED" : "STAGING_E2E_CASE_REUSED",
      entita: "Procedimento",
      entitaId: procedimento.id,
      enteId: tenant.id,
      concessioneId: concessione.id,
      esito: "SUCCESS",
      actor: { userId: null, userEmail: null, userRole: "SYSTEM" },
      requestContext: { ipAddress: null, userAgent: "staging-e2e-case-cli" },
      metadata: {
        caseCode: STAGING_E2E_CASE.numeroAtto,
        tenantCode: tenant.codice,
        syntheticDataOnly: true,
      },
    });

    return {
      outcome: procedures.length === 0 ? "CREATED" : "REUSED",
      procedimentoId: procedimento.id,
      tenantId: tenant.id,
      tenantCode: tenant.codice,
    };
  });
}

async function cleanupCase(): Promise<Readonly<Record<string, unknown>>> {
  await assertProtectedMissionIsolation();
  return prisma.$transaction(async (tx) => {
    const procedimento = await tx.procedimento.findUnique({
      where: { id: STAGING_E2E_CASE.procedimentoId },
      select: {
        id: true,
        concessioneId: true,
        noteIstruttorie: true,
        concessione: {
          select: {
            id: true,
            numeroAtto: true,
            concessionarioId: true,
            enteId: true,
            note: true,
            ente: { select: { codice: true } },
          },
        },
      },
    });
    if (!procedimento) return { outcome: "NOT_FOUND" };
    if (
      procedimento.concessioneId !== STAGING_E2E_CASE.concessioneId
      || procedimento.noteIstruttorie !== "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI"
      || procedimento.concessione.id !== STAGING_E2E_CASE.concessioneId
      || procedimento.concessione.numeroAtto !== STAGING_E2E_CASE.numeroAtto
      || procedimento.concessione.concessionarioId !== STAGING_E2E_CASE.concessionarioId
      || procedimento.concessione.note !== "STAGING ONLY - E2E-TEST-001 - DATI SINTETICI"
      || procedimento.concessione.ente?.codice !== STAGING_E2E_CASE.tenantCode
    ) {
      throw new Error("STAGING_E2E_CLEANUP_SCOPE_MISMATCH");
    }

    const [
      documents,
      jobs,
      revisions,
      reports,
      proposals,
      missions,
      otherConcessions,
    ] = await Promise.all([
      tx.documento.count({ where: { procedimentoId: procedimento.id } }),
      tx.asyncJob.count({ where: { procedimentoId: procedimento.id } }),
      tx.fascicoloKnowledgeRevision.count({ where: { procedimentoId: procedimento.id } }),
      tx.structuredFascicoloReportSnapshot.count({ where: { procedimentoId: procedimento.id } }),
      tx.fascicoloOperationalProposal.count({ where: { procedimentoId: procedimento.id } }),
      tx.researchMissionRecord.count({ where: { caseId: procedimento.id } }),
      tx.concessione.count({
        where: {
          concessionarioId: STAGING_E2E_CASE.concessionarioId,
          NOT: { id: STAGING_E2E_CASE.concessioneId },
        },
      }),
    ]);
    if (documents + jobs + revisions + reports + proposals + missions + otherConcessions > 0) {
      throw new Error("STAGING_E2E_CLEANUP_REQUIRES_SEPARATE_EVIDENCE_CLEANUP");
    }

    await createAuditLogInTransaction(tx, {
      azione: "STAGING_E2E_CASE_CLEANUP",
      entita: "Procedimento",
      entitaId: procedimento.id,
      enteId: procedimento.concessione.enteId,
      esito: "SUCCESS",
      actor: { userId: null, userEmail: null, userRole: "SYSTEM" },
      requestContext: { ipAddress: null, userAgent: "staging-e2e-case-cli" },
      metadata: { caseCode: STAGING_E2E_CASE.numeroAtto, syntheticDataOnly: true },
    });
    await tx.procedimento.delete({ where: { id: procedimento.id } });
    await tx.concessione.delete({ where: { id: STAGING_E2E_CASE.concessioneId } });
    await tx.concessionario.delete({ where: { id: STAGING_E2E_CASE.concessionarioId } });
    return { outcome: "DELETED", procedimentoId: procedimento.id };
  });
}

export async function runStagingE2eCaseCli(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Readonly<Record<string, unknown>>> {
  assertStagingE2eCaseEnvironment(environment);
  return parseStagingE2eCaseMode(argv) === "cleanup" ? cleanupCase() : createCase();
}

const directlyInvoked = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (directlyInvoked) {
  runStagingE2eCaseCli()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "STAGING_E2E_CASE_FAILED");
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
