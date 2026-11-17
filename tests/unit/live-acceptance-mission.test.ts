import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LIVE_ACCEPTANCE_BUDGET,
  LIVE_ACCEPTANCE_CASE_REFERENCE,
  LIVE_ACCEPTANCE_QUESTION,
  LiveAcceptanceMissionError,
  createLiveAcceptanceMission,
  runLiveAcceptanceMission,
} from "@/server/legal-research/live-acceptance-mission";
import { validateResearchMission } from "@/server/legal-research/bridge";

const referenceDate = "2026-09-18T00:00:00.000Z";

describe("Block 3B.14B live acceptance mission harness", () => {
  it("creates a valid deterministic non-confidential mission", () => {
    const first = createLiveAcceptanceMission(referenceDate);
    const second = createLiveAcceptanceMission(referenceDate);

    expect(validateResearchMission(first)).toEqual([]);
    expect(first).toEqual(second);
    expect(first.missionId).toBe(second.missionId);
    expect(first.caseReference).toEqual({
      caseId: LIVE_ACCEPTANCE_CASE_REFERENCE,
      fascicoloReference: LIVE_ACCEPTANCE_CASE_REFERENCE,
    });
    expect(first.referenceDate).toBe(referenceDate);
    expect(first.mode).toBe("CROSS_JURISDICTION_CHECK");
    expect(first.preferredSourceFamilies).toEqual([
      "ITALIAN_LEGISLATION",
      "EU_LEGISLATION",
      "GIUSTIZIA_AMMINISTRATIVA",
      "CASSAZIONE",
      "CJEU",
    ]);
    expect(first.budget).toEqual(LIVE_ACCEPTANCE_BUDGET);
    expect(first.budget.maxTotalResearchCalls).toBe(15);
    expect(Math.max(
      first.budget.maxMoonlitCalls,
      first.budget.maxSimpliciterCalls,
      first.budget.maxLegalDataHunterCalls,
    )).toBeLessThanOrEqual(first.budget.maxTotalResearchCalls);
    expect(LIVE_ACCEPTANCE_QUESTION).not.toMatch(/Grassi|Travelmar|client|litigation|contenzioso/i);
  });

  it("requires an explicit legal reference date", () => {
    expect(() => createLiveAcceptanceMission("")).toThrowError(
      expect.objectContaining<Partial<LiveAcceptanceMissionError>>({ code: "REFERENCE_DATE_REQUIRED" }),
    );
    expect(() => createLiveAcceptanceMission("2026-09-18")).toThrowError(
      expect.objectContaining<Partial<LiveAcceptanceMissionError>>({ code: "REFERENCE_DATE_REQUIRED" }),
    );
  });

  it("defaults to a database-free dry run with bounded redacted output", async () => {
    const persist = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runLiveAcceptanceMission({
      referenceDate,
      target: "TEMP_VALIDATION",
      persist,
    });

    expect(result).toMatchObject({
      executionMode: "DRY_RUN",
      target: "TEMP_VALIDATION",
      caseReference: LIVE_ACCEPTANCE_CASE_REFERENCE,
      researchMode: "CROSS_JURISDICTION_CHECK",
      referenceDate,
      budget: LIVE_ACCEPTANCE_BUDGET,
    });
    expect(result.missionFingerprint).toBe(result.missionId);
    expect(result.questionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persist).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /DATABASE_URL|postgres(?:ql)?:\/\/|Bearer |access.?token|refresh.?token|api.?key|JWT|claim.?token|secret/i,
    );
    fetchSpy.mockRestore();
  });

  it("requires the enable flag and explicit operator identity before execution", async () => {
    const persist = vi.fn();
    await expect(runLiveAcceptanceMission({
      referenceDate,
      target: "TEMP_VALIDATION",
      execute: true,
      persist,
    })).rejects.toMatchObject({ code: "LIVE_ACCEPTANCE_NOT_ENABLED" });

    await expect(runLiveAcceptanceMission({
      referenceDate,
      target: "TEMP_VALIDATION",
      execute: true,
      enabled: "1",
      persist,
    })).rejects.toMatchObject({ code: "OPERATOR_IDENTITY_REQUIRED" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects production and unknown target classifications", async () => {
    await expect(runLiveAcceptanceMission({
      referenceDate,
      target: "PRODUCTION",
    })).rejects.toMatchObject({ code: "PRODUCTION_TARGET_FORBIDDEN" });
    await expect(runLiveAcceptanceMission({
      referenceDate,
      target: "preview.example.test",
    })).rejects.toMatchObject({ code: "EXPLICIT_NON_PRODUCTION_TARGET_REQUIRED" });
    await expect(runLiveAcceptanceMission({
      referenceDate,
      target: "TEMP_VALIDATION",
      vercelEnvironment: "production",
    })).rejects.toMatchObject({ code: "PRODUCTION_ENVIRONMENT_FORBIDDEN" });
  });

  it.each(["TEMP_VALIDATION", "PREVIEW_STAGING"])(
    "accepts the explicit non-production target %s",
    async (target) => {
      await expect(runLiveAcceptanceMission({ referenceDate, target })).resolves.toMatchObject({
        target,
        executionMode: "DRY_RUN",
      });
    },
  );

  it("delegates execution to the accepted persistence boundary", async () => {
    const persist = vi.fn().mockResolvedValue({ outcome: "CREATED" });
    const result = await runLiveAcceptanceMission({
      referenceDate,
      target: "TEMP_VALIDATION",
      execute: true,
      enabled: "1",
      actorId: "acceptance-operator",
      tenantId: "acceptance-tenant",
      persist,
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      mission: createLiveAcceptanceMission(referenceDate),
      actor: { actorId: "acceptance-operator", tenantId: "acceptance-tenant" },
    });
    expect(result).toMatchObject({ executionMode: "EXECUTE", persistenceOutcome: "CREATED" });
  });

  it("converges identical executions through persistence idempotency", async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({ outcome: "CREATED" })
      .mockResolvedValueOnce({ outcome: "REUSED" });
    const input = {
      referenceDate,
      target: "PREVIEW_STAGING",
      execute: true,
      enabled: "1",
      actorId: "acceptance-operator",
      tenantId: "acceptance-tenant",
      persist,
    } as const;

    const first = await runLiveAcceptanceMission(input);
    const second = await runLiveAcceptanceMission(input);
    expect(first.missionId).toBe(second.missionId);
    expect(first.persistenceOutcome).toBe("CREATED");
    expect(second.persistenceOutcome).toBe("REUSED");
    expect(persist.mock.calls[0][0].mission).toEqual(persist.mock.calls[1][0].mission);
  });

  it("contains no direct Prisma write or provider/LLM invocation", () => {
    const root = process.cwd();
    const sources = [
      readFileSync(path.join(root, "src/server/legal-research/live-acceptance-mission.ts"), "utf8"),
      readFileSync(path.join(root, "scripts/legal-research/create-live-acceptance-mission.ts"), "utf8"),
    ].join("\n");
    expect(sources).not.toMatch(
      /prisma\.|\.researchMissionRecord\.create|\bfetch\s*\(|create(?:LegalDataHunter|OpenGa|Normattiva)Provider|openai\.|chat\.completions/i,
    );
    expect(sources).toContain("createResearchMissionRecord");
  });
});