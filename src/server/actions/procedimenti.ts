"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, canRegisterProcedimentoDecision, getCurrentUser, requireRole } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { isContraddittorioCompleto } from "@/lib/procedimento-checklist";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess } from "@/lib/tenant-auth";
import { computeAuditHash, sanitizeMetadata } from "@/server/audit/hash";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { getAuditRequestContext } from "@/server/audit/requestContext";
import {
  applyRegisteredDecisionEffect,
  auditAlreadyAppliedDecisionEffect,
} from "@/server/procedimenti/applyRegisteredDecisionEffect";
import {
  DECISIONE_PROCEDIMENTO_TIPO_VALUES,
  getDecisionRulePreviewForTipologia,
  resolveDecisionOutcome,
} from "@/server/procedimenti/decisioni";
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
  responsabileProcedimentoNome: z.string().trim().optional(),
  responsabileProcedimentoEmail: z.string().trim().optional(),
  unitaOrganizzativaResponsabile: z.string().trim().optional(),
  responsabileAssegnatoAt: z.string().optional(),
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

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

function resolveAssignmentRegisteredByUserId(currentUserId: string | null | undefined): string | null {
  if (!currentUserId || currentUserId === STAGING_PREVIEW_ADMIN_ID) {
    return null;
  }

  return currentUserId;
}

function requiredTrimmedString(message: string, maxLength?: number) {
  const base = z.string().trim().min(1, message);
  const constrained = typeof maxLength === "number" ? base.max(maxLength, message) : base;

  return z.preprocess((value) => {
    if (typeof value === "string") {
      return value;
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }, constrained);
}

const reassignProcedimentoResponsabileSchema = z.object({
  procedimentoId: z.string().min(1, "Procedimento non valido."),
  responsabileNome: requiredTrimmedString("RESPONSABILE_PROCEDIMENTO_MANCANTE", 180),
  responsabileEmail: z.string().trim().optional(),
  unitaOrganizzativa: requiredTrimmedString("UNITA_ORGANIZZATIVA_MANCANTE", 180),
  decorrenza: requiredTrimmedString("DATA_ASSEGNAZIONE_INVALIDA"),
  motivoAssegnazione: z.string().trim().optional(),
});

const finalizeProcedimentoDecisionSchema = z.object({
  procedimentoId: z.string().min(1, "Procedimento non valido."),
  decisionType: z.enum(DECISIONE_PROCEDIMENTO_TIPO_VALUES, {
    message: "Tipo decisione non valido.",
  }),
  numeroAtto: requiredTrimmedString("NUMERO_ATTO_MANCANTE", 120),
  protocolloAtto: requiredTrimmedString("PROTOCOLLO_ATTO_MANCANTE", 180),
  dataAtto: requiredTrimmedString("DATA_ATTO_MANCANTE"),
  dataEfficacia: requiredTrimmedString("DATA_EFFICACIA_MANCANTE"),
  organoCompetente: requiredTrimmedString("ORGANO_COMPETENTE_MANCANTE", 180),
  adottanteNome: z.string().trim().optional(),
  adottanteQualifica: z.string().trim().optional(),
  scostamentoDaIstruttoria: z.boolean(),
  motivazioneScostamentoIstruttoria: z.string().trim().optional(),
  motivazioneSintetica: z.string().trim().min(1, "Motivazione sintetica obbligatoria.").max(2000),
  documentoId: requiredTrimmedString("DOCUMENTO_ATTO_MANCANTE"),
  confermaFinalizzazione: z.literal("CONFIRMO_REGISTRAZIONE_ATTO", {
    message: "Conferma esplicita obbligatoria.",
  }),
});

function toIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data non valida.");
  }
  return parsed;
}

function toAssignmentDate(value: string): Date {
  try {
    return toIsoDate(value);
  } catch {
    throw new Error("DATA_ASSEGNAZIONE_INVALIDA");
  }
}

function buildDecisionIdempotencyKey(input: {
  procedimentoId: string;
  decisionType: string;
  numeroAtto: string;
  dataAtto: Date;
  dataEfficacia: Date;
}): string {
  const payload = `${input.procedimentoId}|${input.decisionType}|${input.numeroAtto}|${input.dataAtto.toISOString()}|${input.dataEfficacia.toISOString()}`;
  return createHash("sha256").update(payload).digest("hex");
}

