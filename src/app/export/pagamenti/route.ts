import { buildCsv, buildCsvFilename, csvResponse } from "@/lib/csv";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const role = await getCurrentRole();

  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!canExportOperationalData(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await prisma.pagamento.findMany({
    orderBy: [{ dataScadenza: "asc" }],
    select: {
      id: true,
      annoRiferimento: true,
      importoDovuto: true,
      importoVersato: true,
      stato: true,
      dataScadenza: true,
      dataVersamento: true,
      interessiMora: true,
      concessione: {
        select: {
          numeroAtto: true,
          concessionario: { select: { denominazione: true } },
        },
      },
    },
    take: 5000,
  });

  const csv = buildCsv(rows, [
    { header: "id", value: (row) => row.id },
    { header: "anno_riferimento", value: (row) => row.annoRiferimento },
    { header: "importo_dovuto", value: (row) => Number(row.importoDovuto) },
    { header: "importo_versato", value: (row) => Number(row.importoVersato) },
    { header: "residuo", value: (row) => Math.max(Number(row.importoDovuto) - Number(row.importoVersato), 0) },
    { header: "stato", value: (row) => row.stato },
    { header: "data_scadenza", value: (row) => row.dataScadenza },
    { header: "data_versamento", value: (row) => row.dataVersamento },
    { header: "interessi_mora", value: (row) => (row.interessiMora ? Number(row.interessiMora) : null) },
    { header: "numero_atto", value: (row) => row.concessione.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione.concessionario.denominazione },
  ]);

  return csvResponse(csv, buildCsvFilename("pagamenti"));
}
