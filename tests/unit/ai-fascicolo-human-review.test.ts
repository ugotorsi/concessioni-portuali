import { describe, expect, it } from "vitest";

import {
  AiFascicoloHumanReviewError,
  buildAiFascicoloHumanReviewEventV1,
  deriveAiFascicoloHumanReviewCurrentStateV1,
  type AiFascicoloHumanReviewActorV1,
  type AiFascicoloHumanReviewCommandV1,
  type AiFascicoloHumanReviewEventV1,
} from "@/server/ai/fascicoloHumanReview";
import type { AiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";

const OCCURRED_AT = "2026-08-18T12:00:00.000Z";

function trustedReviewFixture(): AiFascicoloTrustedReviewV1 {
  return {
    schemaVersion: "ai-fascicolo-trusted-review/v1",
    purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW",
    providerAnalysis: {
      provenance: "AI_ORIGINAL",
      content: {
        summary: { text: "Provider statement DOC_1", basisRefs: ["DOC_1"] },
        timeline: [],
        recordedState: [],
        signals: [],
        investigativeQuestions: [{ text: "Second statement", basisRefs: [] }],
        suggestedActivities: [],
        legalResearchQuestions: [],
      },
    },
    statements: [
      {
        statementPath: "summary",
        providerStatement: {
          provenance: "AI_ORIGINAL",
          content: { text: "Provider statement DOC_1", basisRefs: ["DOC_1"] },
        },
        resolutionStatus: "RESOLVED",
        evidence: [{
          providerRef: "DOC_1",
          referenceType: "ENTITY",
          alias: "DOC_1",
          kind: "DOCUMENT",
          canonicalId: "document-1",
          validatedFieldPath: null,
          resolutionStatus: "RESOLVED",
          local: {
            provenance: "LOCAL_AUTHORITATIVE_DATA",
            displayLabel: "Document 1",
            value: "authoritative value",
          },
        }],
      },
      {
        statementPath: "investigativeQuestions[0]",
        providerStatement: {
          provenance: "AI_ORIGINAL",
          content: { text: "Second statement", basisRefs: [] },
        },
        resolutionStatus: "NO_BASIS_REFS",
        evidence: [],
      },
    ],
  };
}

function humanActorFixture(): AiFascicoloHumanReviewActorV1 {
  return {
    actorType: "HUMAN_INTERNAL_COMPANY_OPERATOR",
    userId: "user-1",
    actorId: "actor-1",
    email: "operator@example.test",
    role: "GIURIDICO",
  };
}

function buildEvent(
  command: AiFascicoloHumanReviewCommandV1,
  input?: {
    trustedReview?: AiFascicoloTrustedReviewV1;
    statementPath?: string;
    actor?: AiFascicoloHumanReviewActorV1 | null;
    occurredAt?: string;
  },
): AiFascicoloHumanReviewEventV1 {
  return buildAiFascicoloHumanReviewEventV1({
    trustedReview: input?.trustedReview ?? trustedReviewFixture(),
    statementPath: input?.statementPath ?? "summary",
    actor: (input && Object.hasOwn(input, "actor")
      ? input.actor
      : humanActorFixture()) as AiFascicoloHumanReviewActorV1,
    occurredAt: input?.occurredAt ?? OCCURRED_AT,
    command,
  });
}

function assertCompleteGraphFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    assertCompleteGraphFrozen(child, seen);
  }
}

