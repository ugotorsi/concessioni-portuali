"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { BACKOFFICE_ROLES, canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { CONCESSION_VERTICAL_VALUES } from "@/lib/concession-vertical";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess, requireTenantAccess } from "@/lib/tenant-auth";
import { auditSuccess } from "@/server/audit/auditLog";
import { uploadDocument } from "@/server/documents/uploadService";
import { parseUploadDocumentFormData } from "@/server/documents/validation";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const createFascicoloIntakeSchema = z.object({
  concessioneId: z.string().trim().optional(),
  tipologiaConcessioneIniziale: z.enum(CONCESSION_VERTICAL_VALUES),
  oggettoFascicolo: z.string().trim().min(1, "Indica l'oggetto del fascicolo."),
  denominazioneBreve: z.string().trim().optional(),
  concessionarioIniziale: z.string().trim().optional(),
  enteConcedenteIniziale: z.string().trim().optional(),
  autoritaCompetenteIniziale: z.string().trim().optional(),
  numeroConcessioneIniziale: z.string().trim().optional(),
  dataRilascioIniziale: z.string().optional(),
  decorrenzaIniziale: z.string().optional(),
  scadenzaIniziale: z.string().optional(),
  oggettoConcessioneIniziale: z.string().trim().optional(),
  beneAreaServizioIniziale: z.string().trim().optional(),
  localitaIniziale: z.string().trim().optional(),
  soggettoAssistito: z.string().trim().optional(),
  controparteAmministrazione: z.string().trim().optional(),
  noteIstruttorie: z.string().trim().optional(),
});

function nullable(value: string | undefined): string | null {
  return value?.trim() || null;
}

function optionalDate(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data non valida.");
  }
  return date;
}

export async function createFascicoloIntakeAction(formData: FormData) {
  const role = await requireRole(BACKOFFICE_ROLES);
  if (!canManageProcedimenti(role)) {
    redirect("/procedimenti");
  }

  const parsed = createFascicoloIntakeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati del fascicolo non validi.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }

  const concessioneId = nullable(parsed.data.concessioneId);
  let enteId = tenantContext.defaultTenantId;
  if (concessioneId) {
    await requireConcessioneTenantAccess(tenantContext, concessioneId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
    const concessione = await prisma.concessione.findUnique({
      where: { id: concessioneId },
      select: { enteId: true },
    });
    enteId = concessione?.enteId ?? null;
  }
  if (!enteId) {
    throw new Error("Seleziona un tenant predefinito prima di creare un fascicolo senza concessione collegata.");
  }

  const initialDocuments = formData
    .getAll("documentiIniziali")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (initialDocuments.length > 10) {
    throw new Error("Puoi caricare al massimo 10 documenti iniziali.");
  }

  const created = await prisma.fascicoloIntake.create({
    data: {
      enteId,
      concessioneId,
      tipologiaConcessione: parsed.data.tipologiaConcessioneIniziale,
      oggettoFascicolo: parsed.data.oggettoFascicolo,
      denominazioneBreve: nullable(parsed.data.denominazioneBreve),
      concessionario: nullable(parsed.data.concessionarioIniziale),
      enteConcedente: nullable(parsed.data.enteConcedenteIniziale),
      autoritaCompetente: nullable(parsed.data.autoritaCompetenteIniziale),
      numeroConcessione: nullable(parsed.data.numeroConcessioneIniziale),
      dataRilascio: optionalDate(parsed.data.dataRilascioIniziale),
      decorrenza: optionalDate(parsed.data.decorrenzaIniziale),
      scadenza: optionalDate(parsed.data.scadenzaIniziale),
      oggettoConcessione: nullable(parsed.data.oggettoConcessioneIniziale),
      beneAreaServizio: nullable(parsed.data.beneAreaServizioIniziale),
      localita: nullable(parsed.data.localitaIniziale),
      soggettoAssistito: nullable(parsed.data.soggettoAssistito),
      controparteAmministrazione: nullable(parsed.data.controparteAmministrazione),
      contestoIniziale: nullable(parsed.data.noteIstruttorie),
    },
  });

  const currentUser = await getCurrentUser();
  for (const file of initialDocuments) {
    await uploadDocument({
      documentId: randomUUID(),
      file,
      actor: {
        id: currentUser?.id ?? STAGING_PREVIEW_ADMIN_ID,
        email: currentUser?.email ?? null,
        role,
      },
      enteId,
      concessioneId,
      fascicoloIntakeId: created.id,
      nome: file.name,
      tipologia: "NOTA",
      source: "UPLOAD_UTENTE",
      status: "ATTIVO",
    });
  }

  await auditSuccess({
    azione: "FASCICOLO_INTAKE_CREATE",
    entita: "FascicoloIntake",
    entitaId: created.id,
    enteId,
    concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: { tipologiaConcessione: created.tipologiaConcessione },
  });

  revalidatePath("/procedimenti");
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${created.id}#documenti`);
}

export async function uploadFascicoloIntakeDocumentAction(formData: FormData) {
  const role = await requireRole(BACKOFFICE_ROLES);
  if (!canManageProcedimenti(role)) {
    redirect("/procedimenti");
  }

  const fascicoloIntakeId = z.string().min(1).parse(formData.get("fascicoloIntakeId"));
  const fascicolo = await prisma.fascicoloIntake.findUnique({
    where: { id: fascicoloIntakeId },
    select: { id: true, enteId: true, concessioneId: true },
  });
  if (!fascicolo) {
    throw new Error("Fascicolo non trovato.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  requireTenantAccess(tenantContext, fascicolo.enteId, { mode: "write", allowWhenEnteMissing: false });

  const payload = parseUploadDocumentFormData(formData);
  const currentUser = await getCurrentUser();
  await uploadDocument({
    documentId: randomUUID(),
    file: payload.file,
    actor: {
      id: currentUser?.id ?? STAGING_PREVIEW_ADMIN_ID,
      email: currentUser?.email ?? null,
      role,
    },
    enteId: fascicolo.enteId,
    concessioneId: fascicolo.concessioneId,
    fascicoloIntakeId: fascicolo.id,
    nome: payload.nome,
    tipologia: payload.tipologia,
    descrizione: payload.descrizione,
    dataDocumento: payload.dataDocumento,
    source: payload.source,
    status: payload.status,
    direzione: payload.direzione,
    canale: payload.canale,
    numeroProtocollo: payload.numeroProtocollo,
    dataProtocollo: payload.dataProtocollo,
    mittente: payload.mittente,
    destinatario: payload.destinatario,
    pecMessageId: payload.pecMessageId,
    pecRicevutaAccettazioneId: payload.pecRicevutaAccettazioneId,
    pecRicevutaConsegnaId: payload.pecRicevutaConsegnaId,
    pecWarningMancataRicevuta: payload.pecWarningMancataRicevuta,
  });

  revalidatePath(`/procedimenti/${fascicolo.id}`);
  redirect(`/procedimenti/${fascicolo.id}#documenti`);
}
