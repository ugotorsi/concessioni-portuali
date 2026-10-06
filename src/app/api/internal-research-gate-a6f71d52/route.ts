import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROCEDIMENTO_ID = "staging-e2e-test-001-procedimento";
const MISSION_ID =
  "research-mission:02a5a15216bec4ad028d7cd6893112e344f2fc0303afd488105c4f77b483abe0";
const PROTECTED_MISSION_ID =
  "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const EXPECTED_ENDPOINT = "ep-jolly-hall-atts00ke";
const NO_STORE = { "Cache-Control": "no-store" };

function assertStaging(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const url = new URL(databaseUrl);
  if (
    process.env.VERCEL_ENV !== "preview"
    || url.protocol !== "postgresql:"
    || !url.hostname.startsWith(EXPECTED_ENDPOINT)
    || url.pathname !== "/neondb"
  ) {
    throw new Error("STAGING_SCOPE_MISMATCH");
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function GET() {
  try {
    assertStaging();
    const [mission, results, assessments, protectedMission, protectedBundleCount] =
      await Promise.all([
        prisma.researchMissionRecord.findUnique({
          where: { id: MISSION_ID },
          select: {
            id: true,
            status: true,
            lifecycleStatus: true,
            caseId: true,
            tenantId: true,
            updatedAt: true,
          },
        }),
        prisma.researchQuestionResultRecord.findMany({
          where: { missionId: MISSION_ID },
          select: {
            id: true,
            candidateId: true,
            candidateSnapshot: true,
            supportDirection: true,
          },
          orderBy: { id: "asc" },
        }),
        prisma.researchSourceAssessmentRecord.findMany({
          where: { missionId: MISSION_ID, isCurrent: true },
          select: {
            resultId: true,
            retrievalState: true,
            textState: true,
            identityState: true,
            contentState: true,
            temporalState: true,
            adverseState: true,
            blockingReasons: true,
            usable: true,
          },
          orderBy: { resultId: "asc" },
        }),
        prisma.researchMissionRecord.findUnique({
          where: { id: PROTECTED_MISSION_ID },
          include: { executionAttempts: { orderBy: { id: "asc" } } },
        }),
        prisma.researchEvidenceBundleRecord.count({
          where: { missionId: PROTECTED_MISSION_ID },
        }),
      ]);
    if (!mission || mission.caseId !== PROCEDIMENTO_ID) {
      throw new Error("MISSION_SCOPE_MISMATCH");
    }
    const protectedView = protectedMission
      ? {
          mission: protectedMission,
          attemptCount: protectedMission.executionAttempts.length,
          bundleCount: protectedBundleCount,
        }
      : null;
    const candidates = results.map((result) => {
      const candidate = result.candidateSnapshot as {
        toolId?: unknown;
        providerId?: unknown;
        courtOrBody?: unknown;
        documentType?: unknown;
        number?: unknown;
        year?: unknown;
        documentDate?: unknown;
        ecli?: unknown;
        celex?: unknown;
        officialIdentifier?: unknown;
        title?: unknown;
        sourceUrl?: unknown;
        providerDocumentId?: unknown;
        providerDates?: unknown;
        exactReferenceMatch?: unknown;
        fullTextAvailable?: unknown;
        verificationState?: unknown;
      };
      const parseInput = [
        candidate.officialIdentifier,
        candidate.title,
        candidate.courtOrBody,
      ].filter((value): value is string => typeof value === "string").join(" ");
      return {
        resultId: result.id,
        candidateId: result.candidateId,
        supportDirection: result.supportDirection,
        toolId: candidate.toolId ?? null,
        providerId: candidate.providerId ?? null,
        courtOrBody: candidate.courtOrBody ?? null,
        documentType: candidate.documentType ?? null,
        number: candidate.number ?? null,
        year: candidate.year ?? null,
        documentDate: candidate.documentDate ?? null,
        ecli: candidate.ecli ?? null,
        celex: candidate.celex ?? null,
        officialIdentifier: candidate.officialIdentifier ?? null,
        title: candidate.title ?? null,
        sourceUrl: candidate.sourceUrl ?? null,
        providerDocumentId: candidate.providerDocumentId ?? null,
        providerDates: candidate.providerDates ?? null,
        exactReferenceMatch: candidate.exactReferenceMatch ?? null,
        fullTextAvailable: candidate.fullTextAvailable ?? null,
        verificationState: candidate.verificationState ?? null,
        parsedReferences: parseInput
          ? discoverItalianLegalReferences(parseInput).map((reference) => ({
              kind: reference.kind,
              authorityHint: reference.authorityHint,
              actType: reference.actType,
              actNumber: reference.actNumber,
              year: reference.year,
              chamberSection: reference.chamberSection,
            }))
          : [],
      };
    });
    return NextResponse.json({
      mission,
      candidates,
      assessments,
      credentials: {
        legalDataHunterPresent:
          typeof process.env.LEGAL_DATA_HUNTER_API_KEY === "string"
          && process.env.LEGAL_DATA_HUNTER_API_KEY.trim().length > 0,
        moonlitGateTokenPresent:
          typeof process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN === "string"
          && process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN.trim().length > 0,
      },
      protectedMission: {
        id: protectedMission?.id ?? null,
        status: protectedMission?.status ?? null,
        attemptCount: protectedMission?.executionAttempts.length ?? 0,
        bundleCount: protectedBundleCount,
        digest: digest(protectedView),
      },
    }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500, headers: NO_STORE },
    );
  }
}
