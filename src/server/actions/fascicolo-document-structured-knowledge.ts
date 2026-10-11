"use server";

import { revalidatePath } from "next/cache";

import { canManageProcedimenti, canUseAI } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canWriteTenantResource,
  getCurrentTenantContext,
  requireTenantAccess,
} from "@/lib/tenant-auth";
import {
  assertFascicoloDocumentStructuredKnowledgeAvailable,
  readFascicoloDocumentStructuredKnowledgeEnvironment,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";
import {
  createE2EFascicoloStructuredKnowledgeTransport,
} from "@/server/ai/e2eFascicoloStructuredKnowledgeGuard";
import { createOpenAiE2EFascicoloDocumentRuntimeFromEnv } from "@/server/ai/openaiRuntime";
import { createFascicoloDocumentStructuredKnowledgeService } from "@/server/ai/fascicoloDocumentStructuredKnowledge";

class FascicoloDocumentStructuredKnowledgeActionError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "UNAUTHENTICATED"
      | "ROLE_FORBIDDEN"
      | "PROCEDIMENTO_NOT_FOUND"
      | "TENANT_ACCESS_DENIED"
      | "CORPUS_NOT_READY"
      | "NO_STRUCTURED_KNOWLEDGE",
  ) {
    super(code);
    this.name = "FascicoloDocumentStructuredKnowledgeActionError";
  }
}

export async function analyzeFascicoloDocumentStructuredKnowledgeAction(
  formData: FormData,
): Promise<void> {
  const procedimentoId = formData.get("procedimentoId");
  if (typeof procedimentoId !== "string" || !procedimentoId.trim()) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("INVALID_INPUT");
  }

  const context = await getCurrentTenantContext();
  if (!context) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("UNAUTHENTICATED");
  }
  if (!canManageProcedimenti(context.role) || !canUseAI(context.role)) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("ROLE_FORBIDDEN");
  }

  const environment = readFascicoloDocumentStructuredKnowledgeEnvironment();
  assertFascicoloDocumentStructuredKnowledgeAvailable({
    env: environment,
    procedimentoId,
  });

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("PROCEDIMENTO_NOT_FOUND");
  }

  if (!canWriteTenantResource(context, procedimento.enteId, { allowWhenEnteMissing: false })) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("TENANT_ACCESS_DENIED");
  }
  requireTenantAccess(context, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });
  if (!procedimento.enteId) {
    throw new FascicoloDocumentStructuredKnowledgeActionError("TENANT_ACCESS_DENIED");
  }
  assertFascicoloDocumentStructuredKnowledgeAvailable({
    env: environment,
    procedimentoId: procedimento.id,
    tenantId: procedimento.enteId,
  });

  const analysisService = createOpenAiE2EFascicoloDocumentRuntimeFromEnv(
    undefined,
    {
      transport: createE2EFascicoloStructuredKnowledgeTransport({
        tenantId: procedimento.enteId,
        procedimentoId: procedimento.id,
        projectId: environment.AI_OPENAI_PROJECT_ID,
        region: environment.AI_OPENAI_REGION,
        authorizationNotBefore:
          environment.E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE,
        authorizationExpiresAt:
          environment.E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT,
      }),
    },
  );
  const service = createFascicoloDocumentStructuredKnowledgeService({ analysisService });
  const result = await service.analyzeAndPersist({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
  });
  if (result.outcome === "NOT_FOUND") {
    throw new FascicoloDocumentStructuredKnowledgeActionError("PROCEDIMENTO_NOT_FOUND");
  }
  if (result.outcome === "NOT_READY") {
    throw new FascicoloDocumentStructuredKnowledgeActionError("CORPUS_NOT_READY");
  }
  if (result.outcome === "NO_STRUCTURED_KNOWLEDGE") {
    throw new FascicoloDocumentStructuredKnowledgeActionError("NO_STRUCTURED_KNOWLEDGE");
  }

  revalidatePath(`/procedimenti/${procedimento.id}`);
}
