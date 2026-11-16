import { createHash } from "node:crypto";

import type { DatasetClass, Prisma } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/prisma";

const DEMO_CONCESSION_NUMBERS = [
  "CP-001/2021",
  "CP-014/2020",
  "CP-031/2017",
  "CP-046/2022",
  "CP-058/2019",
  "CP-067/2018",
  "CP-073/2023",
  "CP-081/2024",
] as const;
const E2E_CONCESSION_NUMBER = "E2E-TEST-001";
const E2E_PROCEDIMENTO_IDS = [
  "procedimento-intake-9e04f4d4cdbf092845b57c66",
  "procedimento-intake-9da1ec9ef08c0ec4e4e1f44f",
  "procedimento-intake-b50fb05abbfb2ac80e675e92",
  "staging-e2e-test-001-procedimento",
  "e2e-proc-1793469328377-49",
  "e2e-proc-1793469315490-625",
] as const;
const E2E_STANDALONE_INTAKE_IDS = [
  "cmv0onh44000006k0pv9s7lh9",
] as const;
const APPLY_CONFIRMATION = "CLASSIFY_KNOWN_SYNTHETIC_DATA";

type PlannedRoot = {
  id: string;
  current: DatasetClass;
  desired: Exclude<DatasetClass, "UNCLASSIFIED">;
};

