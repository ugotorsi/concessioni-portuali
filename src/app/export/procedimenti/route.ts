import { buildCsv, buildCsvFilename, csvResponse } from "@/lib/csv";
import { canExportOperationalData, getCurrentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTenantConcessioneWhere, getCurrentTenantContext } from "@/lib/tenant-auth";
import { buildRateLimitKey, checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const rateLimitResult = await checkRateLimit({
    key: buildRateLimitKey("export:procedimenti", request.headers),
    limit: 25,
    windowMs: 60_000,
  });

  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult);
  }

  const role = await getCurrentRole();

  if (!role) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!canExportOperationalData(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const tenantContext = await getCurrentTenantContext();
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  const hasConcessioneTenantScope = Object.keys(concessioneTenantWhere).length > 0;

  const rows = await prisma.procedimento.findMany({
    where: hasConcessioneTenantScope
      ? {
          concessione: concessioneTenantWhere,
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      tipologia: true,
      stato: true,
      riferimentoNormativo: true,
      dataAvvio: true,
      dataScadenzaContraddittorio: true,
      dataProvvedimentoFinale: true,
      origineProcedimento: true,
      procedimentoUfficio: true,
      comunicazioneAvvioInviata: true,
      termineMemorieScadenza: true,
      memorieRicevute: true,
      contestazioneFormaleInviata: true,
      controdeduzioniValutate: true,
      preavvisoRigettoApplicabile: true,
      statoPreavvisoRigetto: true,
      dataPreavvisoRigetto: true,
      termineOsservazioniPreavviso: true,
      osservazioniPreavvisoRicevute: true,
      dataOsservazioniPreavviso: true,
      motivazioneMancatoPreavviso: true,
      checklistContraddittorioCompleta: true,
      propostaEsitoIstruttorio: true,
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
    { header: "origine_procedimento", value: (row) => row.origineProcedimento },
    { header: "procedimento_ufficio", value: (row) => (row.procedimentoUfficio ? "SI" : "NO") },
    { header: "comunicazione_avvio_inviata", value: (row) => (row.comunicazioneAvvioInviata ? "SI" : "NO") },
    { header: "termine_memorie_scadenza", value: (row) => row.termineMemorieScadenza },
    { header: "memorie_ricevute", value: (row) => (row.memorieRicevute ? "SI" : "NO") },
    { header: "contestazione_formale_inviata", value: (row) => (row.contestazioneFormaleInviata ? "SI" : "NO") },
    { header: "controdeduzioni_valutate", value: (row) => (row.controdeduzioniValutate ? "SI" : "NO") },
    { header: "preavviso_rigetto_applicabile", value: (row) => (row.preavvisoRigettoApplicabile ? "SI" : "NO") },
    { header: "stato_preavviso_rigetto", value: (row) => row.statoPreavvisoRigetto },
    { header: "data_preavviso_rigetto", value: (row) => row.dataPreavvisoRigetto },
    { header: "termine_osservazioni_preavviso", value: (row) => row.termineOsservazioniPreavviso },
    { header: "osservazioni_preavviso_ricevute", value: (row) => (row.osservazioniPreavvisoRicevute ? "SI" : "NO") },
    { header: "data_osservazioni_preavviso", value: (row) => row.dataOsservazioniPreavviso },
    { header: "motivazione_mancato_preavviso", value: (row) => row.motivazioneMancatoPreavviso },
    { header: "checklist_contraddittorio_completa", value: (row) => (row.checklistContraddittorioCompleta ? "SI" : "NO") },
    { header: "proposta_esito_istruttorio", value: (row) => row.propostaEsitoIstruttorio },
    { header: "numero_atto", value: (row) => row.concessione.numeroAtto },
    { header: "concessionario", value: (row) => row.concessione.concessionario.denominazione },
    { header: "criticita_tipologia", value: (row) => row.criticita?.tipologia },
    { header: "criticita_gravita", value: (row) => row.criticita?.gravita },
    { header: "criticita_stato", value: (row) => row.criticita?.stato },
    { header: "note_istruttorie", value: (row) => row.noteIstruttorie },
  ]);

  return csvResponse(csv, buildCsvFilename("procedimenti"));
}
