"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, requireRole } from "@/lib/auth";
import { isContraddittorioCompleto } from "@/lib/procedimento-checklist";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  PROCEDIMENTO_ORIGINE_VALUES,
  PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES,
  PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES,
  PROCEDIMENTO_STATO_VALUES,
  PROCEDIMENTO_TIPOLOGIA_VALUES,
} from "@/server/queries/procedimenti";

const createProcedimentoSchema = z.object({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  criticitaId: z.string().optional(),
  tipologia: z.enum(PROCEDIMENTO_TIPOLOGIA_VALUES, { message: "Tipologia procedimento non valida." }),
  origineProcedimento: z.enum(PROCEDIMENTO_ORIGINE_VALUES),
  procedimentoUfficio: z.boolean(),
  stato: z.enum(PROCEDIMENTO_STATO_VALUES, { message: "Stato procedimento non valido." }),
  riferimentoNormativo: z.string().trim().optional(),
  dataAvvio: z.string().optional(),
  dataScadenzaContraddittorio: z.string().optional(),
  comunicazioneAvvioInviata: z.boolean(),
  dataComunicazioneAvvio: z.string().optional(),
  termineMemorieGiorni: z.number().int().positive().optional(),
  termineMemorieScadenza: z.string().optional(),
  memorieRicevute: z.boolean(),
  dataRicezioneMemorie: z.string().optional(),
  audizioneRichiesta: z.boolean(),
  audizioneSvolta: z.boolean(),
  dataAudizione: z.string().optional(),
  sopralluogoIstruttorioSvolto: z.boolean(),
  contestazioneFormaleInviata: z.boolean(),
  dataContestazioneFormale: z.string().optional(),
  controdeduzioniValutate: z.boolean(),
  motivazioneValutazione: z.string().trim().optional(),
  propostaEsitoIstruttorio: z.enum(PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES).optional(),
  preavvisoRigettoApplicabile: z.boolean(),
  statoPreavvisoRigetto: z.enum(PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES),
  dataPreavvisoRigetto: z.string().optional(),
  termineOsservazioniPreavviso: z.string().optional(),
  osservazioniPreavvisoRicevute: z.boolean(),
  dataOsservazioniPreavviso: z.string().optional(),
  valutazioneOsservazioniPreavviso: z.string().trim().optional(),
  motivazioneMancatoPreavviso: z.string().trim().optional(),
  noteChecklistContraddittorio: z.string().trim().optional(),
  noteIstruttorie: z.string().trim().optional(),
});

const updateProcedimentoChecklistSchema = z.object({
  procedimentoId: z.string().min(1, "Procedimento non valido."),
  origineProcedimento: z.enum(PROCEDIMENTO_ORIGINE_VALUES),
  procedimentoUfficio: z.boolean(),
  comunicazioneAvvioInviata: z.boolean(),
  dataComunicazioneAvvio: z.string().optional(),
  termineMemorieGiorni: z.number().int().positive().optional(),
  termineMemorieScadenza: z.string().optional(),
  memorieRicevute: z.boolean(),
  dataRicezioneMemorie: z.string().optional(),
  audizioneRichiesta: z.boolean(),
  audizioneSvolta: z.boolean(),
  dataAudizione: z.string().optional(),
  sopralluogoIstruttorioSvolto: z.boolean(),
  contestazioneFormaleInviata: z.boolean(),
  dataContestazioneFormale: z.string().optional(),
  controdeduzioniValutate: z.boolean(),
  motivazioneValutazione: z.string().trim().optional(),
  propostaEsitoIstruttorio: z.enum(PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES).optional(),
  preavvisoRigettoApplicabile: z.boolean(),
  statoPreavvisoRigetto: z.enum(PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES),
  dataPreavvisoRigetto: z.string().optional(),
  termineOsservazioniPreavviso: z.string().optional(),
  osservazioniPreavvisoRicevute: z.boolean(),
  dataOsservazioniPreavviso: z.string().optional(),
  valutazioneOsservazioniPreavviso: z.string().trim().optional(),
  motivazioneMancatoPreavviso: z.string().trim().optional(),
  noteChecklistContraddittorio: z.string().trim().optional(),
});

