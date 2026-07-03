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

  const rows = await prisma.scadenza.findMany({
    orderBy: [{ dataScadenza: "asc" }],
    select: {
      id: true,
      tipologia: true,
      stato: true,
      dataScadenza: true,
      preavvisoGiorni: true,
      descrizione: true,
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
    { header: "tipologia", value: (row) => row.tipologia },
    { header: "stato", value: (row) => row.stato },
    { header: "data_scadenza", value: (row) => row.dataScadenza },
    { header: "preavviso_giorni", value: (row) => row.preavvisoGiorni },
    { header: "numero_atto", value: (row) => row.concessione.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione.concessionario.denominazione },
    { header: "descrizione", value: (row) => row.descrizione },
  ]);

  return csvResponse(csv, buildCsvFilename("scadenze"));
}
