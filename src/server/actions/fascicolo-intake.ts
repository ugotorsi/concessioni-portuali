"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { BACKOFFICE_ROLES, canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { CONCESSION_VERTICAL_VALUES } from "@/lib/concession-vertical";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess, requireTenantAccess } from "@/lib/tenant-auth";
import { auditSuccess } from "@/server/audit/auditLog";
import { activateFascicoloIntake } from "@/server/fascicolo-intake/activation";

const createFascicoloIntakeSchema = z.object({
  concessioneId: z.string().trim().optional(),
  tipologiaConcessioneIniziale: z.enum(CONCESSION_VERTICAL_VALUES, {
    error: "Seleziona il tipo del fascicolo.",
  }),
  titoloFascicolo: z
    .string({ error: "Inserisci il titolo del fascicolo." })
    .trim()
    .min(1, "Inserisci il titolo del fascicolo."),
  descrizioneIniziale: z.string().trim().optional(),
  concessionarioIniziale: z.string().trim().optional(),
  enteConcedenteIniziale: z.string().trim().optional(),
  autoritaCompetenteIniziale: z.string().trim().optional(),
  numeroConcessioneIniziale: z.string().trim().optional(),
  decorrenzaIniziale: z.string().optional(),
  scadenzaIniziale: z.string().optional(),
  oggettoConcessioneIniziale: z.string().trim().optional(),
  localitaIniziale: z.string().trim().optional(),
  soggettoAssistito: z.string().trim().optional(),
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

  const created = await prisma.fascicoloIntake.create({
    data: {
      enteId,
      concessioneId,
      tipologiaConcessione: parsed.data.tipologiaConcessioneIniziale,
      oggettoFascicolo: parsed.data.titoloFascicolo,
      denominazioneBreve: parsed.data.titoloFascicolo,
      concessionario: nullable(parsed.data.concessionarioIniziale),
      enteConcedente: nullable(parsed.data.enteConcedenteIniziale),
      autoritaCompetente: nullable(parsed.data.autoritaCompetenteIniziale),
      numeroConcessione: nullable(parsed.data.numeroConcessioneIniziale),
      dataRilascio: null,
      decorrenza: optionalDate(parsed.data.decorrenzaIniziale),
      scadenza: optionalDate(parsed.data.scadenzaIniziale),
      oggettoConcessione: nullable(parsed.data.oggettoConcessioneIniziale),
      beneAreaServizio: null,
      localita: nullable(parsed.data.localitaIniziale),
      soggettoAssistito: nullable(parsed.data.soggettoAssistito),
      controparteAmministrazione: null,
      contestoIniziale: nullable(parsed.data.descrizioneIniziale),
    },
  });

  const currentUser = await getCurrentUser();
  const activation = await activateFascicoloIntake({
    fascicoloIntakeId: created.id,
    tenantId: enteId,
  });

  await auditSuccess({
    azione: "FASCICOLO_INTAKE_CREATE",
    entita: "FascicoloIntake",
    entitaId: created.id,
    enteId,
    concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: {
      tipologiaConcessione: created.tipologiaConcessione,
      procedimentoId: activation.procedimento.id,
      activationOutcome: activation.outcome,
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${created.id}`);
}

export async function activateFascicoloIntakeAction(formData: FormData) {
  const role = await requireRole(BACKOFFICE_ROLES);
  if (!canManageProcedimenti(role)) {
    redirect("/procedimenti");
  }

  const fascicoloIntakeId = z.string().trim().min(1).parse(formData.get("fascicoloIntakeId"));
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

  const currentUser = await getCurrentUser();
  const activation = await activateFascicoloIntake({
    fascicoloIntakeId: fascicolo.id,
    tenantId: fascicolo.enteId,
  });
  await auditSuccess({
    azione: "FASCICOLO_INTAKE_ACTIVATE",
    entita: "FascicoloIntake",
    entitaId: fascicolo.id,
    enteId: fascicolo.enteId,
    concessioneId: fascicolo.concessioneId,
    actor: { userId: currentUser?.id, userEmail: currentUser?.email, userRole: role },
    metadata: {
      procedimentoId: activation.procedimento.id,
      activationOutcome: activation.outcome,
    },
  });

  revalidatePath(`/procedimenti/${fascicolo.id}`);
  revalidatePath(`/procedimenti/${activation.procedimento.id}`);
  redirect(`/procedimenti/${fascicolo.id}`);
}