function list(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function desiredConcessionClass(numeroAtto: string): "DEMO" | "E2E" | null {
  if (numeroAtto === E2E_CONCESSION_NUMBER) return "E2E";
  return DEMO_CONCESSION_NUMBERS.includes(
    numeroAtto as (typeof DEMO_CONCESSION_NUMBERS)[number],
  )
    ? "DEMO"
    : null;
}

function hasConflict(root: PlannedRoot): boolean {
  return root.current !== "UNCLASSIFIED" && root.current !== root.desired;
}

function datasetFamily(value: DatasetClass): "PROFESSIONAL" | "SYNTHETIC" | "UNCLASSIFIED" {
  if (value === "PROFESSIONAL") return "PROFESSIONAL";
  if (value === "UNCLASSIFIED") return "UNCLASSIFIED";
  return "SYNTHETIC";
}

async function buildInventory(client: Prisma.TransactionClient | typeof prisma) {
  const professionalIds = {
    concessioni: list(process.env.NOETRA_DATASET_PROFESSIONAL_CONCESSIONE_IDS),
    procedimenti: list(process.env.NOETRA_DATASET_PROFESSIONAL_PROCEDIMENTO_IDS),
    intakes: list(process.env.NOETRA_DATASET_PROFESSIONAL_INTAKE_IDS),
  };
  const [concessioni, procedimenti, intakes] = await Promise.all([
    client.concessione.findMany({
      orderBy: [{ numeroAtto: "asc" }, { id: "asc" }],
      select: {
        id: true,
        numeroAtto: true,
        datasetClass: true,
        ente: { select: { codice: true } },
        _count: {
          select: {
            documenti: true,
            procedimenti: true,
            criticita: true,
            scadenze: true,
            pagamenti: true,
            sopralluoghi: true,
            report: true,
          },
        },
      },
    }),
    client.procedimento.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        datasetClass: true,
        concessioneId: true,
        concessione: { select: { numeroAtto: true } },
        fascicoloIntake: { select: { id: true } },
        _count: {
          select: {
            documenti: true,
            asyncJobs: true,
            fascicoloKnowledgeRevisions: true,
            structuredFascicoloReports: true,
            professionalLegalQuestions: true,
          },
        },
      },
    }),
    client.fascicoloIntake.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        datasetClass: true,
        concessioneId: true,
        procedimentoId: true,
        oggettoFascicolo: true,
        denominazioneBreve: true,
        numeroConcessione: true,
        _count: { select: { documenti: true } },
      },
    }),
  ]);

  const plannedConcessioni: PlannedRoot[] = concessioni.flatMap((row) => {
    const desired = professionalIds.concessioni.includes(row.id)
      ? "PROFESSIONAL"
      : desiredConcessionClass(row.numeroAtto);
    return desired ? [{ id: row.id, current: row.datasetClass, desired }] : [];
  });
  const concessionPlanById = new Map(
    plannedConcessioni.map((row) => [row.id, row.desired]),
  );
  const plannedProcedimenti: PlannedRoot[] = procedimenti.flatMap((row) => {
    const desired = professionalIds.procedimenti.includes(row.id)
      ? "PROFESSIONAL"
      : E2E_PROCEDIMENTO_IDS.includes(
          row.id as (typeof E2E_PROCEDIMENTO_IDS)[number],
        )
        ? "E2E"
        : row.concessioneId
          ? concessionPlanById.get(row.concessioneId) ?? null
          : null;
    return desired ? [{ id: row.id, current: row.datasetClass, desired }] : [];
  });
  const procedimentoPlanById = new Map(
    plannedProcedimenti.map((row) => [row.id, row.desired]),
  );
  const plannedIntakes: PlannedRoot[] = intakes.flatMap((row) => {
    const desired = professionalIds.intakes.includes(row.id)
      ? "PROFESSIONAL"
      : E2E_STANDALONE_INTAKE_IDS.includes(
          row.id as (typeof E2E_STANDALONE_INTAKE_IDS)[number],
        )
        ? "E2E"
        : row.procedimentoId
          ? procedimentoPlanById.get(row.procedimentoId) ?? null
          : row.concessioneId
            ? concessionPlanById.get(row.concessioneId) ?? null
            : null;
    return desired ? [{ id: row.id, current: row.datasetClass, desired }] : [];
  });
  const plannedIds = {
    concessioni: new Set(plannedConcessioni.map((row) => row.id)),
    procedimenti: new Set(plannedProcedimenti.map((row) => row.id)),
    intakes: new Set(plannedIntakes.map((row) => row.id)),
  };
  const intakePlanById = new Map(plannedIntakes.map((row) => [row.id, row.desired]));
  const relationshipConflicts = [
    ...procedimenti.flatMap((row) => {
      if (!row.concessioneId) return [];
      const procedimentoClass = procedimentoPlanById.get(row.id) ?? row.datasetClass;
      const concessione = concessioni.find((candidate) => candidate.id === row.concessioneId);
      if (!concessione) return [{ kind: "MISSING_CONCESSIONE", id: row.id }];
      const concessioneClass =
        concessionPlanById.get(concessione.id) ?? concessione.datasetClass;
      return datasetFamily(procedimentoClass) !== datasetFamily(concessioneClass)
        ? [{
            kind: "PROCEDIMENTO_CONCESSIONE_SCOPE_MISMATCH",
            id: row.id,
            procedimentoClass,
            concessioneClass,
          }]
        : [];
    }),
    ...intakes.flatMap((row) => {
      const intakeClass = intakePlanById.get(row.id) ?? row.datasetClass;
      const parentClass = row.procedimentoId
        ? procedimentoPlanById.get(row.procedimentoId)
          ?? procedimenti.find((candidate) => candidate.id === row.procedimentoId)?.datasetClass
        : row.concessioneId
          ? concessionPlanById.get(row.concessioneId)
            ?? concessioni.find((candidate) => candidate.id === row.concessioneId)?.datasetClass
          : null;
      return parentClass && datasetFamily(intakeClass) !== datasetFamily(parentClass)
        ? [{
            kind: "INTAKE_PARENT_SCOPE_MISMATCH",
            id: row.id,
            intakeClass,
            parentClass,
          }]
        : [];
    }),
  ];
  const quarantine = {
    concessioni: concessioni.filter(
      (row) => row.datasetClass === "UNCLASSIFIED" && !plannedIds.concessioni.has(row.id),
    ),
    procedimenti: procedimenti.filter(
      (row) => row.datasetClass === "UNCLASSIFIED" && !plannedIds.procedimenti.has(row.id),
    ),
    intakes: intakes.filter(
      (row) => row.datasetClass === "UNCLASSIFIED" && !plannedIds.intakes.has(row.id),
    ),
  };
  const expectedMissing = {
    concessioni: [...DEMO_CONCESSION_NUMBERS, E2E_CONCESSION_NUMBER].filter(
      (numeroAtto) => !concessioni.some((row) => row.numeroAtto === numeroAtto),
    ),
    procedimenti: E2E_PROCEDIMENTO_IDS.filter(
      (id) => !procedimenti.some((row) => row.id === id),
    ),
    intakes: E2E_STANDALONE_INTAKE_IDS.filter(
      (id) => !intakes.some((row) => row.id === id),
    ),
    professionalConcessioni: professionalIds.concessioni.filter(
      (id) => !concessioni.some((row) => row.id === id),
    ),
    professionalProcedimenti: professionalIds.procedimenti.filter(
      (id) => !procedimenti.some((row) => row.id === id),
    ),
    professionalIntakes: professionalIds.intakes.filter(
      (id) => !intakes.some((row) => row.id === id),
    ),
  };
  const manifestConflicts = [
    ...[...DEMO_CONCESSION_NUMBERS, E2E_CONCESSION_NUMBER].flatMap((numeroAtto) => {
      const matches = concessioni.filter((row) => row.numeroAtto === numeroAtto);
      return matches.length > 1
        ? [{
            kind: "AMBIGUOUS_SYNTHETIC_CONCESSION_NUMBER",
            numeroAtto,
            ids: matches.map((row) => row.id),
          }]
        : [];
    }),
    ...concessioni.flatMap((row) => (
      professionalIds.concessioni.includes(row.id) && desiredConcessionClass(row.numeroAtto)
        ? [{
            kind: "PROFESSIONAL_SYNTHETIC_MANIFEST_OVERLAP",
            root: "CONCESSIONE",
            id: row.id,
          }]
        : []
    )),
    ...professionalIds.procedimenti.flatMap((id) => (
      E2E_PROCEDIMENTO_IDS.includes(id as (typeof E2E_PROCEDIMENTO_IDS)[number])
        ? [{
            kind: "PROFESSIONAL_SYNTHETIC_MANIFEST_OVERLAP",
            root: "PROCEDIMENTO",
            id,
          }]
        : []
    )),
    ...professionalIds.intakes.flatMap((id) => (
      E2E_STANDALONE_INTAKE_IDS.includes(
        id as (typeof E2E_STANDALONE_INTAKE_IDS)[number],
      )
        ? [{
            kind: "PROFESSIONAL_SYNTHETIC_MANIFEST_OVERLAP",
            root: "INTAKE",
            id,
          }]
        : []
    )),
  ];
  const conflicts = [
    ...plannedConcessioni.filter(hasConflict).map((row) => ({ kind: "CONCESSIONE", ...row })),
    ...plannedProcedimenti.filter(hasConflict).map((row) => ({ kind: "PROCEDIMENTO", ...row })),
    ...plannedIntakes.filter(hasConflict).map((row) => ({ kind: "INTAKE", ...row })),
    ...manifestConflicts,
    ...relationshipConflicts,
  ];
  const plan = {
    concessioni: plannedConcessioni.map(({ id, desired }) => ({ id, desired })),
    procedimenti: plannedProcedimenti.map(({ id, desired }) => ({ id, desired })),
    intakes: plannedIntakes.map(({ id, desired }) => ({ id, desired })),
  };

  return {
    fingerprint: stableFingerprint({
      roots: {
        concessioni: concessioni.map((row) => [row.id, row.numeroAtto, row.datasetClass]),
        procedimenti: procedimenti.map((row) => [
          row.id,
          row.concessioneId,
          row.datasetClass,
        ]),
        intakes: intakes.map((row) => [
          row.id,
          row.concessioneId,
          row.procedimentoId,
          row.datasetClass,
        ]),
      },
      plan,
    }),
    counts: {
      concessioni: concessioni.length,
      procedimenti: procedimenti.length,
      intakes: intakes.length,
      plannedConcessioni: plannedConcessioni.length,
      plannedProcedimenti: plannedProcedimenti.length,
      plannedIntakes: plannedIntakes.length,
      quarantinedConcessioni: quarantine.concessioni.length,
      quarantinedProcedimenti: quarantine.procedimenti.length,
      quarantinedIntakes: quarantine.intakes.length,
    },
    expectedMissing,
    conflicts,
    plan,
    quarantine,
    roots: { concessioni, procedimenti, intakes },
  };
}

