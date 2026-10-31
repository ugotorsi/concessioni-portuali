import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

export const GLOBAL_AI_CONTROL_ACTION = "AI_GLOBAL_CONTROL_CHANGE";
export const GLOBAL_AI_CONTROL_ENTITY = "GlobalAiControl";
export const GLOBAL_AI_CONTROL_ENTITY_ID = "global";
export const GLOBAL_AI_EMERGENCY_DISABLED_ENV = "AI_GLOBAL_EMERGENCY_DISABLED";
export const GLOBAL_AI_ENVIRONMENT_GATE_NAMES = [
  "AI_REAL_DATA_ENABLED",
  "ASYNC_PROVIDER_EXECUTION_ENABLED",
  "AUTOMATIC_RESEARCH_EXECUTION_ENABLED",
  "AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED",
] as const;

export type GlobalAiEnvironmentGateName =
  (typeof GLOBAL_AI_ENVIRONMENT_GATE_NAMES)[number];

export const AI_PROVIDER_BACKED_ASYNC_OPERATIONS = [
  "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
  "LEGAL_RESEARCH.EXECUTE_V1",
] as const;

export const AI_ASYNC_OPERATIONS = [
  ...AI_PROVIDER_BACKED_ASYNC_OPERATIONS,
  "FASCICOLO.AUTOMATIC_ANALYSIS_EVALUATION_V1",
] as const;

interface GlobalAiControlActor {
  userId: string;
  userEmail: string;
  userRole: "ADMIN";
}

export interface GlobalAiControlState {
  requestedEnabled: boolean;
  effectiveEnabled: boolean;
  emergencyDisabled: boolean;
  environmentEnabled: boolean;
  environmentGates: Record<GlobalAiEnvironmentGateName, boolean>;
  updatedAt: Date | null;
  updatedBy: {
    userId: string | null;
    userEmail: string | null;
    userRole: string | null;
  } | null;
}

export class GlobalAiDisabledError extends Error {
  readonly code = "AI_GLOBALLY_DISABLED" as const;

  constructor() {
    super("AI_GLOBALLY_DISABLED");
    this.name = "GlobalAiDisabledError";
  }
}

function requestedEnabledFromMetadata(metadata: Prisma.JsonValue | null): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return metadata.newState === "ON";
}

function emergencyDisabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment[GLOBAL_AI_EMERGENCY_DISABLED_ENV]?.trim().toLowerCase() === "true";
}

function readEnvironmentGates(
  environment: Readonly<Record<string, string | undefined>>,
): Record<GlobalAiEnvironmentGateName, boolean> {
  return Object.fromEntries(GLOBAL_AI_ENVIRONMENT_GATE_NAMES.map((name) => [
    name,
    environment[name]?.trim().toLowerCase() === "true",
  ])) as Record<GlobalAiEnvironmentGateName, boolean>;
}

async function acquireGlobalAiControlTransactionLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const namespace = "concessioni-portuali";
  const resource = "global-ai-control:v1";
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(
      hashtext(${namespace}),
      hashtext(${resource})
    )
  `;
  if (rows.length !== 1 || rows[0]?.acquired !== true) {
    throw new Error("GLOBAL_AI_CONTROL_LOCK_FAILED");
  }
}

export async function getGlobalAiControlState(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<GlobalAiControlState> {
  const latest = await prisma.activityLog.findFirst({
    where: {
      azione: GLOBAL_AI_CONTROL_ACTION,
      entita: GLOBAL_AI_CONTROL_ENTITY,
      entitaId: GLOBAL_AI_CONTROL_ENTITY_ID,
      esito: "SUCCESS",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      metadata: true,
      createdAt: true,
      userId: true,
      userEmail: true,
      userRole: true,
    },
  });
  const requestedEnabled = requestedEnabledFromMetadata(latest?.metadata ?? null);
  const killSwitchActive = emergencyDisabled(environment);
  const environmentGates = readEnvironmentGates(environment);
  const environmentEnabled = GLOBAL_AI_ENVIRONMENT_GATE_NAMES.some(
    (name) => environmentGates[name],
  );

  return {
    requestedEnabled,
    effectiveEnabled: requestedEnabled && !killSwitchActive && environmentEnabled,
    emergencyDisabled: killSwitchActive,
    environmentEnabled,
    environmentGates,
    updatedAt: latest?.createdAt ?? null,
    updatedBy: latest
      ? {
          userId: latest.userId,
          userEmail: latest.userEmail,
          userRole: latest.userRole,
        }
      : null,
  };
}

export async function assertGlobalAiExecutionAllowed(): Promise<void> {
  if (emergencyDisabled()) {
    throw new GlobalAiDisabledError();
  }
  const state = await getGlobalAiControlState();
  if (!state.effectiveEnabled) {
    throw new GlobalAiDisabledError();
  }
}

export async function setGlobalAiControlState(input: {
  enabled: boolean;
  actor: GlobalAiControlActor;
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireGlobalAiControlTransactionLock(tx);
    const latest = await tx.activityLog.findFirst({
      where: {
        azione: GLOBAL_AI_CONTROL_ACTION,
        entita: GLOBAL_AI_CONTROL_ENTITY,
        entitaId: GLOBAL_AI_CONTROL_ENTITY_ID,
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    });
    const previousEnabled = requestedEnabledFromMetadata(latest?.metadata ?? null);
    const now = new Date();
    let cancelledQueuedJobs = 0;
    let cancellationRequestedJobs = 0;

    if (!input.enabled) {
      const queued = await tx.asyncJob.updateMany({
        where: {
          operation: { in: [...AI_ASYNC_OPERATIONS] },
          status: { in: ["QUEUED", "RETRY_WAIT"] },
        },
        data: {
          status: "CANCELLED",
          cancellationRequestedAt: now,
          completedAt: now,
          stateVersion: { increment: 1 },
        },
      });
      const running = await tx.asyncJob.updateMany({
        where: {
          operation: { in: [...AI_ASYNC_OPERATIONS] },
          status: "RUNNING",
        },
        data: {
          status: "CANCELLATION_REQUESTED",
          cancellationRequestedAt: now,
          stateVersion: { increment: 1 },
        },
      });
      cancelledQueuedJobs = queued.count;
      cancellationRequestedJobs = running.count;
    }

    const audit = await createAuditLogInTransaction(tx, {
      azione: GLOBAL_AI_CONTROL_ACTION,
      entita: GLOBAL_AI_CONTROL_ENTITY,
      entitaId: GLOBAL_AI_CONTROL_ENTITY_ID,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        previousState: previousEnabled ? "ON" : "OFF",
        newState: input.enabled ? "ON" : "OFF",
        reason: input.reason?.trim() || null,
        cancelledQueuedJobs,
        cancellationRequestedJobs,
      },
    });

    return {
      previousEnabled,
      requestedEnabled: input.enabled,
      cancelledQueuedJobs,
      cancellationRequestedJobs,
      updatedAt: audit.createdAt,
    };
  });
}