function computeInitialEffectStatus(input: {
  effettoTitolo: "NESSUNO" | "CONCESSIONE_DECADUTA" | "CONCESSIONE_REVOCATA";
  dataEfficacia: Date;
  now: Date;
}): "NON_PREVISTO" | "PENDENTE" | "PRONTO" {
  if (input.effettoTitolo === "NESSUNO") {
    return "NON_PREVISTO";
  }

  if (input.dataEfficacia.getTime() > input.now.getTime()) {
    return "PENDENTE";
  }

  return "PRONTO";
}

type P2002Target = "procedimentoId" | "idempotencyKey";

class FinalizeDecisionApplyError extends Error {
  public readonly decisioneRegistrata = true;
  public readonly effettoApplicato = false;

  constructor(
    public readonly codiceErrore: string,
    public readonly statoEffetto: "NON_PREVISTO" | "PENDENTE" | "PRONTO" | "APPLICATO" | "BLOCCATO" | "ERRORE",
    public readonly decisioneId: string,
    cause?: unknown,
  ) {
    super(codiceErrore, { cause });
    this.name = "FinalizeDecisionApplyError";
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return normalizeOptionalString(value) !== null;
}

function extractP2002Targets(error: Prisma.PrismaClientKnownRequestError): P2002Target[] {
  const meta = error.meta as { target?: unknown } | undefined;
  const rawTarget = meta?.target;

  const targetValues: string[] = [];
  if (Array.isArray(rawTarget)) {
    for (const item of rawTarget) {
      if (typeof item === "string") {
        targetValues.push(item);
      }
    }
  } else if (typeof rawTarget === "string") {
    targetValues.push(rawTarget);
  }

  const joined = targetValues.join("|").toLowerCase();
  const targets: P2002Target[] = [];

  if (joined.includes("procedimentoid")) {
    targets.push("procedimentoId");
  }

  if (joined.includes("idempotencykey")) {
    targets.push("idempotencyKey");
  }

  return targets;
}

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
  const currentUser = await getCurrentUser();

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
    responsabileProcedimentoNome: formData.get("responsabileProcedimentoNome")?.toString(),
    responsabileProcedimentoEmail: formData.get("responsabileProcedimentoEmail")?.toString(),
    unitaOrganizzativaResponsabile: formData.get("unitaOrganizzativaResponsabile")?.toString(),
    responsabileAssegnatoAt: formData.get("responsabileAssegnatoAt")?.toString(),
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

  const responsabileNome = toNullable(parsed.data.responsabileProcedimentoNome);
  const unitaOrganizzativa = toNullable(parsed.data.unitaOrganizzativaResponsabile);
  const responsabileAssegnatoAt = toDate(parsed.data.responsabileAssegnatoAt);
  const createInitialAssignment = Boolean(responsabileNome && unitaOrganizzativa && responsabileAssegnatoAt);
  const registeredByUserId = resolveAssignmentRegisteredByUserId(currentUser?.id);

