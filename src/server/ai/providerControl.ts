import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  AI_MODEL_CATALOG,
  DEFAULT_AI_MODEL_SELECTION,
  aiProviderIdSchema,
  getAiModelCatalogEntry,
  type AiModelSelection,
  type AiProviderId,
} from "@/server/ai/providerCatalog";

export const AI_PROVIDER_MANUAL_CONTROL_ACTION = "AI_PROVIDER_MANUAL_CONTROL_CHANGE";
export const AI_PROVIDER_AUTOMATIC_CONTROL_ACTION = "AI_PROVIDER_AUTOMATIC_CONTROL_CHANGE";
export const AI_PROVIDER_CONTROL_ENTITY = "AiProviderControl";
export const AI_AUTOMATIC_WORKFLOW = "FASCICOLO.AUTOMATIC_ANALYSIS_V1" as const;

interface ProviderControlActor {
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: "ADMIN";
}

export interface AiProviderControlState {
  readonly provider: AiProviderId;
  readonly manualEnabled: boolean;
  readonly manualUpdatedAt: Date | null;
  readonly manualUpdatedBy: {
    readonly userId: string | null;
    readonly userEmail: string | null;
    readonly userRole: string | null;
  } | null;
  readonly automaticSelected: boolean;
}

export interface AiProviderControlSnapshot {
  readonly workflow: typeof AI_AUTOMATIC_WORKFLOW;
  readonly automaticSelection: AiModelSelection;
  readonly automaticUpdatedAt: Date | null;
  readonly providers: readonly AiProviderControlState[];
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function manualDefault(provider: AiProviderId): boolean {
  return provider === "OPENAI";
}

async function acquireProviderControlLock(tx: Prisma.TransactionClient): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(
      hashtext('concessioni-portuali'),
      hashtext('ai-provider-control:v1')
    )
  `;
  if (rows.length !== 1 || rows[0]?.acquired !== true) {
    throw new Error("AI_PROVIDER_CONTROL_LOCK_FAILED");
  }
}

export async function getAiProviderControlSnapshot(): Promise<AiProviderControlSnapshot> {
  const providerIds = AI_MODEL_CATALOG.map((entry) => entry.selection.provider);
  const [manualEvents, automaticEvent] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        azione: AI_PROVIDER_MANUAL_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: { in: providerIds },
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        entitaId: true,
        metadata: true,
        createdAt: true,
        userId: true,
        userEmail: true,
        userRole: true,
      },
    }),
    prisma.activityLog.findFirst({
      where: {
        azione: AI_PROVIDER_AUTOMATIC_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: AI_AUTOMATIC_WORKFLOW,
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true, createdAt: true },
    }),
  ]);
  const automaticMetadata = metadataRecord(automaticEvent?.metadata ?? null);
  const configuredAutomatic = aiProviderIdSchema.safeParse(
    automaticMetadata?.provider,
  );
  const automaticSelection = configuredAutomatic.success
    ? getAiModelCatalogEntry(AI_MODEL_CATALOG.find(
        (entry) => entry.selection.provider === configuredAutomatic.data,
      )?.selection ?? DEFAULT_AI_MODEL_SELECTION).selection
    : DEFAULT_AI_MODEL_SELECTION;
  const latestManualByProvider = new Map<AiProviderId, typeof manualEvents[number]>();
  for (const event of manualEvents) {
    const provider = aiProviderIdSchema.safeParse(event.entitaId);
    if (provider.success && !latestManualByProvider.has(provider.data)) {
      latestManualByProvider.set(provider.data, event);
    }
  }
  return {
    workflow: AI_AUTOMATIC_WORKFLOW,
    automaticSelection,
    automaticUpdatedAt: automaticEvent?.createdAt ?? null,
    providers: providerIds.map((provider) => {
      const event = latestManualByProvider.get(provider);
      const metadata = metadataRecord(event?.metadata ?? null);
      const manualEnabled = typeof metadata?.newEnabled === "boolean"
        ? metadata.newEnabled
        : manualDefault(provider);
      return {
        provider,
        manualEnabled,
        manualUpdatedAt: event?.createdAt ?? null,
        manualUpdatedBy: event
          ? {
              userId: event.userId,
              userEmail: event.userEmail,
              userRole: event.userRole,
            }
          : null,
        automaticSelected: automaticSelection.provider === provider,
      };
    }),
  };
}

export async function setAiProviderManualEnabled(input: {
  readonly provider: AiProviderId;
  readonly enabled: boolean;
  readonly actor: ProviderControlActor;
  readonly reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireProviderControlLock(tx);
    const latest = await tx.activityLog.findFirst({
      where: {
        azione: AI_PROVIDER_MANUAL_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: input.provider,
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    });
    const metadata = metadataRecord(latest?.metadata ?? null);
    const previousEnabled = typeof metadata?.newEnabled === "boolean"
      ? metadata.newEnabled
      : manualDefault(input.provider);
    const audit = await createAuditLogInTransaction(tx, {
      azione: AI_PROVIDER_MANUAL_CONTROL_ACTION,
      entita: AI_PROVIDER_CONTROL_ENTITY,
      entitaId: input.provider,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        provider: input.provider,
        previousEnabled,
        newEnabled: input.enabled,
        reason: input.reason?.trim() || null,
      },
    });
    return {
      provider: input.provider,
      previousEnabled,
      manualEnabled: input.enabled,
      updatedAt: audit.createdAt,
    };
  });
}

export async function setAiProvidersManualEnabled(input: {
  readonly providers: readonly AiProviderId[];
  readonly enabled: boolean;
  readonly actor: ProviderControlActor;
  readonly reason?: string | null;
}) {
  const providers = [...new Set(input.providers.map((provider) => (
    aiProviderIdSchema.parse(provider)
  )))];
  return prisma.$transaction(async (tx) => {
    await acquireProviderControlLock(tx);
    const existing = await tx.activityLog.findMany({
      where: {
        azione: AI_PROVIDER_MANUAL_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: { in: providers },
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { entitaId: true, metadata: true },
    });
    const previousByProvider = new Map<AiProviderId, boolean>();
    for (const event of existing) {
      const provider = aiProviderIdSchema.safeParse(event.entitaId);
      if (!provider.success || previousByProvider.has(provider.data)) continue;
      const metadata = metadataRecord(event.metadata);
      previousByProvider.set(
        provider.data,
        typeof metadata?.newEnabled === "boolean"
          ? metadata.newEnabled
          : manualDefault(provider.data),
      );
    }
    const audits = [];
    for (const provider of providers) {
      const audit = await createAuditLogInTransaction(tx, {
        azione: AI_PROVIDER_MANUAL_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: provider,
        esito: "SUCCESS",
        actor: input.actor,
        metadata: {
          provider,
          previousEnabled: previousByProvider.get(provider) ?? manualDefault(provider),
          newEnabled: input.enabled,
          bulk: true,
          reason: input.reason?.trim() || null,
        },
      });
      audits.push({ provider, updatedAt: audit.createdAt });
    }
    return { enabled: input.enabled, providers: audits };
  });
}

export async function setAutomaticAiProvider(input: {
  readonly selection: AiModelSelection;
  readonly actor: ProviderControlActor;
  readonly reason?: string | null;
}) {
  const selected = getAiModelCatalogEntry(input.selection).selection;
  return prisma.$transaction(async (tx) => {
    await acquireProviderControlLock(tx);
    const latest = await tx.activityLog.findFirst({
      where: {
        azione: AI_PROVIDER_AUTOMATIC_CONTROL_ACTION,
        entita: AI_PROVIDER_CONTROL_ENTITY,
        entitaId: AI_AUTOMATIC_WORKFLOW,
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    });
    const metadata = metadataRecord(latest?.metadata ?? null);
    const previousProvider = aiProviderIdSchema.safeParse(metadata?.provider);
    const audit = await createAuditLogInTransaction(tx, {
      azione: AI_PROVIDER_AUTOMATIC_CONTROL_ACTION,
      entita: AI_PROVIDER_CONTROL_ENTITY,
      entitaId: AI_AUTOMATIC_WORKFLOW,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        workflow: AI_AUTOMATIC_WORKFLOW,
        previousProvider: previousProvider.success
          ? previousProvider.data
          : DEFAULT_AI_MODEL_SELECTION.provider,
        provider: selected.provider,
        model: selected.model,
        selectionVersion: selected.selectionVersion,
        reason: input.reason?.trim() || null,
      },
    });
    return {
      workflow: AI_AUTOMATIC_WORKFLOW,
      selection: selected,
      updatedAt: audit.createdAt,
    };
  });
}
