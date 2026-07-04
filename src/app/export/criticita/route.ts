import { buildCsv, buildCsvFilename, csvResponse } from "@/lib/csv";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const rateLimitResult = checkRateLimit({
    key: `export:criticita:${getClientIp(request.headers)}`,
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
      rilevanzaArt47: true,
      letteraArt47: true,
      rischioDecadenza: true,
      motivazioneArt47: true,
      azioneIstruttoriaArt47: true,
      regolarizzata: true,
      dataRegolarizzazione: true,
      descrizioneRegolarizzazione: true,
      esitoRegolarizzazione: true,
      verificataRegolarizzazione: true,
      dataVerificaRegolarizzazione: true,
      noteVerificaRegolarizzazione: true,
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
    { header: "rilevanza_art47", value: (row) => (row.rilevanzaArt47 ? "SI" : "NO") },
    { header: "lettera_art47", value: (row) => row.letteraArt47 },
    { header: "rischio_decadenza", value: (row) => row.rischioDecadenza },
    { header: "motivazione_art47", value: (row) => row.motivazioneArt47 },
    { header: "azione_istruttoria_art47", value: (row) => row.azioneIstruttoriaArt47 },
    { header: "regolarizzata", value: (row) => (row.regolarizzata ? "SI" : "NO") },
    { header: "data_regolarizzazione", value: (row) => row.dataRegolarizzazione },
    { header: "descrizione_regolarizzazione", value: (row) => row.descrizioneRegolarizzazione },
    { header: "esito_regolarizzazione", value: (row) => row.esitoRegolarizzazione },
    { header: "verificata_regolarizzazione", value: (row) => (row.verificataRegolarizzazione ? "SI" : "NO") },
    { header: "data_verifica_regolarizzazione", value: (row) => row.dataVerificaRegolarizzazione },
    { header: "note_verifica_regolarizzazione", value: (row) => row.noteVerificaRegolarizzazione },
  ]);

  return csvResponse(csv, buildCsvFilename("criticita"));
}
