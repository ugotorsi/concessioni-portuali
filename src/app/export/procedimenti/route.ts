import { buildCsv, buildCsvFilename, csvResponse } from "@/lib/csv";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const rateLimitResult = checkRateLimit({
    key: `export:procedimenti:${getClientIp(request.headers)}`,
    limit: 25,
    windowMs: 60_000,
  });

  if (!rateLimitResult.allowed) {
    const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);

    return Response.json(
      { error: "Too many requests. Please retry later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(retryAfter, 1)),
        },
      },
    );
  }

  const role = await getCurrentRole();

  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!canExportOperationalData(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await prisma.procedimento.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      tipologia: true,
      stato: true,
      riferimentoNormativo: true,
      dataAvvio: true,
      dataScadenzaContraddittorio: true,
      dataProvvedimentoFinale: true,
      noteIstruttorie: true,
      concessione: {
        select: {
          numeroAtto: true,
          concessionario: { select: { denominazione: true } },
        },
      },
      criticita: {
        select: {
          tipologia: true,
          gravita: true,
          stato: true,
        },
      },
    },
    take: 5000,
  });

  const csv = buildCsv(rows, [
    { header: "id", value: (row) => row.id },
    { header: "tipologia", value: (row) => row.tipologia },
    { header: "stato", value: (row) => row.stato },
    { header: "riferimento_normativo", value: (row) => row.riferimentoNormativo },
    { header: "data_avvio", value: (row) => row.dataAvvio },
    { header: "data_scadenza_contraddittorio", value: (row) => row.dataScadenzaContraddittorio },
    { header: "data_provvedimento_finale", value: (row) => row.dataProvvedimentoFinale },
    { header: "numero_atto", value: (row) => row.concessione.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione.concessionario.denominazione },
    { header: "criticita_tipologia", value: (row) => row.criticita?.tipologia },
    { header: "criticita_gravita", value: (row) => row.criticita?.gravita },
    { header: "criticita_stato", value: (row) => row.criticita?.stato },
    { header: "note_istruttorie", value: (row) => row.noteIstruttorie },
  ]);

  return csvResponse(csv, buildCsvFilename("procedimenti"));
}