  const created = await prisma.$transaction(async (tx) => {
    const createdProcedimento = await tx.procedimento.create({
      data: {
        concessioneId: parsed.data.concessioneId,
        criticitaId,
        responsabileProcedimentoNome: responsabileNome,
        responsabileProcedimentoEmail: toNullable(parsed.data.responsabileProcedimentoEmail),
        unitaOrganizzativaResponsabile: unitaOrganizzativa,
        responsabileAssegnatoAt,
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

    if (createInitialAssignment && responsabileNome && unitaOrganizzativa && responsabileAssegnatoAt) {
      await tx.procedimentoResponsabileAssignment.create({
        data: {
          procedimentoId: createdProcedimento.id,
          responsabileNome,
          responsabileEmail: toNullable(parsed.data.responsabileProcedimentoEmail),
          unitaOrganizzativa,
          decorrenza: responsabileAssegnatoAt,
          registeredByUserId,
        },
      });
    }

    return createdProcedimento;
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
      initialResponsibilityAssignmentCreated: createInitialAssignment,
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${created.id}`);
  revalidatePath(`/concessioni/${created.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${created.id}`);
}

export async function reassignProcedimentoResponsabileAction(formData: FormData) {
  const role = await requireRole();
  const tenantContext = await getCurrentTenantContext();
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    throw new Error("Utente autenticato non disponibile.");
  }

  const registeredByUserId = resolveAssignmentRegisteredByUserId(currentUser.id);

  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla gestione dei procedimenti.");
  }

  const parsed = reassignProcedimentoResponsabileSchema.safeParse({
    procedimentoId: formData.get("procedimentoId"),
    responsabileNome: formData.get("responsabileNome"),
    responsabileEmail: formData.get("responsabileEmail")?.toString(),
    unitaOrganizzativa: formData.get("unitaOrganizzativa"),
    decorrenza: formData.get("decorrenza"),
    motivoAssegnazione: formData.get("motivoAssegnazione")?.toString(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati assegnazione non validi.");
  }

  const decorrenza = toAssignmentDate(parsed.data.decorrenza);
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: parsed.data.procedimentoId },
    select: {
      id: true,
      concessioneId: true,
      responsabileProcedimentoNome: true,
      responsabileProcedimentoEmail: true,
      unitaOrganizzativaResponsabile: true,
      responsabileAssegnatoAt: true,
    },
  });

  if (!procedimento) {
    throw new Error("Procedimento non trovato.");
  }

  if (tenantContext) {
    await requireConcessioneTenantAccess(tenantContext, procedimento.concessioneId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  }

  try {
    const assignmentResult = await prisma.$transaction(async (tx) => {
      const activeAssignment = await tx.procedimentoResponsabileAssignment.findFirst({
        where: { procedimentoId: procedimento.id, cessazione: null },
        orderBy: { decorrenza: "desc" },
      });

      if (activeAssignment && decorrenza < activeAssignment.decorrenza) {
        throw new Error("DATA_RIASSEGNAZIONE_ANTECEDENTE");
      }

      if (activeAssignment) {
        const closed = await tx.procedimentoResponsabileAssignment.updateMany({
          where: { id: activeAssignment.id, cessazione: null },
          data: { cessazione: decorrenza },
        });

        if (closed.count !== 1) {
          throw new Error("RIASSEGNAZIONE_CONCORRENTE");
        }
      }

      let legacySnapshotNotReconstructable = false;
      if (!activeAssignment) {
        const responsabileNome = normalizeOptionalString(procedimento.responsabileProcedimentoNome);
        const responsabileEmail = normalizeOptionalString(procedimento.responsabileProcedimentoEmail);
        const unitaOrganizzativa = normalizeOptionalString(procedimento.unitaOrganizzativaResponsabile);
        const decorrenzaLegacy = procedimento.responsabileAssegnatoAt;

        if (responsabileNome && unitaOrganizzativa && decorrenzaLegacy) {
          if (decorrenza < decorrenzaLegacy) {
            throw new Error("DATA_RIASSEGNAZIONE_ANTECEDENTE");
          }

          await tx.procedimentoResponsabileAssignment.create({
            data: {
              procedimentoId: procedimento.id,
              responsabileNome,
              responsabileEmail,
              unitaOrganizzativa,
              decorrenza: decorrenzaLegacy,
              cessazione: decorrenza,
              comunicataAt: null,
              registeredByUserId: null,
            },
          });
        } else {
          legacySnapshotNotReconstructable = true;
        }
      }

      await tx.procedimentoResponsabileAssignment.create({
        data: {
          procedimentoId: procedimento.id,
          responsabileNome: parsed.data.responsabileNome,
          responsabileEmail: toNullable(parsed.data.responsabileEmail),
          unitaOrganizzativa: parsed.data.unitaOrganizzativa,
          decorrenza,
          motivoAssegnazione: toNullable(parsed.data.motivoAssegnazione),
          registeredByUserId,
        },
      });

      await tx.procedimento.update({
        where: { id: procedimento.id },
        data: {
          responsabileProcedimentoNome: parsed.data.responsabileNome,
          responsabileProcedimentoEmail: toNullable(parsed.data.responsabileEmail),
          unitaOrganizzativaResponsabile: parsed.data.unitaOrganizzativa,
          responsabileAssegnatoAt: decorrenza,
        },
      });

      return { legacySnapshotNotReconstructable };
    });

    if (assignmentResult.legacySnapshotNotReconstructable) {
      await auditSuccess({
        azione: "STORICO_RESPONSABILE_PRECEDENTE_NON_RICOSTRUIBILE",
        entita: "Procedimento",
        entitaId: procedimento.id,
        concessioneId: procedimento.concessioneId,
        actor: { userId: registeredByUserId, userEmail: currentUser.email, userRole: role },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("RIASSEGNAZIONE_CONCORRENTE");
    }
    throw error;
  }

  await auditSuccess({
    azione: "PROCEDIMENTO_RESPONSABILE_RIASSEGNATO",
    entita: "Procedimento",
    entitaId: procedimento.id,
    concessioneId: procedimento.concessioneId,
    actor: { userId: registeredByUserId, userEmail: currentUser.email, userRole: role },
    metadata: {
      responsabileNome: parsed.data.responsabileNome,
      unitaOrganizzativa: parsed.data.unitaOrganizzativa,
      decorrenza: decorrenza.toISOString(),
      hasMotivoAssegnazione: Boolean(toNullable(parsed.data.motivoAssegnazione)),
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${procedimento.id}`);
  revalidatePath(`/concessioni/${procedimento.concessioneId}`);
  redirect(`/procedimenti/${procedimento.id}`);
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

export async function finalizeProcedimentoDecisionAction(formData: FormData) {
  const role = await requireRole();
  const tenantContext = await getCurrentTenantContext();
  const currentUser = await getCurrentUser();
  const requestContext = await getAuditRequestContext();

  if (!currentUser?.id) {
    throw new Error("Utente autenticato non disponibile.");
  }

  const persistedUserId = resolveAssignmentRegisteredByUserId(currentUser.id);

  if (!canRegisterProcedimentoDecision(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "DecisioneProcedimento",
      actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_DECISION_FINALIZE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    if (role === "VIEWER_ADSP") {
      redirect("/adsp");
    }
    throw new Error("Profilo non autorizzato alla registrazione della decisione conclusiva.");
  }

  const parsed = finalizeProcedimentoDecisionSchema.safeParse({
    procedimentoId: formData.get("procedimentoId"),
    decisionType: formData.get("decisionType"),
    numeroAtto: formData.get("numeroAtto"),
    protocolloAtto: formData.get("protocolloAtto"),
    dataAtto: formData.get("dataAtto"),
    dataEfficacia: formData.get("dataEfficacia"),
    organoCompetente: formData.get("organoCompetente"),
    adottanteNome: formData.get("adottanteNome")?.toString(),
    adottanteQualifica: formData.get("adottanteQualifica")?.toString(),
    scostamentoDaIstruttoria: toBoolean(formData.get("scostamentoDaIstruttoria")),
    motivazioneScostamentoIstruttoria: formData.get("motivazioneScostamentoIstruttoria")?.toString(),
    motivazioneSintetica: formData.get("motivazioneSintetica"),
    documentoId: formData.get("documentoId")?.toString(),
    confermaFinalizzazione: formData.get("confermaFinalizzazione"),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "PROCEDIMENTO_DECISION_FINALIZE",
      entita: "DecisioneProcedimento",
      actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati decisione non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati decisione non validi.");
  }

  const dataAtto = toIsoDate(parsed.data.dataAtto);
  const dataEfficacia = toIsoDate(parsed.data.dataEfficacia);
  if (dataEfficacia < dataAtto) {
    throw new Error("La data di efficacia non puo essere anteriore alla data atto.");
  }

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: parsed.data.procedimentoId },
    select: {
      id: true,
      concessioneId: true,
      tipologia: true,
      stato: true,
      checklistContraddittorioCompleta: true,
      responsabileProcedimentoNome: true,
      unitaOrganizzativaResponsabile: true,
      responsabileAssegnatoAt: true,
      propostaEsitoIstruttorio: true,
      decisioneProcedimento: {
        select: {
          id: true,
        },
      },
      concessione: {
        select: {
          id: true,
          enteId: true,
          stato: true,
        },
      },
    },
  });

  if (!procedimento) {
    await auditFailure({
      azione: "PROCEDIMENTO_DECISION_FINALIZE",
      entita: "DecisioneProcedimento",
      actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
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
        entita: "DecisioneProcedimento",
        entitaId: procedimento.id,
        concessioneId: procedimento.concessioneId,
        enteId: procedimento.concessione.enteId,
        actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
        metadata: {
          actionType: "PROCEDIMENTO_DECISION_FINALIZE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  if (["CONCLUSO", "ARCHIVIATO"].includes(procedimento.stato)) {
    throw new Error("Procedimento gia concluso o archiviato: registrazione decisione non consentita.");
  }

  if (
    !hasNonEmptyText(procedimento.responsabileProcedimentoNome) ||
    !hasNonEmptyText(procedimento.unitaOrganizzativaResponsabile) ||
    !procedimento.responsabileAssegnatoAt
  ) {
    throw new Error("RESPONSABILE_PROCEDIMENTO_MANCANTE");
  }

  if (
    parsed.data.scostamentoDaIstruttoria &&
    !hasNonEmptyText(parsed.data.motivazioneScostamentoIstruttoria)
  ) {
    throw new Error("MOTIVAZIONE_SCOSTAMENTO_ISTRUTTORIA_MANCANTE");
  }

  if (procedimento.decisioneProcedimento) {
    throw new Error("Decisione conclusiva gia registrata per il procedimento.");
  }

  const decisionPreview = getDecisionRulePreviewForTipologia(procedimento.tipologia);
  const outcome = resolveDecisionOutcome({
    tipologiaProcedimento: procedimento.tipologia,
    tipoDecisione: parsed.data.decisionType,
  });

  if (outcome.requiresChecklist && !procedimento.checklistContraddittorioCompleta) {
    throw new Error("Checklist contraddittorio incompleta: finalizzazione non consentita.");
  }

  if (outcome.requiresDocumento && !parsed.data.documentoId) {
    throw new Error("Documento atto conclusivo obbligatorio per la decisione selezionata.");
  }

  const documento = await prisma.documento.findUnique({
    where: { id: parsed.data.documentoId },
    select: {
      id: true,
      concessioneId: true,
      procedimentoId: true,
    },
  });

  if (!documento) {
    throw new Error("Documento indicato non trovato.");
  }

  const linkedToProcedimento = documento.procedimentoId === procedimento.id;
  const linkedToConcessione = documento.concessioneId === procedimento.concessioneId;
  if (!linkedToProcedimento && !linkedToConcessione) {
    throw new Error("Documento non coerente con procedimento o concessione collegata.");
  }

  if (outcome.statoConcessioneSuccessivo && !procedimento.concessioneId) {
    throw new Error("Concessione non collegata: impossibile applicare effetto sul titolo.");
  }

  if (
    outcome.statoConcessioneSuccessivo &&
    ["DECADUTA", "REVOCATA", "ARCHIVIATA"].includes(procedimento.concessione.stato)
  ) {
    throw new Error("Stato concessione incompatibile con l effetto richiesto.");
  }

  const idempotencyKey = buildDecisionIdempotencyKey({
    procedimentoId: procedimento.id,
    decisionType: parsed.data.decisionType,
    numeroAtto: parsed.data.numeroAtto,
    dataAtto,
    dataEfficacia,
  });

  const initialEffectStatus = computeInitialEffectStatus({
    effettoTitolo: outcome.effettoTitolo,
    dataEfficacia,
    now: new Date(),
  });

  let createdDecisionId: string | null = null;
  let createdDecisionEnteId: string | null = procedimento.concessione.enteId;
  let createdDecisionConcessioneId: string | null = procedimento.concessioneId;
  let recoveredFromIdempotentReplay = false;

  try {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.procedimento.findUnique({
        where: { id: procedimento.id },
        select: {
          id: true,
          stato: true,
          tipologia: true,
          checklistContraddittorioCompleta: true,
          responsabileProcedimentoNome: true,
          unitaOrganizzativaResponsabile: true,
          responsabileAssegnatoAt: true,
          concessioneId: true,
          concessione: {
            select: {
              id: true,
              stato: true,
            },
          },
          decisioneProcedimento: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!latest) {
        throw new Error("Procedimento non trovato.");
      }

      if (["CONCLUSO", "ARCHIVIATO"].includes(latest.stato) || latest.decisioneProcedimento) {
        throw new Error("Decisione gia applicata o procedimento gia concluso.");
      }

      if (outcome.requiresChecklist && !latest.checklistContraddittorioCompleta) {
        throw new Error("Checklist contraddittorio incompleta: finalizzazione non consentita.");
      }

      if (
        !hasNonEmptyText(latest.responsabileProcedimentoNome) ||
        !hasNonEmptyText(latest.unitaOrganizzativaResponsabile) ||
        !latest.responsabileAssegnatoAt
      ) {
        throw new Error("RESPONSABILE_PROCEDIMENTO_MANCANTE");
      }

      const createdDecision = await tx.decisioneProcedimento.create({
        data: {
          enteId: procedimento.concessione.enteId,
          procedimentoId: latest.id,
          concessioneId: latest.concessioneId,
          tipoDecisione: parsed.data.decisionType,
          numeroAtto: parsed.data.numeroAtto,
          protocolloAtto: parsed.data.protocolloAtto,
          dataAtto,
          dataEfficacia,
          organoCompetente: parsed.data.organoCompetente,
          adottanteNome: normalizeOptionalString(parsed.data.adottanteNome),
          adottanteQualifica: normalizeOptionalString(parsed.data.adottanteQualifica),
          scostamentoDaIstruttoria: parsed.data.scostamentoDaIstruttoria,
          motivazioneScostamentoIstruttoria: parsed.data.scostamentoDaIstruttoria
            ? normalizeOptionalString(parsed.data.motivazioneScostamentoIstruttoria)
            : null,
          motivazioneSintetica: parsed.data.motivazioneSintetica,
          documentoId: documento?.id ?? null,
          effettoTitolo: outcome.effettoTitolo,
          statoConcessionePrecedente: latest.concessione?.stato ?? null,
          statoConcessioneSuccessivo: outcome.statoConcessioneSuccessivo,
          registeredByUserId: persistedUserId,
          idempotencyKey,
        },
        select: {
          id: true,
          enteId: true,
          concessioneId: true,
        },
      });

      await tx.$executeRaw`
        UPDATE "DecisioneProcedimento"
        SET
          "statoEffetto" = ${initialEffectStatus}::"StatoEffettoProcedimento",
          "effectVersion" = COALESCE("effectVersion", 0)
        WHERE "id" = ${createdDecision.id}
      `;

      await tx.procedimento.update({
        where: { id: latest.id },
        data: {
          stato: outcome.statoFinaleProcedimento,
          dataProvvedimentoFinale: dataAtto,
        },
      });

      createdDecisionId = createdDecision.id;
      createdDecisionEnteId = createdDecision.enteId;
      createdDecisionConcessioneId = createdDecision.concessioneId;

      await tx.activityLog.create({
        data: await (async () => {
          const metadata = sanitizeMetadata({
            procedimentoId: procedimento.id,
            concessioneId: procedimento.concessioneId,
            tipoDecisione: parsed.data.decisionType,
            decisioniConsentite: decisionPreview.map((item) => item.tipoDecisione),
            numeroAtto: parsed.data.numeroAtto,
            protocolloAtto: parsed.data.protocolloAtto,
            organoCompetente: parsed.data.organoCompetente,
            adottanteNome: normalizeOptionalString(parsed.data.adottanteNome),
            adottanteQualifica: normalizeOptionalString(parsed.data.adottanteQualifica),
            scostamentoDaIstruttoria: parsed.data.scostamentoDaIstruttoria,
            registeredByUserId: persistedUserId,
            statoConcessionePrecedente: procedimento.concessione.stato,
            statoConcessioneSuccessivo: outcome.statoConcessioneSuccessivo,
            dataEfficacia: dataEfficacia.toISOString(),
            effettoTitolo: outcome.effettoTitolo,
            statoEffetto: initialEffectStatus,
          });

          const previous = await tx.activityLog.findFirst({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { currentHash: true },
          });

          const createdAt = new Date();
          const previousHash = previous?.currentHash ?? null;
          const currentHash = computeAuditHash({
            previousHash,
            createdAt,
            azione: "DECISIONE_REGISTRATA",
            entita: "DecisioneProcedimento",
            entitaId: createdDecision.id,
            enteId: procedimento.concessione.enteId ?? null,
            concessioneId: procedimento.concessioneId,
            esito: "SUCCESS",
            actor: {
              userId: persistedUserId,
              userEmail: currentUser.email,
              userRole: role,
            },
            metadata,
          });

          return {
            userId: persistedUserId,
            userEmail: currentUser.email,
            userRole: role,
            enteId: procedimento.concessione.enteId,
            concessioneId: procedimento.concessioneId,
            ipAddress: requestContext.ipAddress,
            userAgent: requestContext.userAgent,
            azione: "DECISIONE_REGISTRATA",
            entita: "DecisioneProcedimento",
            entitaId: createdDecision.id,
            esito: "SUCCESS",
            metadata: metadata ?? undefined,
            previousHash,
            currentHash,
            createdAt,
          };
        })(),
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const targets = extractP2002Targets(error);
      if (targets.length === 0) {
        throw new Error("P2002_TARGET_UNRECOGNIZED");
      }

      const findWhere = targets.includes("procedimentoId")
        ? { procedimentoId: procedimento.id }
        : { idempotencyKey };

      const existing = await prisma.decisioneProcedimento.findUnique({
        where: findWhere,
        select: {
          id: true,
          enteId: true,
          procedimentoId: true,
          concessioneId: true,
          tipoDecisione: true,
          numeroAtto: true,
          protocolloAtto: true,
          dataAtto: true,
          dataEfficacia: true,
          documentoId: true,
          organoCompetente: true,
          adottanteNome: true,
          adottanteQualifica: true,
          scostamentoDaIstruttoria: true,
          motivazioneScostamentoIstruttoria: true,
          effettoTitolo: true,
          statoConcessionePrecedente: true,
          statoConcessioneSuccessivo: true,
          idempotencyKey: true,
        },
      });

      if (!existing) {
        throw new Error("P2002_REPLAY_NOT_RECOVERABLE");
      }

      const existingOutcome = resolveDecisionOutcome({
        tipologiaProcedimento: procedimento.tipologia as (typeof PROCEDIMENTO_TIPOLOGIA_VALUES)[number],
        tipoDecisione: existing.tipoDecisione as (typeof DECISIONE_PROCEDIMENTO_TIPO_VALUES)[number],
      });

      const expectedSemantic = {
        procedimentoId: procedimento.id,
        concessioneId: procedimento.concessioneId,
        tipoDecisione: parsed.data.decisionType,
        numeroAtto: parsed.data.numeroAtto,
        protocolloAtto: parsed.data.protocolloAtto,
        dataAttoIso: dataAtto.toISOString(),
        dataEfficaciaIso: dataEfficacia.toISOString(),
        documentoId: documento?.id ?? null,
        organoCompetente: normalizeOptionalString(parsed.data.organoCompetente),
        adottanteNome: normalizeOptionalString(parsed.data.adottanteNome),
        adottanteQualifica: normalizeOptionalString(parsed.data.adottanteQualifica),
        scostamentoDaIstruttoria: parsed.data.scostamentoDaIstruttoria,
        motivazioneScostamentoIstruttoria: parsed.data.scostamentoDaIstruttoria
          ? normalizeOptionalString(parsed.data.motivazioneScostamentoIstruttoria)
          : null,
        esito: outcome.statoFinaleProcedimento,
        effettoTitolo: outcome.effettoTitolo,
        statoConcessionePrecedente: procedimento.concessione.stato,
        statoConcessioneSuccessivo: outcome.statoConcessioneSuccessivo,
      };

      const existingSemantic = {
        procedimentoId: existing.procedimentoId,
        concessioneId: existing.concessioneId,
        tipoDecisione: existing.tipoDecisione,
        numeroAtto: existing.numeroAtto,
        protocolloAtto: normalizeOptionalString(existing.protocolloAtto),
        dataAttoIso: existing.dataAtto.toISOString(),
        dataEfficaciaIso: existing.dataEfficacia.toISOString(),
        documentoId: existing.documentoId,
        organoCompetente: normalizeOptionalString(existing.organoCompetente),
        adottanteNome: normalizeOptionalString(existing.adottanteNome),
        adottanteQualifica: normalizeOptionalString(existing.adottanteQualifica),
        scostamentoDaIstruttoria: existing.scostamentoDaIstruttoria,
        motivazioneScostamentoIstruttoria: normalizeOptionalString(existing.motivazioneScostamentoIstruttoria),
        esito: existingOutcome.statoFinaleProcedimento,
        effettoTitolo: existing.effettoTitolo,
        statoConcessionePrecedente: existing.statoConcessionePrecedente,
        statoConcessioneSuccessivo: existing.statoConcessioneSuccessivo,
      };

      const equivalent =
        existingSemantic.procedimentoId === expectedSemantic.procedimentoId &&
        existingSemantic.concessioneId === expectedSemantic.concessioneId &&
        existingSemantic.tipoDecisione === expectedSemantic.tipoDecisione &&
        existingSemantic.numeroAtto === expectedSemantic.numeroAtto &&
        existingSemantic.protocolloAtto === expectedSemantic.protocolloAtto &&
        existingSemantic.dataAttoIso === expectedSemantic.dataAttoIso &&
        existingSemantic.dataEfficaciaIso === expectedSemantic.dataEfficaciaIso &&
        existingSemantic.documentoId === expectedSemantic.documentoId &&
        existingSemantic.organoCompetente === expectedSemantic.organoCompetente &&
        existingSemantic.adottanteNome === expectedSemantic.adottanteNome &&
        existingSemantic.adottanteQualifica === expectedSemantic.adottanteQualifica &&
        existingSemantic.scostamentoDaIstruttoria === expectedSemantic.scostamentoDaIstruttoria &&
        existingSemantic.motivazioneScostamentoIstruttoria === expectedSemantic.motivazioneScostamentoIstruttoria &&
        existingSemantic.esito === expectedSemantic.esito &&
        existingSemantic.effettoTitolo === expectedSemantic.effettoTitolo &&
        existingSemantic.statoConcessionePrecedente === expectedSemantic.statoConcessionePrecedente &&
        existingSemantic.statoConcessioneSuccessivo === expectedSemantic.statoConcessioneSuccessivo;

      const consistentKey = existing.idempotencyKey === idempotencyKey;
      if (!equivalent || !consistentKey) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }

      await auditSuccess({
        azione: "DECISIONE_REGISTRATA",
        entita: "DecisioneProcedimento",
        entitaId: existing.id,
        concessioneId: existing.concessioneId,
        enteId: existing.enteId,
        actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
        metadata: sanitizeMetadata({
          idempotentReplay: true,
          procedimentoId: procedimento.id,
          decisionType: parsed.data.decisionType,
          p2002Targets: targets,
        }),
      });

      createdDecisionId = existing.id;
      createdDecisionEnteId = existing.enteId;
      createdDecisionConcessioneId = existing.concessioneId;
      recoveredFromIdempotentReplay = true;
    }

    if (recoveredFromIdempotentReplay) {
      // Equivalent duplicate submission is treated as a successful idempotent replay.
    } else {
      await auditFailure({
        azione: "PROCEDIMENTO_DECISION_FINALIZE",
        entita: "DecisioneProcedimento",
        entitaId: procedimento.id,
        concessioneId: procedimento.concessioneId,
        enteId: procedimento.concessione.enteId,
        actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
        metadata: {
          reason: "FINALIZATION_FAILED",
          decisionType: parsed.data.decisionType,
          issue: error instanceof Error ? error.message : "Errore durante finalizzazione.",
        },
      });

      if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }

      if (error instanceof Error && error.message === "P2002_TARGET_UNRECOGNIZED") {
        throw new Error("P2002_TARGET_UNRECOGNIZED");
      }

      if (error instanceof Error && error.message === "P2002_REPLAY_NOT_RECOVERABLE") {
        throw new Error("P2002_REPLAY_NOT_RECOVERABLE");
      }

      throw error;
    }
  }

  if (!createdDecisionId) {
    throw new Error("Registrazione decisione non completata.");
  }

  if (initialEffectStatus === "PENDENTE") {
    await auditSuccess({
      azione: "EFFETTO_PENDENTE",
      entita: "DecisioneProcedimento",
      entitaId: createdDecisionId,
      concessioneId: createdDecisionConcessioneId,
      enteId: createdDecisionEnteId,
      actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
      metadata: sanitizeMetadata({
        dataEfficacia: dataEfficacia.toISOString(),
        note: "Decisione registrata: effetto previsto futuro non ancora applicato.",
      }),
      requestContext,
    });
  }

  if (initialEffectStatus === "PRONTO") {
    await auditSuccess({
      azione: "EFFETTO_PRONTO",
      entita: "DecisioneProcedimento",
      entitaId: createdDecisionId,
      concessioneId: createdDecisionConcessioneId,
      enteId: createdDecisionEnteId,
      actor: { userId: persistedUserId, userEmail: currentUser.email, userRole: role },
      metadata: sanitizeMetadata({
        dataEfficacia: dataEfficacia.toISOString(),
        note: "Effetto pronto per applicazione tecnica separata.",
      }),
      requestContext,
    });

    let applyResult;
    try {
      applyResult = await applyRegisteredDecisionEffect({
        decisioneId: createdDecisionId,
        actor: {
          userId: persistedUserId,
          userEmail: currentUser.email,
          userRole: role,
        },
        tenantContext: tenantContext
          ? {
              isAdmin: tenantContext.isAdmin,
              accessibleTenantIds: tenantContext.accessibleTenantIds,
              role: tenantContext.role,
            }
          : null,
        requestContext,
      });
    } catch (error) {
      const rawCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code ?? "EFFECT_APPLY_FAILED")
          : error instanceof Error
            ? error.message
            : "EFFECT_APPLY_FAILED";

      const persistedStatoEffettoRaw =
        typeof error === "object" &&
        error !== null &&
        "persistedStatoEffetto" in error
          ? (error as { persistedStatoEffetto?: unknown }).persistedStatoEffetto
          : undefined;

      const isKnownStatoEffetto = (value: unknown): value is FinalizeDecisionApplyError["statoEffetto"] =>
        value === "NON_PREVISTO" ||
        value === "PENDENTE" ||
        value === "PRONTO" ||
        value === "APPLICATO" ||
        value === "BLOCCATO" ||
        value === "ERRORE";

      const statoEffetto: FinalizeDecisionApplyError["statoEffetto"] =
        rawCode === "CONCESSIONE_STATE_CONFLICT"
          ? isKnownStatoEffetto(persistedStatoEffettoRaw)
            ? persistedStatoEffettoRaw
            : "PRONTO"
          : "ERRORE";

      throw new FinalizeDecisionApplyError(rawCode, statoEffetto, createdDecisionId, error);
    }

    if (applyResult.status === "ALREADY_APPLIED") {
      await auditAlreadyAppliedDecisionEffect({
        decisioneId: createdDecisionId,
        concessioneId: createdDecisionConcessioneId,
        enteId: createdDecisionEnteId,
        actor: {
          userId: persistedUserId,
          userEmail: currentUser.email,
          userRole: role,
        },
        requestContext,
      });
    }
  }

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${procedimento.id}`);
  revalidatePath(`/concessioni/${procedimento.concessioneId}`);
  revalidatePath("/concessioni");
  revalidatePath("/audit");
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${procedimento.id}`);
}
