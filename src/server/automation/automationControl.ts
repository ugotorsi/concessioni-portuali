import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { AI_PROVIDER_BACKED_ASYNC_OPERATIONS } from "@/server/ai/globalAiControl";

export const AUTOMATION_CONTROL_ACTION = "AUTOMATION_MODE_CHANGE";
export const AUTOMATION_CONTROL_ENTITY = "AutomationControl";
export const AUTOMATION_CONTROL_ENTITY_ID = "global";
export const MANUAL_AI_JOB_PURPOSES = [
  "FASCICOLO_MANUAL_ANALYSIS",
  "FASCICOLO_EXISTING_CORPUS_ANALYSIS_V7_CONTROLLED",
] as const;

export type AutomationMode = "OFF" | "ON";

interface AutomationControlActor {
  userId: string;
  userEmail: string;
  userRole: "ADMIN";
}

export interface AutomationControlState {
  mode: AutomationMode;
  effectiveEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: {
    userId: string | null;
    userEmail: string | null;
    userRole: string | null;
  } | null;
}

function modeFromMetadata(metadata: Prisma.JsonValue | null): AutomationMode {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "OFF";
  }
  return metadata.newMode === "ON" ? "ON" : "OFF";
}

async function acquireAutomationControlTransactionLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(
      hashtext('concessioni-portuali'),
      hashtext('automation-control:v1')
    )
  `;
  if (rows.length !== 1 || rows[0]?.acquired !== true) {
    throw new Error("AUTOMATION_CONTROL_LOCK_FAILED");
  }
}

export async function getAutomationControlState(): Promise<AutomationControlState> {
  const latest = await prisma.activityLog.findFirst({
    where: {
      azione: AUTOMATION_CONTROL_ACTION,
      entita: AUTOMATION_CONTROL_ENTITY,
      entitaId: AUTOMATION_CONTROL_ENTITY_ID,
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
  const mode = modeFromMetadata(latest?.metadata ?? null);
  return {
    mode,
    effectiveEnabled: mode === "ON",
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

export async function isAutomationEnabled(): Promise<boolean> {
  return (await getAutomationControlState()).effectiveEnabled;
}

export async function setAutomationControlState(input: {
  mode: AutomationMode;
  actor: AutomationControlActor;
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireAutomationControlTransactionLock(tx);
    const latest = await tx.activityLog.findFirst({
      where: {
        azione: AUTOMATION_CONTROL_ACTION,
        entita: AUTOMATION_CONTROL_ENTITY,
        entitaId: AUTOMATION_CONTROL_ENTITY_ID,
        esito: "SUCCESS",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    });
    const previousMode = modeFromMetadata(latest?.metadata ?? null);
    const now = new Date();
    let cancelledQueuedJobs = 0;
    let cancellationRequestedJobs = 0;

    if (input.mode === "OFF") {
      const automaticJobWhere: Prisma.AsyncJobWhereInput = {
        operation: { in: [...AI_PROVIDER_BACKED_ASYNC_OPERATIONS] },
        purpose: { notIn: [...MANUAL_AI_JOB_PURPOSES] },
      };
      const queued = await tx.asyncJob.updateMany({
        where: {
          ...automaticJobWhere,
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
          ...automaticJobWhere,
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
      azione: AUTOMATION_CONTROL_ACTION,
      entita: AUTOMATION_CONTROL_ENTITY,
      entitaId: AUTOMATION_CONTROL_ENTITY_ID,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        previousMode,
        newMode: input.mode,
        reason: input.reason?.trim() || null,
        cancelledQueuedJobs,
        cancellationRequestedJobs,
      },
    });

    return {
      previousMode,
      mode: input.mode,
      cancelledQueuedJobs,
      cancellationRequestedJobs,
      updatedAt: audit.createdAt,
    };
  });
}
