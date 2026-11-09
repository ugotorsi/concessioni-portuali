import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { isRealDataDeploymentAuthorized } from "@/server/ai/realDataActivation";

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
  controlEventStatus: "ABSENT" | "VALID" | "INVALID";
  requestedEnabled: boolean;
  effectiveEnabled: boolean;
  emergencyDisabled: boolean;
  deploymentAuthorized: boolean;
  environmentEnabled: boolean;
  environmentGates: Record<GlobalAiEnvironmentGateName, boolean>;
  updatedAt: Date | null;
  updatedBy: {
    userId: string | null;
    userEmail: string | null;
    userRole: string | null;
  } | null;
  blockers: readonly ("ADMIN_COMMAND_OFF" | "INVALID_CONTROL_EVENT" | "DEPLOYMENT_NOT_AUTHORIZED" | "EMERGENCY_DISABLED")[];
  lastTransition: {
    eventId: string;
    previousState: "ON" | "OFF";
    newState: "ON" | "OFF";
    reason: string | null;
    cancelledQueuedJobs: number;
    cancellationRequestedJobs: number;
    auditHash: string;
  } | null;
}

export class GlobalAiDisabledError extends Error {
  readonly code = "AI_GLOBALLY_DISABLED" as const;

  constructor() {
    super("AI_GLOBALLY_DISABLED");
    this.name = "GlobalAiDisabledError";
  }
}

function requestedEnabledFromMetadata(metadata: Prisma.JsonValue | null): boolean | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata.newState === "ON" ? true : metadata.newState === "OFF" ? false : null;
}

function transitionFromMetadata(
  event: {
    id: string;
    metadata: Prisma.JsonValue | null;
    currentHash: string;
  } | null,
): GlobalAiControlState["lastTransition"] {
  if (!event?.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
    return null;
  }
  const metadata = event.metadata;
  if ((metadata.previousState !== "ON" && metadata.previousState !== "OFF")
    || (metadata.newState !== "ON" && metadata.newState !== "OFF")) {
    return null;
  }
  const previousState = metadata.previousState;
  const newState = metadata.newState;
  const reason = typeof metadata.reason === "string" && metadata.reason.trim()
    ? metadata.reason.trim()
    : null;
  const cancelledQueuedJobs = typeof metadata.cancelledQueuedJobs === "number"
    && Number.isSafeInteger(metadata.cancelledQueuedJobs)
    && metadata.cancelledQueuedJobs >= 0
    ? metadata.cancelledQueuedJobs
    : 0;
  const cancellationRequestedJobs = typeof metadata.cancellationRequestedJobs === "number"
    && Number.isSafeInteger(metadata.cancellationRequestedJobs)
    && metadata.cancellationRequestedJobs >= 0
    ? metadata.cancellationRequestedJobs
    : 0;
  return {
    eventId: event.id,
    previousState,
    newState,
    reason,
    cancelledQueuedJobs,
    cancellationRequestedJobs,
    auditHash: event.currentHash,
  };
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
      id: true,
      metadata: true,
      createdAt: true,
      userId: true,
      userEmail: true,
      userRole: true,
      currentHash: true,
    },
  });
  const requestedValue = latest ? requestedEnabledFromMetadata(latest.metadata) : false;
  const controlEventStatus = !latest ? "ABSENT" : requestedValue === null ? "INVALID" : "VALID";
  const requestedEnabled = requestedValue === true;
  const killSwitchActive = emergencyDisabled(environment);
  const environmentGates = readEnvironmentGates(environment);
  const deploymentAuthorized = isRealDataDeploymentAuthorized(environment);
  const blockers: GlobalAiControlState["blockers"] = [
    ...(!requestedEnabled ? ["ADMIN_COMMAND_OFF" as const] : []),
    ...(controlEventStatus === "INVALID" ? ["INVALID_CONTROL_EVENT" as const] : []),
    ...(!deploymentAuthorized ? ["DEPLOYMENT_NOT_AUTHORIZED" as const] : []),
    ...(killSwitchActive ? ["EMERGENCY_DISABLED" as const] : []),
  ];

  return {
    controlEventStatus,
    requestedEnabled,
    effectiveEnabled: requestedEnabled && !killSwitchActive && deploymentAuthorized,
    emergencyDisabled: killSwitchActive,
    deploymentAuthorized,
    environmentEnabled: deploymentAuthorized,
    environmentGates,
    blockers,
    lastTransition: transitionFromMetadata(latest ?? null),
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
    const previousValue = latest ? requestedEnabledFromMetadata(latest.metadata) : false;
    if (previousValue === null) {
      throw new Error("GLOBAL_AI_CONTROL_EVENT_INVALID");
    }
    const previousEnabled = previousValue;
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
