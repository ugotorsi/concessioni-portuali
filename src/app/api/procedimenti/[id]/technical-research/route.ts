import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTrustedJsonMutation, untrustedMutationResponse } from "@/lib/request-security";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import type { Prisma } from "@/generated/prisma/client";
import { auditFailure, createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  callTechnicalSourcesTool,
  deriveTechnicalSourceVerificationStatus,
  TechnicalSourcesMcpError,
  technicalSourcesToolCallSchema,
} from "@/server/technical-sources/technical-sources-mcp";
import {
  getTechnicalSourcesMcpAccessToken,
  isTechnicalSourcesChannelEnabled,
} from "@/server/technical-sources/technical-sources-m2m";

export const runtime = "nodejs";

const identifier = z.string().trim().min(1).max(256);
const inputSchema = z.object({
  missionId: identifier,
  call: technicalSourcesToolCallSchema,
}).strict();

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable.");
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

async function getAccessibleProcedure(
  procedimentoId: string,
  expectedUserId: string,
  mode: "read" | "write",
) {
  const [tenantContext, procedimento] = await Promise.all([
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({
      where: { id: procedimentoId },
      select: { id: true, enteId: true },
    }),
  ]);
  if (!procedimento) return { kind: "ERROR", response: jsonError("Procedure not found.", 404) } as const;
  try {
    if (!tenantContext || tenantContext.userId !== expectedUserId) {
      throw new Error("Tenant context unavailable.");
    }
    requireTenantAccess(tenantContext, procedimento.enteId, { mode, allowWhenEnteMissing: false });
  } catch {
    return { kind: "ERROR", response: jsonError("Forbidden.", 403) } as const;
  }
  return { kind: "OK", procedimento } as const;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);

  const procedimentoId = identifier.safeParse((await context.params).id);
  if (!procedimentoId.success) return jsonError("Invalid procedure.", 400);

  const access = await getAccessibleProcedure(procedimentoId.data, user.id, "read");
  if (access.kind === "ERROR") return access.response;

  const [records, missions] = await Promise.all([
    prisma.technicalSourceResearchRecord.findMany({
      where: { tenantId: access.procedimento.enteId, procedimentoId: access.procedimento.id },
      orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
      take: 51,
      select: {
        id: true,
        missionId: true,
        questionSnapshot: true,
        toolName: true,
        requestPayload: true,
        responsePayload: true,
        serviceVersion: true,
        verificationStatus: true,
        retrievedAt: true,
      },
    }),
    prisma.researchMissionRecord.findMany({
      where: {
        tenantId: access.procedimento.enteId,
        caseId: access.procedimento.id,
        lifecycleStatus: "CURRENT",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, payload: true },
    }),
  ]);

  return NextResponse.json({
    channelEnabled: isTechnicalSourcesChannelEnabled(),
    canRequest: canManageProcedimenti(user.role),
    missions: missions.flatMap((mission) => {
      const question = isJsonRecord(mission.payload) ? mission.payload.researchQuestion : null;
      return typeof question === "string" && question.trim()
        ? [{ id: mission.id, question: question.trim().slice(0, 500) }]
        : [];
    }),
    records: records.slice(0, 50),
    hasMore: records.length > 50,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isTrustedJsonMutation(request)) return untrustedMutationResponse();

  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  if (!canManageProcedimenti(user.role)) return jsonError("Forbidden.", 403);

  const procedimentoId = identifier.safeParse((await context.params).id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  const input = inputSchema.safeParse(body);
  if (!procedimentoId.success || !input.success) return jsonError("Invalid request.", 400);

  const access = await getAccessibleProcedure(procedimentoId.data, user.id, "write");
  if (access.kind === "ERROR") return access.response;

  const mission = await prisma.researchMissionRecord.findFirst({
    where: {
      id: input.data.missionId,
      tenantId: access.procedimento.enteId,
      caseId: access.procedimento.id,
      lifecycleStatus: "CURRENT",
    },
    select: { id: true, payload: true },
  });
  if (!mission) return jsonError("Research mission not found.", 404);
  const question = isJsonRecord(mission.payload) ? mission.payload.researchQuestion : null;
  if (typeof question !== "string" || !question.trim()) {
    return jsonError("Research mission has no usable question snapshot.", 409);
  }

  const auditActor = { userId: user.id, userEmail: user.email ?? null, userRole: user.role ?? null };
  const auditBase = {
    entita: "TechnicalSourceResearchRecord",
    enteId: access.procedimento.enteId,
    actor: auditActor,
  };

  let result: Awaited<ReturnType<typeof callTechnicalSourcesTool>>;
  let verificationStatus: ReturnType<typeof deriveTechnicalSourceVerificationStatus>;
  try {
    result = await callTechnicalSourcesTool(input.data.call, {
      getAccessToken: getTechnicalSourcesMcpAccessToken,
    });
    verificationStatus = deriveTechnicalSourceVerificationStatus(input.data.call.tool, result.data);
  } catch (error) {
    if (error instanceof TechnicalSourcesMcpError) {
      await auditFailure({
        ...auditBase,
        azione: "TECHNICAL_SOURCE_RESEARCH_FAILED",
        entitaId: null,
        metadata: {
          procedimentoId: access.procedimento.id,
          missionId: mission.id,
          toolName: input.data.call.tool,
          errorCode: error.code,
          upstreamStatus: error.status ?? null,
        },
      }).catch(() => undefined);
      const status = error.code === "M2M_AUTH_NOT_CONFIGURED" ? 503 : 502;
      return jsonError(
        error.code === "M2M_AUTH_NOT_CONFIGURED"
          ? "Technical source service identity is not configured."
          : "Technical source service request failed.",
        status,
      );
    }
    throw error;
  }

  try {
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.technicalSourceResearchRecord.create({
        data: {
          tenantId: access.procedimento.enteId,
          procedimentoId: access.procedimento.id,
          missionId: mission.id,
          requestedByUserId: user.id,
          questionSnapshot: question.trim(),
          toolName: input.data.call.tool,
          requestPayload: jsonInput(input.data.call.arguments),
          responsePayload: jsonInput(result.data),
          serviceVersion: result.serviceVersion,
          verificationStatus,
        },
        select: {
          id: true,
          missionId: true,
          toolName: true,
          serviceVersion: true,
          verificationStatus: true,
          retrievedAt: true,
        },
      });
      await createAuditLogInTransaction(tx, {
        ...auditBase,
        azione: "TECHNICAL_SOURCE_RESEARCH_RECORDED",
        entitaId: created.id,
        esito: "SUCCESS",
        metadata: {
          procedimentoId: access.procedimento.id,
          missionId: mission.id,
          toolName: created.toolName,
          serviceVersion: created.serviceVersion,
          verificationStatus: created.verificationStatus,
        },
      });
      return created;
    });
    return NextResponse.json({ record }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "Technical source research persistence failed.",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("Technical source result could not be persisted.", 500);
  }
}
