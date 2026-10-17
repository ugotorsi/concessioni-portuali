import { z } from "zod";

import { getAuthSession } from "@/lib/next-auth";
import {
  ResearchMissionVersioningError,
  versionResearchMissionBudget,
} from "@/server/fascicolo-knowledge/researchMissionVersioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const budgetSchema = z.object({
  maxTotalResearchCalls: z.number().int().min(0).max(100),
  maxMoonlitCalls: z.number().int().min(0).max(100),
  maxSimpliciterCalls: z.number().int().min(0).max(100),
  maxLegalDataHunterCalls: z.number().int().min(0).max(100),
}).strict().refine((budget) => (
  budget.maxMoonlitCalls <= budget.maxTotalResearchCalls
  && budget.maxSimpliciterCalls <= budget.maxTotalResearchCalls
  && budget.maxLegalDataHunterCalls <= budget.maxTotalResearchCalls
), { message: "INVALID_BUDGET" });

const inputSchema = z.object({
  budget: budgetSchema,
  reason: z.string().trim().min(20).max(1000),
}).strict();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ missionId: string }> },
): Promise<Response> {
  const session = await getAuthSession();
  const admin = session?.user;
  if (!admin?.id) return json({ error: "AUTH_REQUIRED" }, 401);
  if (admin.role !== "ADMIN") return json({ error: "FORBIDDEN" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const input = inputSchema.safeParse(body);
  if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
  const { missionId } = await context.params;

  try {
    const result = await versionResearchMissionBudget({
      sourceMissionId: missionId,
      budget: input.data.budget,
      reason: input.data.reason,
      actor: {
        userId: admin.id,
        userEmail: admin.email ?? null,
        userRole: "ADMIN",
      },
    });
    return json({
      outcome: result.outcome,
      previousMissionId: result.previousMissionId,
      missionId: result.mission.missionId,
      assignedActorId: result.assignedActorId,
      knowledgeRevisionId: result.knowledgeRevisionId,
      researchQuestionSemanticKey: result.researchQuestionSemanticKey,
    }, result.outcome === "CREATED" ? 201 : 200);
  } catch (error) {
    if (error instanceof ResearchMissionVersioningError) {
      if (error.code === "MISSION_NOT_FOUND") return json({ error: error.code }, 404);
      if (error.code === "TENANT_ACCESS_DENIED") return json({ error: "FORBIDDEN" }, 403);
      if (error.code === "MISSION_VERSION_INVALID" || error.code === "BUDGET_UNCHANGED") {
        return json({ error: error.code }, 400);
      }
      return json({ error: error.code }, 409);
    }
    console.error({ event: "research_mission_budget_version_failed" });
    return json({ error: "MISSION_VERSION_FAILED" }, 500);
  }
}
