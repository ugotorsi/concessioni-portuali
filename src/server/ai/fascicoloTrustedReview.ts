import { z } from "zod";

import type {
  AiFascicoloOutboundAnalysisV1,
  AiFascicoloResolvedAnalysisBasisRefV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  providerAnalysisPayloadV1Schema,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import type { AiFascicoloOutboundAliasKind } from "@/server/ai/fascicoloOutboundProjection";

export const AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION =
  "ai-fascicolo-trusted-review/v1" as const;

export type AiFascicoloEvidenceResolutionStatusV1 =
  | "RESOLVED"
  | "MISSING_LOCAL_EVIDENCE"
  | "NO_BASIS_REFS"
  | "REQUIRES_HUMAN_REVIEW";

export type AiFascicoloLocalValueV1 =
  | string
  | number
  | boolean
  | null
  | readonly AiFascicoloLocalValueV1[]
  | { readonly [key: string]: AiFascicoloLocalValueV1 };

type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type ProviderStatementV1 =
  | ProviderAnalysisPayloadV1["summary"]
  | ProviderAnalysisPayloadV1["timeline"][number]
  | ProviderAnalysisPayloadV1["recordedState"][number]
  | ProviderAnalysisPayloadV1["signals"][number]
  | ProviderAnalysisPayloadV1["investigativeQuestions"][number]
  | ProviderAnalysisPayloadV1["suggestedActivities"][number]
  | ProviderAnalysisPayloadV1["legalResearchQuestions"][number];

export interface AiFascicoloAuthoritativeLocalEvidenceV1 {
  readonly displayLabel: string;
  readonly fieldLabel?: string;
  readonly value: AiFascicoloLocalValueV1;
}

export interface AiFascicoloAuthoritativeEntityEvidenceV1 {
  readonly kind: AiFascicoloOutboundAliasKind;
  readonly canonicalId: string;
  readonly validatedFieldPath: string | null;
  readonly local: AiFascicoloAuthoritativeLocalEvidenceV1;
}

export interface AiFascicoloAuthoritativeNonEntityEvidenceV1 {
  readonly contextId: string;
  readonly validatedFieldPath: string;
  readonly local: AiFascicoloAuthoritativeLocalEvidenceV1;
}

export interface AiFascicoloAuthoritativeEvidenceInputV1 {
  readonly nonEntityContextId: string;
  readonly entities: readonly AiFascicoloAuthoritativeEntityEvidenceV1[];
  readonly nonEntities: readonly AiFascicoloAuthoritativeNonEntityEvidenceV1[];
}

export interface AiFascicoloTrustedReviewEvidenceV1 {
  readonly providerRef: string;
  readonly referenceType: "ENTITY" | "NON_ENTITY";
  readonly alias: string | null;
  readonly kind: AiFascicoloOutboundAliasKind | null;
  readonly canonicalId: string | null;
  readonly validatedFieldPath: string | null;
  readonly resolutionStatus: Exclude<
    AiFascicoloEvidenceResolutionStatusV1,
    "NO_BASIS_REFS"
  >;
  readonly local: (DeepReadonly<AiFascicoloAuthoritativeLocalEvidenceV1> & {
    readonly provenance: "LOCAL_AUTHORITATIVE_DATA";
  }) | null;
}

export interface AiFascicoloTrustedReviewStatementV1 {
  readonly statementPath: string;
  readonly providerStatement: {
    readonly provenance: "AI_ORIGINAL";
    readonly content: DeepReadonly<ProviderStatementV1>;
  };
  readonly resolutionStatus: AiFascicoloEvidenceResolutionStatusV1;
  readonly evidence: readonly AiFascicoloTrustedReviewEvidenceV1[];
}

export interface AiFascicoloTrustedReviewV1 {
  readonly schemaVersion: typeof AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION;
  readonly purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW";
  readonly providerAnalysis: {
    readonly provenance: "AI_ORIGINAL";
    readonly content: DeepReadonly<ProviderAnalysisPayloadV1>;
  };
  readonly statements: readonly AiFascicoloTrustedReviewStatementV1[];
}

export class AiFascicoloTrustedReviewValidationError extends Error {
  readonly code = "INVALID_TRUSTED_REVIEW" as const;

  constructor() {
    super("INVALID_TRUSTED_REVIEW");
    this.name = "AiFascicoloTrustedReviewValidationError";
  }
}

const ALIAS_KIND_VALUES_BASE = [
  "PROCEDIMENTO",
  "ENTE",
  "CONCESSIONE",
  "CONCESSIONARIO",
  "RESPONSIBILITY_ASSIGNMENT",
  "REQUIREMENT",
  "EVIDENCE",
  "HUMAN_REVIEW",
  "CHECKLIST_EVIDENCE",
  "OBSERVATION",
  "DOCUMENT",
  "ISSUE",
  "PAYMENT",
  "DEADLINE",
  "INSPECTION",
  "FINAL_ACT",
] as const satisfies readonly AiFascicoloOutboundAliasKind[];
type MissingAliasKind = Exclude<
  AiFascicoloOutboundAliasKind,
  (typeof ALIAS_KIND_VALUES_BASE)[number]
>;
const ALIAS_KIND_VALUES: MissingAliasKind extends never
  ? typeof ALIAS_KIND_VALUES_BASE
  : never = ALIAS_KIND_VALUES_BASE;

const localValueSchema: z.ZodType<AiFascicoloLocalValueV1> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(localValueSchema),
  z.record(z.string(), localValueSchema),
]));
const localEvidenceSchema = z.object({
  provenance: z.literal("LOCAL_AUTHORITATIVE_DATA"),
  displayLabel: z.string(),
  fieldLabel: z.string().optional(),
  value: localValueSchema,
}).strict();
const evidenceSchema = z.object({
  providerRef: z.string(),
  referenceType: z.enum(["ENTITY", "NON_ENTITY"]),
  alias: z.string().nullable(),
  kind: z.enum(ALIAS_KIND_VALUES).nullable(),
  canonicalId: z.string().nullable(),
  validatedFieldPath: z.string().nullable(),
  resolutionStatus: z.enum([
    "RESOLVED",
    "MISSING_LOCAL_EVIDENCE",
    "REQUIRES_HUMAN_REVIEW",
  ]),
  local: localEvidenceSchema.nullable(),
}).strict();
const providerStatementContentSchema = z.union([
  providerAnalysisPayloadV1Schema.shape.summary,
  providerAnalysisPayloadV1Schema.shape.timeline.element,
  providerAnalysisPayloadV1Schema.shape.recordedState.element,
  providerAnalysisPayloadV1Schema.shape.signals.element,
  providerAnalysisPayloadV1Schema.shape.investigativeQuestions.element,
  providerAnalysisPayloadV1Schema.shape.suggestedActivities.element,
  providerAnalysisPayloadV1Schema.shape.legalResearchQuestions.element,
]);
const trustedReviewSchema = z.object({
  schemaVersion: z.literal(AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION),
  purpose: z.literal("INTERNAL_COMPANY_PROFESSIONAL_REVIEW"),
  providerAnalysis: z.object({
    provenance: z.literal("AI_ORIGINAL"),
    content: providerAnalysisPayloadV1Schema,
  }).strict(),
  statements: z.array(z.object({
    statementPath: z.string(),
    providerStatement: z.object({
      provenance: z.literal("AI_ORIGINAL"),
      content: providerStatementContentSchema,
    }).strict(),
    resolutionStatus: z.enum([
      "RESOLVED",
      "MISSING_LOCAL_EVIDENCE",
      "NO_BASIS_REFS",
      "REQUIRES_HUMAN_REVIEW",
    ]),
    evidence: z.array(evidenceSchema),
  }).strict()),
}).strict();

