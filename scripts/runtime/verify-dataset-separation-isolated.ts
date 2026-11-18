import {
  buildDatasetConcessioneWhere,
  buildDatasetDocumentoWhere,
  buildDatasetFascicoloIntakeWhere,
  buildDatasetProcedimentoWhere,
} from "../../src/lib/dataset-visibility";
import { prisma } from "../../src/lib/prisma";

const PROFESSIONAL_CONCESSION_ID = "dataset-validation-professional-concession";
const PROFESSIONAL_PROCEDIMENTO_ID = "dataset-validation-professional-procedimento";
const PROFESSIONAL_INTAKE_ID = "dataset-validation-professional-intake";
const PROFESSIONAL_DOCUMENT_ID = "dataset-validation-professional-document";
const E2E_CONCESSION_ID = "dataset-validation-e2e-concession";
const E2E_PROCEDIMENTO_ID = "dataset-validation-e2e-procedimento";
const E2E_INTAKE_ID = "dataset-validation-e2e-intake";
const E2E_DOCUMENT_ID = "dataset-validation-e2e-document";

function assertIsolatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Dataset validation requires a loopback PostgreSQL database.");
  }
  if (!parsed.pathname.toLowerCase().includes("dataset")) {
    throw new Error("Dataset validation database name must contain 'dataset'.");
  }
}

function assertIds(label: string, actual: string[], expected: string[]) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(sortedExpected)}, received ${JSON.stringify(sortedActual)}.`,
    );
  }
}

async function main() {
  assertIsolatedDatabase();
  const ente = await prisma.ente.findFirstOrThrow({ select: { id: true } });
  const concessionario = await prisma.concessionario.findFirstOrThrow({ select: { id: true } });

  await prisma.concessione.createMany({
    data: [
      {
        id: PROFESSIONAL_CONCESSION_ID,
        datasetClass: "PROFESSIONAL",
        numeroAtto: "PROFESSIONAL-VALIDATION-001",
        dataRilascio: new Date("2025-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
        normaRiferimento: "ALTRO",
        tipologiaBene: "ALTRO",
        attivita: "ALTRO",
        stato: "ATTIVA",
        concessionarioId: concessionario.id,
        enteId: ente.id,
      },
      {
        id: E2E_CONCESSION_ID,
        datasetClass: "E2E",
        numeroAtto: "E2E-TEST-001",
        dataRilascio: new Date("2025-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
        normaRiferimento: "ALTRO",
        tipologiaBene: "ALTRO",
        attivita: "ALTRO",
        stato: "ATTIVA",
        concessionarioId: concessionario.id,
        enteId: ente.id,
      },
    ],
  });
  await prisma.procedimento.createMany({
    data: [
      {
        id: PROFESSIONAL_PROCEDIMENTO_ID,
        datasetClass: "PROFESSIONAL",
        enteId: ente.id,
        concessioneId: PROFESSIONAL_CONCESSION_ID,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      {
        id: E2E_PROCEDIMENTO_ID,
        datasetClass: "E2E",
        enteId: ente.id,
        concessioneId: E2E_CONCESSION_ID,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
    ],
  });
  await prisma.fascicoloIntake.createMany({
    data: [
      {
        id: PROFESSIONAL_INTAKE_ID,
        datasetClass: "PROFESSIONAL",
        enteId: ente.id,
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "Validazione professionale",
      },
      {
        id: E2E_INTAKE_ID,
        datasetClass: "E2E",
        enteId: ente.id,
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "Validazione E2E",
      },
    ],
  });
  await prisma.documento.createMany({
    data: [
      {
        id: PROFESSIONAL_DOCUMENT_ID,
        nome: "Documento professionale",
        tipologia: "ALTRO",
        enteId: ente.id,
        concessioneId: PROFESSIONAL_CONCESSION_ID,
        procedimentoId: PROFESSIONAL_PROCEDIMENTO_ID,
      },
      {
        id: E2E_DOCUMENT_ID,
        nome: "Documento E2E",
        tipologia: "ALTRO",
        enteId: ente.id,
        concessioneId: E2E_CONCESSION_ID,
        procedimentoId: E2E_PROCEDIMENTO_ID,
      },
    ],
  });

  const professionalConcessions = await prisma.concessione.findMany({
    where: buildDatasetConcessioneWhere("PROFESSIONAL"),
    select: { id: true },
  });
  assertIds(
    "professional concessions",
    professionalConcessions.map((row) => row.id),
    [PROFESSIONAL_CONCESSION_ID],
  );

  const syntheticConcessions = await prisma.concessione.findMany({
    where: buildDatasetConcessioneWhere("SYNTHETIC"),
    select: { id: true, numeroAtto: true },
  });
  if (
    syntheticConcessions.length !== 9
    || !syntheticConcessions.some((row) => row.id === E2E_CONCESSION_ID)
  ) {
    throw new Error("Synthetic concession scope must contain eight DEMO records and one E2E record.");
  }

  const allConcessions = await prisma.concessione.count({
    where: buildDatasetConcessioneWhere("ALL"),
  });
  if (allConcessions !== 10) {
    throw new Error(`All-dataset concession scope expected 10 rows, received ${allConcessions}.`);
  }

  const professionalProcedimenti = await prisma.procedimento.findMany({
    where: buildDatasetProcedimentoWhere("PROFESSIONAL"),
    select: { id: true },
  });
  assertIds(
    "professional procedimenti",
    professionalProcedimenti.map((row) => row.id),
    [PROFESSIONAL_PROCEDIMENTO_ID],
  );

  const professionalIntakes = await prisma.fascicoloIntake.findMany({
    where: buildDatasetFascicoloIntakeWhere("PROFESSIONAL"),
    select: { id: true },
  });
  assertIds(
    "professional intakes",
    professionalIntakes.map((row) => row.id),
    [PROFESSIONAL_INTAKE_ID],
  );

  const professionalDocuments = await prisma.documento.findMany({
    where: buildDatasetDocumentoWhere("PROFESSIONAL"),
    select: { id: true },
  });
  assertIds(
    "professional documents",
    professionalDocuments.map((row) => row.id),
    [PROFESSIONAL_DOCUMENT_ID],
  );

  const syntheticDocuments = await prisma.documento.findMany({
    where: {
      ...buildDatasetDocumentoWhere("SYNTHETIC"),
      id: { in: [PROFESSIONAL_DOCUMENT_ID, E2E_DOCUMENT_ID] },
    },
    select: { id: true },
  });
  assertIds(
    "synthetic documents",
    syntheticDocuments.map((row) => row.id),
    [E2E_DOCUMENT_ID],
  );

  console.log(JSON.stringify({
    status: "PASS",
    professional: {
      concessioni: professionalConcessions.length,
      procedimenti: professionalProcedimenti.length,
      intakes: professionalIntakes.length,
      documenti: professionalDocuments.length,
    },
    synthetic: {
      concessioni: syntheticConcessions.length,
      validationDocuments: syntheticDocuments.length,
    },
    all: { concessioni: allConcessions },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
