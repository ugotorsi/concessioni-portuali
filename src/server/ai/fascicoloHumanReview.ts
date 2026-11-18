import type { AiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";

export const AI_FASCICOLO_HUMAN_REVIEW_EVENT_V1_SCHEMA_VERSION =
  "ai-fascicolo-human-review-event/v1" as const;

export type AiFascicoloCompanyReviewDispositionV1 =
  | "COMPANY_ACCEPTED"
  | "COMPANY_REJECTED"
  | "COMPANY_NEEDS_VERIFICATION"
  | "COMPANY_AMENDED";

export type AiFascicoloCompanyReviewCurrentStatusV1 =
  | "UNREVIEWED"
  | AiFascicoloCompanyReviewDispositionV1;

export interface AiFascicoloHumanReviewActorV1 {
  readonly actorType: "HUMAN_INTERNAL_COMPANY_OPERATOR";
  readonly userId: string;
  readonly actorId: string;
  readonly email: string;
  readonly role: string;
}

export interface AiFascicoloCompanyAmendmentV1 {
  readonly provenance: "COMPANY_AMENDMENT";
  readonly text: string;
  readonly reason: string;
}

export type AiFascicoloHumanReviewCommandV1 =
  | {
      readonly disposition: "COMPANY_ACCEPTED";
      readonly note?: string;
    }
  | {
      readonly disposition: "COMPANY_REJECTED";
      readonly reason: string;
    }
  | {
      readonly disposition: "COMPANY_NEEDS_VERIFICATION";
      readonly reason: string;
    }
  | {
      readonly disposition: "COMPANY_AMENDED";
      readonly amendment: {
        readonly text: string;
        readonly reason: string;
      };
    };

export interface AiFascicoloHumanReviewEventV1 {
  readonly schemaVersion: typeof AI_FASCICOLO_HUMAN_REVIEW_EVENT_V1_SCHEMA_VERSION;
  readonly provenance: "COMPANY_REVIEW";
  readonly target: {
    readonly statementPath: string;
  };
  readonly disposition: AiFascicoloCompanyReviewDispositionV1;
  readonly actor: AiFascicoloHumanReviewActorV1;
  readonly occurredAt: string;
  readonly note?: string;
  readonly reason?: string;
  readonly amendment?: AiFascicoloCompanyAmendmentV1;
}

export interface AiFascicoloHumanReviewCurrentStateV1 {
  readonly target: {
    readonly statementPath: string;
  };
  readonly status: AiFascicoloCompanyReviewCurrentStatusV1;
  readonly latestEvent: AiFascicoloHumanReviewEventV1 | null;
}

type HumanReviewErrorCode =
  | "INVALID_REVIEW_TARGET"
  | "INVALID_HUMAN_ACTOR"
  | "INVALID_REVIEW_COMMAND"
  | "INVALID_REVIEW_EVENT_HISTORY";

export class AiFascicoloHumanReviewError extends Error {
  constructor(readonly code: HumanReviewErrorCode) {
    super(code);
    this.name = "AiFascicoloHumanReviewError";
  }
}

function fail(code: HumanReviewErrorCode): never {
  throw new AiFascicoloHumanReviewError(code);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatedStatementPath(
  trustedReview: AiFascicoloTrustedReviewV1,
  statementPath: string,
): string {
  if (!nonEmpty(statementPath)) {
    return fail("INVALID_REVIEW_TARGET");
  }
  const matches = trustedReview.statements.filter(
    (statement) => statement.statementPath === statementPath,
  );
  if (matches.length !== 1) {
    return fail("INVALID_REVIEW_TARGET");
  }
  return matches[0].statementPath;
}

function validatedActor(actor: AiFascicoloHumanReviewActorV1): AiFascicoloHumanReviewActorV1 {
  if (
    !actor
    || actor.actorType !== "HUMAN_INTERNAL_COMPANY_OPERATOR"
    || !nonEmpty(actor.userId)
    || !nonEmpty(actor.actorId)
    || !nonEmpty(actor.email)
    || !nonEmpty(actor.role)
  ) {
    return fail("INVALID_HUMAN_ACTOR");
  }
  return {
    actorType: "HUMAN_INTERNAL_COMPANY_OPERATOR",
    userId: actor.userId,
    actorId: actor.actorId,
    email: actor.email,
    role: actor.role,
  };
}

function validatedOccurredAt(occurredAt: string): string {
  if (!nonEmpty(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    return fail("INVALID_REVIEW_COMMAND");
  }
  return occurredAt;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function buildAiFascicoloHumanReviewEventV1(input: {
  readonly trustedReview: AiFascicoloTrustedReviewV1;
  readonly statementPath: string;
  readonly actor: AiFascicoloHumanReviewActorV1;
  readonly occurredAt: string;
  readonly command: AiFascicoloHumanReviewCommandV1;
}): AiFascicoloHumanReviewEventV1 {
  const statementPath = validatedStatementPath(input.trustedReview, input.statementPath);
  const actor = validatedActor(input.actor);
  const occurredAt = validatedOccurredAt(input.occurredAt);
  const base = {
    schemaVersion: AI_FASCICOLO_HUMAN_REVIEW_EVENT_V1_SCHEMA_VERSION,
    provenance: "COMPANY_REVIEW" as const,
    target: { statementPath },
    actor,
    occurredAt,
  };

  switch (input.command.disposition) {
    case "COMPANY_ACCEPTED": {
      if (input.command.note !== undefined && !nonEmpty(input.command.note)) {
        return fail("INVALID_REVIEW_COMMAND");
      }
      return deepFreeze({
        ...base,
        disposition: input.command.disposition,
        ...(input.command.note === undefined ? {} : { note: input.command.note }),
      });
    }
    case "COMPANY_REJECTED":
    case "COMPANY_NEEDS_VERIFICATION": {
      if (!nonEmpty(input.command.reason)) {
        return fail("INVALID_REVIEW_COMMAND");
      }
      return deepFreeze({
        ...base,
        disposition: input.command.disposition,
        reason: input.command.reason,
      });
    }
    case "COMPANY_AMENDED": {
      if (
        !input.command.amendment
        || !nonEmpty(input.command.amendment.text)
        || !nonEmpty(input.command.amendment.reason)
      ) {
        return fail("INVALID_REVIEW_COMMAND");
      }
      return deepFreeze({
        ...base,
        disposition: input.command.disposition,
        reason: input.command.amendment.reason,
        amendment: {
          provenance: "COMPANY_AMENDMENT",
          text: input.command.amendment.text,
          reason: input.command.amendment.reason,
        },
      });
    }
    default:
      return fail("INVALID_REVIEW_COMMAND");
  }
}

export function deriveAiFascicoloHumanReviewCurrentStateV1(input: {
  readonly trustedReview: AiFascicoloTrustedReviewV1;
  readonly statementPath: string;
  readonly orderedEvents: readonly AiFascicoloHumanReviewEventV1[];
}): AiFascicoloHumanReviewCurrentStateV1 {
  const statementPath = validatedStatementPath(input.trustedReview, input.statementPath);
  for (const event of input.orderedEvents) {
    if (
      event.schemaVersion !== AI_FASCICOLO_HUMAN_REVIEW_EVENT_V1_SCHEMA_VERSION
      || event.target.statementPath !== statementPath
    ) {
      return fail("INVALID_REVIEW_EVENT_HISTORY");
    }
  }

  const latestEvent = input.orderedEvents.at(-1) ?? null;
  if (latestEvent === null) {
    return deepFreeze({
      target: { statementPath },
      status: "UNREVIEWED",
      latestEvent: null,
    });
  }

  return deepFreeze({
    target: { statementPath },
    status: latestEvent.disposition,
    latestEvent: {
      ...latestEvent,
      target: { ...latestEvent.target },
      actor: { ...latestEvent.actor },
      ...(latestEvent.amendment ? { amendment: { ...latestEvent.amendment } } : {}),
    },
  });
}