function cloneJsonDomainValue(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AiFascicoloTrustedReviewValidationError();
    }
    return value;
  }
  if (typeof value !== "object" || active.has(value)) {
    throw new AiFascicoloTrustedReviewValidationError();
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new AiFascicoloTrustedReviewValidationError();
  }

  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    if (Array.isArray(value)) {
      if (
        names.length !== value.length + 1
        || names.some((name) => name !== "length" && (
          !Number.isInteger(Number(name))
          || Number(name) < 0
          || Number(name) >= value.length
          || String(Number(name)) !== name
        ))
      ) {
        throw new AiFascicoloTrustedReviewValidationError();
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new AiFascicoloTrustedReviewValidationError();
        }
        result.push(cloneJsonDomainValue(descriptor.value, active));
      }
      return result;
    }

    const entries: [string, unknown][] = [];
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new AiFascicoloTrustedReviewValidationError();
      }
      entries.push([name, cloneJsonDomainValue(descriptor.value, active)]);
    }
    return Object.fromEntries(entries);
  } finally {
    active.delete(value);
  }
}

function clonePlainValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainValue(item)) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Trusted review data must contain only plain JSON-like values.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, clonePlainValue(item)]),
  ) as T;
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

function assertAiFascicoloTrustedReviewV1(
  value: unknown,
): asserts value is AiFascicoloTrustedReviewV1 {
  if (!trustedReviewSchema.safeParse(value).success) {
    throw new AiFascicoloTrustedReviewValidationError();
  }
}

export function parseAiFascicoloTrustedReviewV1(input: unknown): AiFascicoloTrustedReviewV1 {
  try {
    const jsonDomainInput = cloneJsonDomainValue(input, new WeakSet<object>());
    assertAiFascicoloTrustedReviewV1(jsonDomainInput);
    return deepFreeze(jsonDomainInput);
  } catch (error) {
    if (error instanceof AiFascicoloTrustedReviewValidationError) {
      throw error;
    }
    throw new AiFascicoloTrustedReviewValidationError();
  }
}

