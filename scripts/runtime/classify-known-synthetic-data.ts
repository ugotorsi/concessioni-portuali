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
const APPLY_CONFIRMATION = "CLASSIFY_KNOWN_SYNTHETIC_DATA";

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.NOETRA_DATASET_BACKFILL_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(
      `Refusing write: set NOETRA_DATASET_BACKFILL_CONFIRM=${APPLY_CONFIRMATION}.`,
    );
  }

  const rows = await prisma.concessione.findMany({
    where: {
      numeroAtto: { in: [...DEMO_CONCESSION_NUMBERS, E2E_CONCESSION_NUMBER] },
    },
    orderBy: { numeroAtto: "asc" },
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
      procedimenti: {
        select: {
          id: true,
          datasetClass: true,
          _count: { select: { documenti: true, asyncJobs: true } },
        },
      },
    },
  });

  const foundNumbers = new Set(rows.map((row) => row.numeroAtto));
  const missing = [...DEMO_CONCESSION_NUMBERS, E2E_CONCESSION_NUMBER]
    .filter((numeroAtto) => !foundNumbers.has(numeroAtto));
  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    expected: DEMO_CONCESSION_NUMBERS.length + 1,
    found: rows.length,
    missing,
    records: rows,
  }, null, 2));

  if (!apply) {
    return;
  }
  if (missing.length > 0) {
    throw new Error(`Refusing partial classification; missing: ${missing.join(", ")}.`);
  }

  await prisma.$transaction(async (tx) => {
    const demoIds = rows
      .filter((row) => row.numeroAtto !== E2E_CONCESSION_NUMBER)
      .map((row) => row.id);
    const e2eIds = rows
      .filter((row) => row.numeroAtto === E2E_CONCESSION_NUMBER)
      .map((row) => row.id);

    await tx.concessione.updateMany({
      where: { id: { in: demoIds } },
      data: { datasetClass: "DEMO" },
    });
    await tx.procedimento.updateMany({
      where: { concessioneId: { in: demoIds } },
      data: { datasetClass: "DEMO" },
    });
    await tx.fascicoloIntake.updateMany({
      where: { concessioneId: { in: demoIds } },
      data: { datasetClass: "DEMO" },
    });
    await tx.concessione.updateMany({
      where: { id: { in: e2eIds } },
      data: { datasetClass: "E2E" },
    });
    await tx.procedimento.updateMany({
      where: { concessioneId: { in: e2eIds } },
      data: { datasetClass: "E2E" },
    });
    await tx.fascicoloIntake.updateMany({
      where: { concessioneId: { in: e2eIds } },
      data: { datasetClass: "E2E" },
    });
  });

  console.log("Classification completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
