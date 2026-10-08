import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/next-auth";
import {
  validateResearchMission,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import {
  createResearchMissionRecord,
  ResearchPersistenceError,
} from "@/server/legal-research/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  assignedActorId: z.string().trim().min(1).max(256),
  mission: z.custom<ResearchMission>((value) => {
    try {
      return Boolean(value)
        && typeof value === "object"
        && validateResearchMission(value as ResearchMission).length === 0
        && (value as ResearchMission).status === "PENDING";
    } catch {
      return false;
    }
  }),
}).strict();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
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

  const assignedActor = await prisma.user.findUnique({
    where: { id: input.data.assignedActorId },
    select: {
      id: true,
      attivo: true,
      tenantMemberships: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { enteId: true, isDefault: true },
      },
    },
  });
  if (!assignedActor?.attivo) return json({ error: "ASSIGNED_ACTOR_NOT_FOUND" }, 404);

  const defaultMemberships = assignedActor.tenantMemberships.filter((membership) => membership.isDefault);
  const membership = defaultMemberships.length === 1
    ? defaultMemberships[0]
    : assignedActor.tenantMemberships.length === 1
      ? assignedActor.tenantMemberships[0]
      : null;
  if (!membership) return json({ error: "ASSIGNED_ACTOR_TENANT_AMBIGUOUS" }, 409);

  try {
    const result = await createResearchMissionRecord({
      mission: input.data.mission,
      assignedActorId: assignedActor.id,
      actor: { actorId: admin.id, tenantId: membership.enteId },
    });
    return json({
      outcome: result.outcome,
      missionId: result.mission.mission.missionId,
      assignedActorId: assignedActor.id,
    }, result.outcome === "CREATED" ? 201 : 200);
  } catch (error) {
    if (error instanceof ResearchPersistenceError) {
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        return json({ error: "MISSION_CONFLICT" }, 409);
      }
      if (error.code === "INVALID_MISSION" || error.code === "INVALID_CLAIM") {
        return json({ error: "INVALID_REQUEST" }, 400);
      }
      if (error.code === "AUTHORIZATION_REQUIRED") {
        return json({ error: "FORBIDDEN" }, 403);
      }
    }
    console.error({ event: "research_mission_assignment_failed" });
    return json({ error: "MISSION_CREATION_FAILED" }, 500);
  }
}