function collectProviderStatements(
  analysis: DeepReadonly<ProviderAnalysisPayloadV1>,
): readonly { readonly statementPath: string; readonly content: DeepReadonly<ProviderStatementV1> }[] {
  const statements: { statementPath: string; content: DeepReadonly<ProviderStatementV1> }[] = [
    { statementPath: "summary", content: analysis.summary },
  ];
  const addSection = (
    section: string,
    items: readonly DeepReadonly<ProviderStatementV1>[],
  ): void => {
    items.forEach((content, index) => {
      statements.push({ statementPath: `${section}[${index}]`, content });
    });
  };

  addSection("timeline", analysis.timeline);
  addSection("recordedState", analysis.recordedState);
  addSection("signals", analysis.signals);
  addSection("investigativeQuestions", analysis.investigativeQuestions);
  addSection("suggestedActivities", analysis.suggestedActivities);
  addSection("legalResearchQuestions", analysis.legalResearchQuestions);
  return statements;
}

function localSidecar(
  matches: readonly AiFascicoloAuthoritativeLocalEvidenceV1[],
): Pick<AiFascicoloTrustedReviewEvidenceV1, "resolutionStatus" | "local"> {
  if (matches.length === 0) {
    return { resolutionStatus: "MISSING_LOCAL_EVIDENCE", local: null };
  }
  if (matches.length > 1) {
    return { resolutionStatus: "REQUIRES_HUMAN_REVIEW", local: null };
  }
  return {
    resolutionStatus: "RESOLVED",
    local: {
      provenance: "LOCAL_AUTHORITATIVE_DATA",
      ...clonePlainValue(matches[0]),
    },
  };
}

function rehydrateEvidence(
  resolved: AiFascicoloResolvedAnalysisBasisRefV1,
  authoritative: AiFascicoloAuthoritativeEvidenceInputV1,
): AiFascicoloTrustedReviewEvidenceV1 {
  let sidecar: Pick<AiFascicoloTrustedReviewEvidenceV1, "resolutionStatus" | "local">;
  if (resolved.referenceType === "ENTITY") {
    if (resolved.kind === null || resolved.canonicalId === null) {
      sidecar = { resolutionStatus: "REQUIRES_HUMAN_REVIEW", local: null };
    } else {
      sidecar = localSidecar(
        authoritative.entities
          .filter((item) => (
            item.kind === resolved.kind
            && item.canonicalId === resolved.canonicalId
            && item.validatedFieldPath === resolved.validatedFieldPath
          ))
          .map((item) => item.local),
      );
    }
  } else if (resolved.validatedFieldPath === null) {
    sidecar = { resolutionStatus: "REQUIRES_HUMAN_REVIEW", local: null };
  } else {
    sidecar = localSidecar(
      authoritative.nonEntities
        .filter((item) => (
          item.contextId === authoritative.nonEntityContextId
          && item.validatedFieldPath === resolved.validatedFieldPath
        ))
        .map((item) => item.local),
    );
  }

  return {
    providerRef: resolved.providerRef,
    referenceType: resolved.referenceType,
    alias: resolved.alias,
    kind: resolved.kind,
    canonicalId: resolved.canonicalId,
    validatedFieldPath: resolved.validatedFieldPath,
    ...sidecar,
  };
}

function statementStatus(
  evidence: readonly AiFascicoloTrustedReviewEvidenceV1[],
): AiFascicoloEvidenceResolutionStatusV1 {
  if (evidence.length === 0) {
    return "NO_BASIS_REFS";
  }
  if (evidence.some((item) => item.resolutionStatus === "REQUIRES_HUMAN_REVIEW")) {
    return "REQUIRES_HUMAN_REVIEW";
  }
  if (evidence.some((item) => item.resolutionStatus === "MISSING_LOCAL_EVIDENCE")) {
    return "MISSING_LOCAL_EVIDENCE";
  }
  return "RESOLVED";
}

export function buildAiFascicoloTrustedReviewV1(input: {
  readonly trustedResult: AiFascicoloOutboundAnalysisV1;
  readonly authoritativeEvidence: AiFascicoloAuthoritativeEvidenceInputV1;
}): AiFascicoloTrustedReviewV1 {
  const providerAnalysis = clonePlainValue(input.trustedResult.analysis) as DeepReadonly<
    ProviderAnalysisPayloadV1
  >;
  const statements = collectProviderStatements(providerAnalysis).map(({ statementPath, content }) => {
    const evidence = input.trustedResult.resolvedBasisRefs
      .filter((item) => item.statementPath === statementPath)
      .map((item) => rehydrateEvidence(item, input.authoritativeEvidence));
    return {
      statementPath,
      providerStatement: {
        provenance: "AI_ORIGINAL" as const,
        content,
      },
      resolutionStatus: statementStatus(evidence),
      evidence,
    };
  });

  return parseAiFascicoloTrustedReviewV1({
    schemaVersion: AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION,
    purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW",
    providerAnalysis: {
      provenance: "AI_ORIGINAL",
      content: providerAnalysis,
    },
    statements,
  });
}