function toDate(value: string | undefined): Date | null {
  if (!value || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data non valida nel procedimento.");
  }

  return parsed;
}

function toNullable(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toOptionalInteger(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed;
}

function toBoolean(value: FormDataEntryValue | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.toString().toLowerCase();
  return normalized === "true" || normalized === "on" || normalized === "1";
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeChecklist(input: {
  tipologia: string;
  origineProcedimento: (typeof PROCEDIMENTO_ORIGINE_VALUES)[number];
  procedimentoUfficio: boolean;
  comunicazioneAvvioInviata: boolean;
  dataComunicazioneAvvio?: string;
  termineMemorieGiorni?: number;
  termineMemorieScadenza?: string;
  memorieRicevute: boolean;
  dataRicezioneMemorie?: string;
  audizioneRichiesta: boolean;
  audizioneSvolta: boolean;
  dataAudizione?: string;
  sopralluogoIstruttorioSvolto: boolean;
  contestazioneFormaleInviata: boolean;
  dataContestazioneFormale?: string;
  controdeduzioniValutate: boolean;
  motivazioneValutazione?: string;
  propostaEsitoIstruttorio?: (typeof PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES)[number];
  preavvisoRigettoApplicabile: boolean;
  statoPreavvisoRigetto: (typeof PROCEDIMENTO_STATO_PREAVVISO_RIGETTO_VALUES)[number];
  dataPreavvisoRigetto?: string;
  termineOsservazioniPreavviso?: string;
  osservazioniPreavvisoRicevute: boolean;
  dataOsservazioniPreavviso?: string;
  valutazioneOsservazioniPreavviso?: string;
  motivazioneMancatoPreavviso?: string;
  noteChecklistContraddittorio?: string;
}) {
  const dataComunicazioneAvvio = toDate(input.dataComunicazioneAvvio);
  const termineMemorieScadenzaManuale = toDate(input.termineMemorieScadenza);
  const termineMemorieScadenza =
    termineMemorieScadenzaManuale ??
    (dataComunicazioneAvvio && input.termineMemorieGiorni
      ? addDays(dataComunicazioneAvvio, input.termineMemorieGiorni)
      : null);
  const dataRicezioneMemorie = input.memorieRicevute ? toDate(input.dataRicezioneMemorie) : null;
  const dataAudizione = input.audizioneSvolta ? toDate(input.dataAudizione) : null;
  const dataContestazioneFormale = input.contestazioneFormaleInviata
    ? toDate(input.dataContestazioneFormale)
    : null;
  const origineProcedimento = input.origineProcedimento;
  const procedimentoUfficio =
    origineProcedimento === "UFFICIO" ? true : origineProcedimento === "ISTANZA_PARTE" ? false : input.procedimentoUfficio;
  const preavvisoRigettoApplicabile = input.preavvisoRigettoApplicabile;
  const statoPreavvisoRigetto =
    preavvisoRigettoApplicabile && input.statoPreavvisoRigetto === "NON_APPLICABILE"
      ? "APPLICABILE_DA_INVIARE"
      : input.statoPreavvisoRigetto;
  const dataPreavvisoRigetto = preavvisoRigettoApplicabile ? toDate(input.dataPreavvisoRigetto) : null;
  const termineOsservazioniPreavviso = preavvisoRigettoApplicabile
    ? toDate(input.termineOsservazioniPreavviso)
    : null;
  const osservazioniPreavvisoRicevute = preavvisoRigettoApplicabile && input.osservazioniPreavvisoRicevute;
  const dataOsservazioniPreavviso = osservazioniPreavvisoRicevute ? toDate(input.dataOsservazioniPreavviso) : null;
  const valutazioneOsservazioniPreavviso = osservazioniPreavvisoRicevute
    ? toNullable(input.valutazioneOsservazioniPreavviso)
    : null;
  const motivazioneMancatoPreavviso = preavvisoRigettoApplicabile
    ? null
    : toNullable(input.motivazioneMancatoPreavviso);

  const checklistContraddittorioCompleta = isContraddittorioCompleto({
    tipologia: input.tipologia,
    origineProcedimento,
    procedimentoUfficio,
    comunicazioneAvvioInviata: input.comunicazioneAvvioInviata,
    termineMemorieGiorni: input.termineMemorieGiorni ?? null,
    termineMemorieScadenza,
    memorieRicevute: input.memorieRicevute,
    dataRicezioneMemorie,
    audizioneRichiesta: input.audizioneRichiesta,
    audizioneSvolta: input.audizioneSvolta,
    dataAudizione,
    contestazioneFormaleInviata: input.contestazioneFormaleInviata,
    dataContestazioneFormale,
    controdeduzioniValutate: input.controdeduzioniValutate,
    motivazioneValutazione: toNullable(input.motivazioneValutazione),
    propostaEsitoIstruttorio: input.propostaEsitoIstruttorio ?? null,
    preavvisoRigettoApplicabile,
    statoPreavvisoRigetto,
    dataPreavvisoRigetto,
    termineOsservazioniPreavviso,
    osservazioniPreavvisoRicevute,
    dataOsservazioniPreavviso,
    valutazioneOsservazioniPreavviso,
    motivazioneMancatoPreavviso,
  });

  return {
    origineProcedimento,
    procedimentoUfficio,
    comunicazioneAvvioInviata: input.comunicazioneAvvioInviata,
    dataComunicazioneAvvio,
    termineMemorieGiorni: input.termineMemorieGiorni ?? null,
    termineMemorieScadenza,
    memorieRicevute: input.memorieRicevute,
    dataRicezioneMemorie,
    audizioneRichiesta: input.audizioneRichiesta,
    audizioneSvolta: input.audizioneSvolta,
    dataAudizione,
    sopralluogoIstruttorioSvolto: input.sopralluogoIstruttorioSvolto,
    contestazioneFormaleInviata: input.contestazioneFormaleInviata,
    dataContestazioneFormale,
    controdeduzioniValutate: input.controdeduzioniValutate,
    motivazioneValutazione: toNullable(input.motivazioneValutazione),
    propostaEsitoIstruttorio: input.propostaEsitoIstruttorio ?? null,
    preavvisoRigettoApplicabile,
    statoPreavvisoRigetto,
    dataPreavvisoRigetto,
    termineOsservazioniPreavviso,
    osservazioniPreavvisoRicevute,
    dataOsservazioniPreavviso,
    valutazioneOsservazioniPreavviso,
    motivazioneMancatoPreavviso,
    checklistContraddittorioCompleta,
    noteChecklistContraddittorio: toNullable(input.noteChecklistContraddittorio),
  };
}

export async function createProcedimentoAction(formData: FormData) {
  const role = await requireRole();
  const tenantContext = await getCurrentTenantContext();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CREATE",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManageProcedimenti(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CREATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato alla gestione dei procedimenti.");
  }

  const parsed = createProcedimentoSchema.safeParse({
    concessioneId: formData.get("concessioneId"),
    criticitaId: formData.get("criticitaId")?.toString(),
    tipologia: formData.get("tipologia"),
    origineProcedimento: formData.get("origineProcedimento") ?? "UFFICIO",
    procedimentoUfficio: toBoolean(formData.get("procedimentoUfficio")),
    stato: formData.get("stato"),
    riferimentoNormativo: formData.get("riferimentoNormativo")?.toString(),
    dataAvvio: formData.get("dataAvvio")?.toString(),
    dataScadenzaContraddittorio: formData.get("dataScadenzaContraddittorio")?.toString(),
    comunicazioneAvvioInviata: toBoolean(formData.get("comunicazioneAvvioInviata")),
    dataComunicazioneAvvio: formData.get("dataComunicazioneAvvio")?.toString(),
    termineMemorieGiorni: toOptionalInteger(formData.get("termineMemorieGiorni")?.toString()),
    termineMemorieScadenza: formData.get("termineMemorieScadenza")?.toString(),
    memorieRicevute: toBoolean(formData.get("memorieRicevute")),
    dataRicezioneMemorie: formData.get("dataRicezioneMemorie")?.toString(),
    audizioneRichiesta: toBoolean(formData.get("audizioneRichiesta")),
    audizioneSvolta: toBoolean(formData.get("audizioneSvolta")),
    dataAudizione: formData.get("dataAudizione")?.toString(),
    sopralluogoIstruttorioSvolto: toBoolean(formData.get("sopralluogoIstruttorioSvolto")),
    contestazioneFormaleInviata: toBoolean(formData.get("contestazioneFormaleInviata")),
    dataContestazioneFormale: formData.get("dataContestazioneFormale")?.toString(),
    controdeduzioniValutate: toBoolean(formData.get("controdeduzioniValutate")),
    motivazioneValutazione: formData.get("motivazioneValutazione")?.toString(),
    propostaEsitoIstruttorio: toNullable(formData.get("propostaEsitoIstruttorio")?.toString()) ?? undefined,
    preavvisoRigettoApplicabile: toBoolean(formData.get("preavvisoRigettoApplicabile")),
    statoPreavvisoRigetto: formData.get("statoPreavvisoRigetto") ?? "NON_VALUTATO",
    dataPreavvisoRigetto: formData.get("dataPreavvisoRigetto")?.toString(),
    termineOsservazioniPreavviso: formData.get("termineOsservazioniPreavviso")?.toString(),
    osservazioniPreavvisoRicevute: toBoolean(formData.get("osservazioniPreavvisoRicevute")),
    dataOsservazioniPreavviso: formData.get("dataOsservazioniPreavviso")?.toString(),
    valutazioneOsservazioniPreavviso: formData.get("valutazioneOsservazioniPreavviso")?.toString(),
    motivazioneMancatoPreavviso: formData.get("motivazioneMancatoPreavviso")?.toString(),
    noteChecklistContraddittorio: formData.get("noteChecklistContraddittorio")?.toString(),
    noteIstruttorie: formData.get("noteIstruttorie")?.toString(),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "PROCEDIMENTO_CREATE",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  if (tenantContext) {
    try {
      await requireConcessioneTenantAccess(tenantContext, parsed.data.concessioneId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Procedimento",
        concessioneId: parsed.data.concessioneId,
        actor: { userRole: role },
        metadata: {
          actionType: "PROCEDIMENTO_CREATE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  const criticitaId = parsed.data.criticitaId?.trim() ? parsed.data.criticitaId : null;

  if (criticitaId) {
    const linked = await prisma.criticita.findUnique({
      where: { id: criticitaId },
      select: { concessioneId: true },
    });

    if (!linked || linked.concessioneId !== parsed.data.concessioneId) {
      await auditFailure({
        azione: "PROCEDIMENTO_CREATE",
        entita: "Procedimento",
        concessioneId: parsed.data.concessioneId,
        actor: { userRole: role },
        metadata: {
          reason: "CRITICITA_CONCESSIONE_MISMATCH",
          criticitaId,
        },
      });
      throw new Error("La criticità selezionata non appartiene alla concessione indicata.");
    }
  }

  const checklistData = normalizeChecklist({
    tipologia: parsed.data.tipologia,
    origineProcedimento: parsed.data.origineProcedimento,
    procedimentoUfficio: parsed.data.procedimentoUfficio,
    comunicazioneAvvioInviata: parsed.data.comunicazioneAvvioInviata,
    dataComunicazioneAvvio: parsed.data.dataComunicazioneAvvio,
    termineMemorieGiorni: parsed.data.termineMemorieGiorni,
    termineMemorieScadenza: parsed.data.termineMemorieScadenza,
    memorieRicevute: parsed.data.memorieRicevute,
    dataRicezioneMemorie: parsed.data.dataRicezioneMemorie,
    audizioneRichiesta: parsed.data.audizioneRichiesta,
    audizioneSvolta: parsed.data.audizioneSvolta,
    dataAudizione: parsed.data.dataAudizione,
    sopralluogoIstruttorioSvolto: parsed.data.sopralluogoIstruttorioSvolto,
    contestazioneFormaleInviata: parsed.data.contestazioneFormaleInviata,
    dataContestazioneFormale: parsed.data.dataContestazioneFormale,
    controdeduzioniValutate: parsed.data.controdeduzioniValutate,
    motivazioneValutazione: parsed.data.motivazioneValutazione,
    propostaEsitoIstruttorio: parsed.data.propostaEsitoIstruttorio,
    preavvisoRigettoApplicabile: parsed.data.preavvisoRigettoApplicabile,
    statoPreavvisoRigetto: parsed.data.statoPreavvisoRigetto,
    dataPreavvisoRigetto: parsed.data.dataPreavvisoRigetto,
    termineOsservazioniPreavviso: parsed.data.termineOsservazioniPreavviso,
    osservazioniPreavvisoRicevute: parsed.data.osservazioniPreavvisoRicevute,
    dataOsservazioniPreavviso: parsed.data.dataOsservazioniPreavviso,
    valutazioneOsservazioniPreavviso: parsed.data.valutazioneOsservazioniPreavviso,
    motivazioneMancatoPreavviso: parsed.data.motivazioneMancatoPreavviso,
    noteChecklistContraddittorio: parsed.data.noteChecklistContraddittorio,
  });

  const created = await prisma.procedimento.create({
    data: {
      concessioneId: parsed.data.concessioneId,
      criticitaId,
      tipologia: parsed.data.tipologia,
      stato: parsed.data.stato,
      riferimentoNormativo: toNullable(parsed.data.riferimentoNormativo),
      dataAvvio: toDate(parsed.data.dataAvvio),
      dataScadenzaContraddittorio: toDate(parsed.data.dataScadenzaContraddittorio),
      ...checklistData,
      noteIstruttorie: toNullable(parsed.data.noteIstruttorie),
    },
    select: {
      id: true,
      concessioneId: true,
    },
  });

  await auditSuccess({
    azione: "PROCEDIMENTO_CREATE",
    entita: "Procedimento",
    entitaId: created.id,
    concessioneId: created.concessioneId,
    actor: { userRole: role },
    metadata: {
      tipologia: parsed.data.tipologia,
      stato: parsed.data.stato,
      criticitaId,
      origineProcedimento: checklistData.origineProcedimento,
      procedimentoUfficio: checklistData.procedimentoUfficio,
      hasContraddittorioDate: Boolean(parsed.data.dataScadenzaContraddittorio),
      checklistContraddittorioCompleta: checklistData.checklistContraddittorioCompleta,
      propostaEsitoIstruttorio: checklistData.propostaEsitoIstruttorio,
      preavvisoRigettoApplicabile: checklistData.preavvisoRigettoApplicabile,
      statoPreavvisoRigetto: checklistData.statoPreavvisoRigetto,
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${created.id}`);
  revalidatePath(`/concessioni/${created.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${created.id}`);
}

export async function updateProcedimentoChecklistAction(formData: FormData) {
  const role = await requireRole();
  const tenantContext = await getCurrentTenantContext();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CHECKLIST_UPDATE",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManageProcedimenti(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CHECKLIST_UPDATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato all aggiornamento checklist procedimento.");
  }

  const parsed = updateProcedimentoChecklistSchema.safeParse({
    procedimentoId: formData.get("procedimentoId"),
    origineProcedimento: formData.get("origineProcedimento") ?? "UFFICIO",
    procedimentoUfficio: toBoolean(formData.get("procedimentoUfficio")),
    comunicazioneAvvioInviata: toBoolean(formData.get("comunicazioneAvvioInviata")),
    dataComunicazioneAvvio: formData.get("dataComunicazioneAvvio")?.toString(),
    termineMemorieGiorni: toOptionalInteger(formData.get("termineMemorieGiorni")?.toString()),
    termineMemorieScadenza: formData.get("termineMemorieScadenza")?.toString(),
    memorieRicevute: toBoolean(formData.get("memorieRicevute")),
    dataRicezioneMemorie: formData.get("dataRicezioneMemorie")?.toString(),
    audizioneRichiesta: toBoolean(formData.get("audizioneRichiesta")),
    audizioneSvolta: toBoolean(formData.get("audizioneSvolta")),
    dataAudizione: formData.get("dataAudizione")?.toString(),
    sopralluogoIstruttorioSvolto: toBoolean(formData.get("sopralluogoIstruttorioSvolto")),
    contestazioneFormaleInviata: toBoolean(formData.get("contestazioneFormaleInviata")),
    dataContestazioneFormale: formData.get("dataContestazioneFormale")?.toString(),
    controdeduzioniValutate: toBoolean(formData.get("controdeduzioniValutate")),
    motivazioneValutazione: formData.get("motivazioneValutazione")?.toString(),
    propostaEsitoIstruttorio: toNullable(formData.get("propostaEsitoIstruttorio")?.toString()) ?? undefined,
    preavvisoRigettoApplicabile: toBoolean(formData.get("preavvisoRigettoApplicabile")),
    statoPreavvisoRigetto: formData.get("statoPreavvisoRigetto") ?? "NON_VALUTATO",
    dataPreavvisoRigetto: formData.get("dataPreavvisoRigetto")?.toString(),
    termineOsservazioniPreavviso: formData.get("termineOsservazioniPreavviso")?.toString(),
    osservazioniPreavvisoRicevute: toBoolean(formData.get("osservazioniPreavvisoRicevute")),
    dataOsservazioniPreavviso: formData.get("dataOsservazioniPreavviso")?.toString(),
    valutazioneOsservazioniPreavviso: formData.get("valutazioneOsservazioniPreavviso")?.toString(),
    motivazioneMancatoPreavviso: formData.get("motivazioneMancatoPreavviso")?.toString(),
    noteChecklistContraddittorio: formData.get("noteChecklistContraddittorio")?.toString(),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "PROCEDIMENTO_CHECKLIST_UPDATE",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati checklist non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati checklist non validi.");
  }

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: parsed.data.procedimentoId },
    select: { id: true, concessioneId: true, tipologia: true },
  });

  if (!procedimento) {
    await auditFailure({
      azione: "PROCEDIMENTO_CHECKLIST_UPDATE",
      entita: "Procedimento",
      entitaId: parsed.data.procedimentoId,
      actor: { userRole: role },
      metadata: {
        reason: "PROCEDIMENTO_NOT_FOUND",
      },
    });
    throw new Error("Procedimento non trovato.");
  }

  if (tenantContext) {
    try {
      await requireConcessioneTenantAccess(tenantContext, procedimento.concessioneId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Procedimento",
        entitaId: procedimento.id,
        concessioneId: procedimento.concessioneId,
        actor: { userRole: role },
        metadata: {
          actionType: "PROCEDIMENTO_CHECKLIST_UPDATE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  const checklistData = normalizeChecklist({
    tipologia: procedimento.tipologia,
    origineProcedimento: parsed.data.origineProcedimento,
    procedimentoUfficio: parsed.data.procedimentoUfficio,
    comunicazioneAvvioInviata: parsed.data.comunicazioneAvvioInviata,
    dataComunicazioneAvvio: parsed.data.dataComunicazioneAvvio,
    termineMemorieGiorni: parsed.data.termineMemorieGiorni,
    termineMemorieScadenza: parsed.data.termineMemorieScadenza,
    memorieRicevute: parsed.data.memorieRicevute,
    dataRicezioneMemorie: parsed.data.dataRicezioneMemorie,
    audizioneRichiesta: parsed.data.audizioneRichiesta,
    audizioneSvolta: parsed.data.audizioneSvolta,
    dataAudizione: parsed.data.dataAudizione,
    sopralluogoIstruttorioSvolto: parsed.data.sopralluogoIstruttorioSvolto,
    contestazioneFormaleInviata: parsed.data.contestazioneFormaleInviata,
    dataContestazioneFormale: parsed.data.dataContestazioneFormale,
    controdeduzioniValutate: parsed.data.controdeduzioniValutate,
    motivazioneValutazione: parsed.data.motivazioneValutazione,
    propostaEsitoIstruttorio: parsed.data.propostaEsitoIstruttorio,
    preavvisoRigettoApplicabile: parsed.data.preavvisoRigettoApplicabile,
    statoPreavvisoRigetto: parsed.data.statoPreavvisoRigetto,
    dataPreavvisoRigetto: parsed.data.dataPreavvisoRigetto,
    termineOsservazioniPreavviso: parsed.data.termineOsservazioniPreavviso,
    osservazioniPreavvisoRicevute: parsed.data.osservazioniPreavvisoRicevute,
    dataOsservazioniPreavviso: parsed.data.dataOsservazioniPreavviso,
    valutazioneOsservazioniPreavviso: parsed.data.valutazioneOsservazioniPreavviso,
    motivazioneMancatoPreavviso: parsed.data.motivazioneMancatoPreavviso,
    noteChecklistContraddittorio: parsed.data.noteChecklistContraddittorio,
  });

  await prisma.procedimento.update({
    where: { id: procedimento.id },
    data: checklistData,
  });

  await auditSuccess({
    azione: "PROCEDIMENTO_CHECKLIST_UPDATE",
    entita: "Procedimento",
    entitaId: procedimento.id,
    concessioneId: procedimento.concessioneId,
    actor: { userRole: role },
    metadata: {
      checklistContraddittorioCompleta: checklistData.checklistContraddittorioCompleta,
      propostaEsitoIstruttorio: checklistData.propostaEsitoIstruttorio,
      origineProcedimento: checklistData.origineProcedimento,
      procedimentoUfficio: checklistData.procedimentoUfficio,
      preavvisoRigettoApplicabile: checklistData.preavvisoRigettoApplicabile,
      statoPreavvisoRigetto: checklistData.statoPreavvisoRigetto,
      changedFields: [
        "origineProcedimento",
        "procedimentoUfficio",
        "comunicazioneAvvioInviata",
        "termineMemorieGiorni",
        "termineMemorieScadenza",
        "memorieRicevute",
        "audizioneRichiesta",
        "audizioneSvolta",
        "sopralluogoIstruttorioSvolto",
        "contestazioneFormaleInviata",
        "controdeduzioniValutate",
        "motivazioneValutazione",
        "propostaEsitoIstruttorio",
        "preavvisoRigettoApplicabile",
        "statoPreavvisoRigetto",
        "dataPreavvisoRigetto",
        "termineOsservazioniPreavviso",
        "osservazioniPreavvisoRicevute",
        "dataOsservazioniPreavviso",
        "valutazioneOsservazioniPreavviso",
        "motivazioneMancatoPreavviso",
      ],
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${procedimento.id}`);
  revalidatePath(`/concessioni/${procedimento.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${procedimento.id}`);
}
