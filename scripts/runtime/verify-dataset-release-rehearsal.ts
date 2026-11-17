import {
  buildDatasetConcessioneWhere,
  buildDatasetDocumentoWhere,
  buildDatasetFascicoloIntakeWhere,
  buildDatasetProcedimentoWhere,
} from "../../src/lib/dataset-visibility";
import { prisma } from "../../src/lib/prisma";

const DEMO_NUMBERS = [
  "CP-001/2021",
  "CP-014/2020",
  "CP-031/2017",
  "CP-046/2022",
  "CP-058/2019",
  "CP-067/2018",
  "CP-073/2023",
  "CP-081/2024",
] as const;
const PROFESSIONAL_CONCESSION_ID = "release-professional-concession";
const PROFESSIONAL_PROCEDIMENTO_ID = "release-professional-procedimento";
const PROFESSIONAL_INTAKE_ID = "release-professional-intake";
const PROFESSIONAL_DOCUMENT_ID = "release-professional-document";
const UNKNOWN_PROCEDIMENTO_ID = "procedimento-intake-51da99fdc83a223973aaffaa";
const UNKNOWN_INTAKE_ID = "release-unknown-intake";
const UNKNOWN_DOCUMENT_ID = "release-unknown-document";
const E2E_CONCESSION_ID = "staging-e2e-test-001-concessione";
const E2E_PROCEDIMENTO_IDS = [
  "procedimento-intake-9e04f4d4cdbf092845b57c66",
  "procedimento-intake-9da1ec9ef08c0ec4e4e1f44f",
  "procedimento-intake-b50fb05abbfb2ac80e675e92",
  "staging-e2e-test-001-procedimento",
  "e2e-proc-1793469328377-49",
  "e2e-proc-1793469315490-625",
] as const;

function assertIsolatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Release rehearsal requires a loopback PostgreSQL database.");
  }
  if (!parsed.pathname.toLowerCase().includes("dataset")) {
    throw new Error("Release rehearsal database name must contain 'dataset'.");
  }
}

