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

  const rows = await prisma.criticita.findMany({
    orderBy: [{ dataRilevazione: "desc" }],
    select: {
      id: true,
      tipologia: true,
      gravita: true,
      fonte: true,
      stato: true,
      descrizione: true,
      riferimentoNormativo: true,
      azioneConsigliata: true,
      dataRilevazione: true,
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
    { header: "gravita", value: (row) => row.gravita },
    { header: "fonte", value: (row) => row.fonte },
    { header: "stato", value: (row) => row.stato },
    { header: "data_rilevazione", value: (row) => row.dataRilevazione },
    { header: "numero_atto", value: (row) => row.concessione.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione.concessionario.denominazione },
    { header: "riferimento_normativo", value: (row) => row.riferimentoNormativo },
    { header: "descrizione", value: (row) => row.descrizione },
    { header: "azione_consigliata", value: (row) => row.azioneConsigliata },
  ]);

  return csvResponse(csv, buildCsvFilename("criticita"));
}