function hasMissingExpected(
  expectedMissing: Awaited<ReturnType<typeof buildInventory>>["expectedMissing"],
): boolean {
  return Object.values(expectedMissing).some((rows) => rows.length > 0);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const requireProductionManifest =
    process.env.NOETRA_DATASET_REQUIRE_PRODUCTION_MANIFEST === "true";
  const inventory = await buildInventory(prisma);
  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    ...inventory,
  }, null, 2));

  if (!apply) return;
  if (process.env.NOETRA_DATASET_BACKFILL_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(
      `Refusing write: set NOETRA_DATASET_BACKFILL_CONFIRM=${APPLY_CONFIRMATION}.`,
    );
  }
  if (
    process.env.NOETRA_DATASET_BACKFILL_EXPECTED_FINGERPRINT
    !== inventory.fingerprint
  ) {
    throw new Error("Refusing write: inventory fingerprint mismatch.");
  }
  if (inventory.conflicts.length > 0) {
    throw new Error("Refusing write: the classification plan has conflicts.");
  }
  if (requireProductionManifest && hasMissingExpected(inventory.expectedMissing)) {
    throw new Error("Refusing write: Production manifest is incomplete.");
  }

  await prisma.$transaction(async (tx) => {
    const current = await buildInventory(tx);
    if (current.fingerprint !== inventory.fingerprint) {
      throw new Error("Refusing write: dataset roots changed after inventory.");
    }
    for (const row of current.plan.concessioni) {
      await tx.concessione.update({
        where: { id: row.id },
        data: { datasetClass: row.desired },
      });
    }
    for (const row of current.plan.procedimenti) {
      await tx.procedimento.update({
        where: { id: row.id },
        data: { datasetClass: row.desired },
      });
    }
    for (const row of current.plan.intakes) {
      await tx.fascicoloIntake.update({
        where: { id: row.id },
        data: { datasetClass: row.desired },
      });
    }
  }, { isolationLevel: "Serializable" });

  const verified = await buildInventory(prisma);
  if (verified.conflicts.length > 0) {
    throw new Error("Classification verification failed.");
  }
  const stillUnclassifiedPlanned = [
    ...verified.roots.concessioni.filter(
      (row) => verified.plan.concessioni.some((plan) => plan.id === row.id)
        && row.datasetClass === "UNCLASSIFIED",
    ),
    ...verified.roots.procedimenti.filter(
      (row) => verified.plan.procedimenti.some((plan) => plan.id === row.id)
        && row.datasetClass === "UNCLASSIFIED",
    ),
    ...verified.roots.intakes.filter(
      (row) => verified.plan.intakes.some((plan) => plan.id === row.id)
        && row.datasetClass === "UNCLASSIFIED",
    ),
  ];
  if (stillUnclassifiedPlanned.length > 0) {
    throw new Error("Classification verification left planned roots unclassified.");
  }
  console.log(JSON.stringify({
    outcome: "CLASSIFIED_AND_VERIFIED",
    counts: verified.counts,
    quarantine: verified.quarantine,
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