function assertEqual(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}.`);
  }
}

async function prepare() {
  const tenantId = "release-rehearsal-tenant";
  const concessionarioId = "release-rehearsal-concessionario";
  await prisma.ente.create({
    data: { id: tenantId, codice: tenantId, nome: "Release rehearsal tenant" },
  });
  await prisma.concessionario.create({
    data: { id: concessionarioId, denominazione: "Release rehearsal operator" },
  });

  const demoConcessions = DEMO_NUMBERS.map((numeroAtto, index) => ({
    id: `release-demo-concession-${index + 1}`,
    numeroAtto,
    dataRilascio: new Date("2020-01-01T00:00:00.000Z"),
    dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
    normaRiferimento: "ALTRO" as const,
    tipologiaBene: "ALTRO" as const,
    attivita: "ALTRO" as const,
    stato: "ATTIVA" as const,
    concessionarioId,
    enteId: tenantId,
  }));
  await prisma.concessione.createMany({
    data: [
      ...demoConcessions,
      {
        id: E2E_CONCESSION_ID,
        numeroAtto: "E2E-TEST-001",
        dataRilascio: new Date("2024-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
        normaRiferimento: "ALTRO",
        tipologiaBene: "ALTRO",
        attivita: "ALTRO",
        stato: "ATTIVA",
        concessionarioId,
        enteId: tenantId,
      },
      {
        id: PROFESSIONAL_CONCESSION_ID,
        numeroAtto: "PROFESSIONAL-001",
        dataRilascio: new Date("2025-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
        normaRiferimento: "ALTRO",
        tipologiaBene: "ALTRO",
        attivita: "ALTRO",
        stato: "ATTIVA",
        concessionarioId,
        enteId: tenantId,
      },
    ],
  });

  const demoProcedures = demoConcessions.map((concessione, index) => ({
    id: `release-demo-procedimento-${index + 1}`,
    enteId: tenantId,
    concessioneId: concessione.id,
    tipologia: "ALTRO" as const,
    stato: "DA_AVVIARE" as const,
  }));
  await prisma.procedimento.createMany({
    data: [
      ...demoProcedures,
      {
        id: "cmvxr3st5003920udtvom8ebv",
        enteId: tenantId,
        concessioneId: demoConcessions[4]!.id,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      {
        id: E2E_PROCEDIMENTO_IDS[3],
        enteId: tenantId,
        concessioneId: E2E_CONCESSION_ID,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      {
        id: E2E_PROCEDIMENTO_IDS[4],
        enteId: tenantId,
        concessioneId: demoConcessions[0]!.id,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      {
        id: E2E_PROCEDIMENTO_IDS[5],
        enteId: tenantId,
        concessioneId: demoConcessions[0]!.id,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      ...E2E_PROCEDIMENTO_IDS.slice(0, 3).map((id) => ({
        id,
        enteId: tenantId,
        concessioneId: null,
        tipologia: "ALTRO" as const,
        stato: "DA_AVVIARE" as const,
      })),
      {
        id: PROFESSIONAL_PROCEDIMENTO_ID,
        enteId: tenantId,
        concessioneId: PROFESSIONAL_CONCESSION_ID,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
      {
        id: UNKNOWN_PROCEDIMENTO_ID,
        enteId: tenantId,
        tipologia: "ALTRO",
        stato: "DA_AVVIARE",
      },
    ],
  });

  await prisma.fascicoloIntake.createMany({
    data: [
      {
        id: "cmv0onh44000006k0pv9s7lh9",
        enteId: tenantId,
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "COLLAUDO E2E - Concessione Porto Aurora",
      },
      ...E2E_PROCEDIMENTO_IDS.slice(0, 3).map((procedimentoId, index) => ({
        id: `release-e2e-intake-${index + 1}`,
        enteId: tenantId,
        procedimentoId,
        tipologiaConcessione: "PORTUALE_ADSP" as const,
        oggettoFascicolo: `E2E intake ${index + 1}`,
      })),
      {
        id: PROFESSIONAL_INTAKE_ID,
        enteId: tenantId,
        concessioneId: PROFESSIONAL_CONCESSION_ID,
        procedimentoId: PROFESSIONAL_PROCEDIMENTO_ID,
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "Professional release rehearsal",
      },
      {
        id: UNKNOWN_INTAKE_ID,
        enteId: tenantId,
        procedimentoId: UNKNOWN_PROCEDIMENTO_ID,
        tipologiaConcessione: "PORTUALE_ADSP",
        oggettoFascicolo: "Unknown historical intake",
      },
    ],
  });
  await prisma.documento.createMany({
    data: [
      {
        id: PROFESSIONAL_DOCUMENT_ID,
        nome: "Professional document",
        tipologia: "ALTRO",
        enteId: tenantId,
        concessioneId: PROFESSIONAL_CONCESSION_ID,
        procedimentoId: PROFESSIONAL_PROCEDIMENTO_ID,
        fascicoloIntakeId: PROFESSIONAL_INTAKE_ID,
      },
      {
        id: "release-e2e-document",
        nome: "E2E document",
        tipologia: "ALTRO",
        enteId: tenantId,
        procedimentoId: E2E_PROCEDIMENTO_IDS[0],
        fascicoloIntakeId: "release-e2e-intake-1",
      },
      {
        id: UNKNOWN_DOCUMENT_ID,
        nome: "conc_34_25.pdf",
        tipologia: "ALTRO",
        enteId: tenantId,
        procedimentoId: UNKNOWN_PROCEDIMENTO_ID,
        fascicoloIntakeId: UNKNOWN_INTAKE_ID,
      },
    ],
  });
  console.log(JSON.stringify({ outcome: "PREPARED" }));
}

async function verifyPreBackfill() {
  const [roots, professionalVisible, syntheticVisible, documentsVisible] = await Promise.all([
    Promise.all([
      prisma.concessione.count({ where: { datasetClass: "UNCLASSIFIED" } }),
      prisma.procedimento.count({ where: { datasetClass: "UNCLASSIFIED" } }),
      prisma.fascicoloIntake.count({ where: { datasetClass: "UNCLASSIFIED" } }),
    ]),
    Promise.all([
      prisma.concessione.count({ where: buildDatasetConcessioneWhere("PROFESSIONAL") }),
      prisma.procedimento.count({ where: buildDatasetProcedimentoWhere("PROFESSIONAL") }),
      prisma.fascicoloIntake.count({ where: buildDatasetFascicoloIntakeWhere("PROFESSIONAL") }),
    ]),
    Promise.all([
      prisma.concessione.count({ where: buildDatasetConcessioneWhere("SYNTHETIC") }),
      prisma.procedimento.count({ where: buildDatasetProcedimentoWhere("SYNTHETIC") }),
      prisma.fascicoloIntake.count({ where: buildDatasetFascicoloIntakeWhere("SYNTHETIC") }),
    ]),
    prisma.documento.count({ where: buildDatasetDocumentoWhere("PROFESSIONAL") }),
  ]);
  assertEqual("unclassified concessions", roots[0], 10);
  assertEqual("unclassified procedures", roots[1], 17);
  assertEqual("unclassified intakes", roots[2], 6);
  professionalVisible.forEach((count, index) => assertEqual(`professional root ${index}`, count, 0));
  syntheticVisible.forEach((count, index) => assertEqual(`synthetic root ${index}`, count, 0));
  assertEqual("professional documents before backfill", documentsVisible, 0);
  console.log(JSON.stringify({ outcome: "PRE_BACKFILL_FAIL_CLOSED", roots }));
}

async function verifyPostBackfill() {
  const [
    professionalConcessions,
    syntheticConcessions,
    professionalProcedures,
    syntheticProcedures,
    professionalIntakes,
    syntheticIntakes,
    professionalDocuments,
    syntheticDocuments,
    unknown,
  ] = await Promise.all([
    prisma.concessione.findMany({
      where: buildDatasetConcessioneWhere("PROFESSIONAL"),
      select: { id: true },
    }),
    prisma.concessione.count({ where: buildDatasetConcessioneWhere("SYNTHETIC") }),
    prisma.procedimento.findMany({
      where: buildDatasetProcedimentoWhere("PROFESSIONAL"),
      select: { id: true },
    }),
    prisma.procedimento.count({ where: buildDatasetProcedimentoWhere("SYNTHETIC") }),
    prisma.fascicoloIntake.findMany({
      where: buildDatasetFascicoloIntakeWhere("PROFESSIONAL"),
      select: { id: true },
    }),
    prisma.fascicoloIntake.count({ where: buildDatasetFascicoloIntakeWhere("SYNTHETIC") }),
    prisma.documento.findMany({
      where: buildDatasetDocumentoWhere("PROFESSIONAL"),
      select: { id: true },
    }),
    prisma.documento.count({ where: buildDatasetDocumentoWhere("SYNTHETIC") }),
    Promise.all([
      prisma.procedimento.findUnique({
        where: { id: UNKNOWN_PROCEDIMENTO_ID },
        select: { datasetClass: true },
      }),
      prisma.fascicoloIntake.findUnique({
        where: { id: UNKNOWN_INTAKE_ID },
        select: { datasetClass: true },
      }),
    ]),
  ]);
  if (professionalConcessions.map((row) => row.id).join() !== PROFESSIONAL_CONCESSION_ID) {
    throw new Error("Professional concession availability mismatch.");
  }
  if (professionalProcedures.map((row) => row.id).join() !== PROFESSIONAL_PROCEDIMENTO_ID) {
    throw new Error("Professional procedure availability mismatch.");
  }
  if (professionalIntakes.map((row) => row.id).join() !== PROFESSIONAL_INTAKE_ID) {
    throw new Error("Professional intake availability mismatch.");
  }
  if (professionalDocuments.map((row) => row.id).join() !== PROFESSIONAL_DOCUMENT_ID) {
    throw new Error("Professional document availability mismatch.");
  }
  assertEqual("synthetic concessions", syntheticConcessions, 9);
  assertEqual("synthetic procedures", syntheticProcedures, 15);
  assertEqual("synthetic intakes", syntheticIntakes, 4);
  assertEqual("synthetic documents", syntheticDocuments, 1);
  if (unknown.some((row) => row?.datasetClass !== "UNCLASSIFIED")) {
    throw new Error("Unknown historical roots must remain quarantined.");
  }
  const hiddenUnknownDocument = await prisma.documento.findFirst({
    where: { id: UNKNOWN_DOCUMENT_ID, ...buildDatasetDocumentoWhere("PROFESSIONAL") },
  });
  if (hiddenUnknownDocument) {
    throw new Error("Unknown historical document leaked into the professional scope.");
  }
  assertEqual("all concessions preserved", await prisma.concessione.count(), 10);
  assertEqual("all procedures preserved", await prisma.procedimento.count(), 17);
  assertEqual("all intakes preserved", await prisma.fascicoloIntake.count(), 6);
  assertEqual("all documents preserved", await prisma.documento.count(), 3);
  console.log(JSON.stringify({
    outcome: "POST_BACKFILL_VERIFIED",
    professional: {
      concessioni: professionalConcessions.length,
      procedimenti: professionalProcedures.length,
      intakes: professionalIntakes.length,
      documenti: professionalDocuments.length,
    },
    synthetic: {
      concessioni: syntheticConcessions,
      procedimenti: syntheticProcedures,
      intakes: syntheticIntakes,
      documenti: syntheticDocuments,
    },
    quarantined: { procedimenti: 1, intakes: 1, documenti: 1 },
  }));
}

async function main() {
  assertIsolatedDatabase();
  const phase = process.argv[2];
  if (phase === "prepare") return prepare();
  if (phase === "pre-backfill") return verifyPreBackfill();
  if (phase === "post-backfill") return verifyPostBackfill();
  throw new Error("Use prepare, pre-backfill or post-backfill.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