function expectDomainError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected domain error");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloHumanReviewError);
    expect((error as AiFascicoloHumanReviewError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

describe("AI-01C2B4B1 human company review domain", () => {
  it("builds an immutable statement-oriented COMPANY_ACCEPTED event", () => {
    const event = buildEvent({ disposition: "COMPANY_ACCEPTED", note: "Usabile internamente" });

    expect(event).toEqual({
      schemaVersion: "ai-fascicolo-human-review-event/v1",
      provenance: "COMPANY_REVIEW",
      target: { statementPath: "summary" },
      disposition: "COMPANY_ACCEPTED",
      actor: humanActorFixture(),
      occurredAt: OCCURRED_AT,
      note: "Usabile internamente",
    });
    assertCompleteGraphFrozen(event);
  });

  it.each([
    ["unknown path", "timeline[99]"],
    ["statement text", "Provider statement DOC_1"],
  ])("fails closed for %s instead of matching arbitrary target input", (_name, statementPath) => {
    expectDomainError(
      () => buildEvent({ disposition: "COMPANY_ACCEPTED" }, { statementPath }),
      "INVALID_REVIEW_TARGET",
    );
  });

  it("derives UNREVIEWED only when the statement has no events", () => {
    const state = deriveAiFascicoloHumanReviewCurrentStateV1({
      trustedReview: trustedReviewFixture(),
      statementPath: "summary",
      orderedEvents: [],
    });

    expect(state).toEqual({
      target: { statementPath: "summary" },
      status: "UNREVIEWED",
      latestEvent: null,
    });
    assertCompleteGraphFrozen(state);
  });

  it("does not expose UNREVIEWED as a constructible event disposition", () => {
    expectDomainError(
      () => buildEvent({ disposition: "UNREVIEWED" } as unknown as AiFascicoloHumanReviewCommandV1),
      "INVALID_REVIEW_COMMAND",
    );
  });

  it.each([
    ["null actor", null],
    ["null user", { ...humanActorFixture(), userId: null }],
    ["empty user", { ...humanActorFixture(), userId: "" }],
    ["technical actor", { ...humanActorFixture(), actorType: "SYSTEM" }],
  ])("rejects %s", (_name, actor) => {
    expectDomainError(
      () => buildEvent(
        { disposition: "COMPANY_ACCEPTED" },
        { actor: actor as unknown as AiFascicoloHumanReviewActorV1 },
      ),
      "INVALID_HUMAN_ACTOR",
    );
  });

  it.each([
    ["COMPANY_REJECTED", { disposition: "COMPANY_REJECTED", reason: "" }],
    [
      "COMPANY_NEEDS_VERIFICATION",
      { disposition: "COMPANY_NEEDS_VERIFICATION", reason: "   " },
    ],
  ] as const)("requires a non-empty reason for %s", (_name, command) => {
    expectDomainError(() => buildEvent(command), "INVALID_REVIEW_COMMAND");
  });

  it("requires separate non-empty amendment text and reason", () => {
    for (const amendment of [
      { text: "", reason: "Motivo" },
      { text: "Testo professionale", reason: "" },
    ]) {
      expectDomainError(
        () => buildEvent({ disposition: "COMPANY_AMENDED", amendment }),
        "INVALID_REVIEW_COMMAND",
      );
    }
  });

  it("keeps a company amendment separate without copying or rewriting C2B4A material", () => {
    const trustedReview = trustedReviewFixture();
    const before = JSON.stringify(trustedReview);
    const event = buildEvent({
      disposition: "COMPANY_AMENDED",
      amendment: { text: "Company-authored integration", reason: "Professional correction" },
    }, { trustedReview });

    expect(JSON.stringify(trustedReview)).toBe(before);
    expect(event.amendment).toEqual({
      provenance: "COMPANY_AMENDMENT",
      text: "Company-authored integration",
      reason: "Professional correction",
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Provider statement DOC_1");
    expect(serialized).not.toContain("authoritative value");
    expect(serialized).not.toContain("document-1");
    expect(event.target).toEqual({ statementPath: "summary" });
  });

  it("isolates event actor and amendment from caller mutation", () => {
    const actor = humanActorFixture() as { -readonly [Key in keyof AiFascicoloHumanReviewActorV1]: AiFascicoloHumanReviewActorV1[Key] };
    const amendment = { text: "Original amendment", reason: "Original reason" };
    const event = buildEvent({ disposition: "COMPANY_AMENDED", amendment }, { actor });

    actor.email = "changed@example.test";
    amendment.text = "Changed amendment";
    amendment.reason = "Changed reason";

    expect(event.actor.email).toBe("operator@example.test");
    expect(event.amendment).toMatchObject({
      text: "Original amendment",
      reason: "Original reason",
    });
    assertCompleteGraphFrozen(event);
  });

  it("appends non-terminal dispositions conceptually and derives the latest event", () => {
    const accepted = buildEvent({ disposition: "COMPANY_ACCEPTED" });
    const acceptedBefore = JSON.stringify(accepted);
    const needsVerification = buildEvent({
      disposition: "COMPANY_NEEDS_VERIFICATION",
      reason: "Nuova verifica necessaria",
    });
    const amended = buildEvent({
      disposition: "COMPANY_AMENDED",
      amendment: { text: "Testo successivo", reason: "Integrazione professionale" },
    });

    const state = deriveAiFascicoloHumanReviewCurrentStateV1({
      trustedReview: trustedReviewFixture(),
      statementPath: "summary",
      orderedEvents: [accepted, needsVerification, amended],
    });

    expect(JSON.stringify(accepted)).toBe(acceptedBefore);
    expect(state.status).toBe("COMPANY_AMENDED");
    expect(state.latestEvent).toEqual(amended);
    expect(state.latestEvent).not.toBe(amended);
    assertCompleteGraphFrozen(state);
  });

  it.each([
    [
      { disposition: "COMPANY_ACCEPTED" as const },
      { disposition: "COMPANY_AMENDED" as const, amendment: { text: "A", reason: "R" } },
    ],
    [
      { disposition: "COMPANY_REJECTED" as const, reason: "R" },
      { disposition: "COMPANY_ACCEPTED" as const },
    ],
  ])("allows a later event after accepted or rejected without mutating history", (first, second) => {
    const firstEvent = buildEvent(first);
    const secondEvent = buildEvent(second);
    const history = Object.freeze([firstEvent, secondEvent]);

    const state = deriveAiFascicoloHumanReviewCurrentStateV1({
      trustedReview: trustedReviewFixture(),
      statementPath: "summary",
      orderedEvents: history,
    });

    expect(state.status).toBe(second.disposition);
    expect(history).toEqual([firstEvent, secondEvent]);
  });

  it("rejects event history belonging to another statement", () => {
    const otherStatementEvent = buildEvent(
      { disposition: "COMPANY_ACCEPTED" },
      { statementPath: "investigativeQuestions[0]" },
    );

    expectDomainError(
      () => deriveAiFascicoloHumanReviewCurrentStateV1({
        trustedReview: trustedReviewFixture(),
        statementPath: "summary",
        orderedEvents: [otherStatementEvent],
      }),
      "INVALID_REVIEW_EVENT_HISTORY",
    );
  });

  it("exposes only company-review dispositions and no legal or administrative outcome", () => {
    const events = [
      buildEvent({ disposition: "COMPANY_ACCEPTED" }),
      buildEvent({ disposition: "COMPANY_REJECTED", reason: "R" }),
      buildEvent({ disposition: "COMPANY_NEEDS_VERIFICATION", reason: "R" }),
      buildEvent({
        disposition: "COMPANY_AMENDED",
        amendment: { text: "A", reason: "R" },
      }),
    ];
    const serialized = JSON.stringify(events);

    for (const forbidden of [
      "APPLICATION_APPROVED",
      "APPLICATION_REJECTED",
      "CONCESSION_VALID",
      "CONCESSION_INVALID",
      "REVOCATION_REQUIRED",
      "RENEWAL_REQUIRED",
      "SANCTION_REQUIRED",
      "LEGAL_COMPLIANT",
      "LEGAL_NON_COMPLIANT",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});