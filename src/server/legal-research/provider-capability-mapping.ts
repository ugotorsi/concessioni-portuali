import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";

import type { ResearchCapability } from "./bridge";

export type CatalogProvider = "MOONLIT" | "SIMPLICITER";
export type CapabilitySupport = "RESPONSE_VERIFIED" | "CATALOG_ONLY" | "NOT_CONFIRMED";

type JsonSchema = Readonly<Record<string, unknown>>;
type CatalogTool = Readonly<{
  inputSchema: JsonSchema;
  outputSchema: JsonSchema | null;
}>;

const nonBlankString = { type: "string", minLength: 1, pattern: "\\S" } as const;
const nullableStringArray = {
  type: ["null", "array"],
  items: nonBlankString,
} as const;
const referenceDependencies = {
  article_reference_id: ["reference_identifier"],
  from_date: ["until_date"],
  reference_direction: ["reference_identifier"],
  until_date: ["from_date"],
} as const;
const sharedSearchProperties = {
  query: nonBlankString,
  document_types: nullableStringArray,
  jurisdictions: nullableStringArray,
  portals: nullableStringArray,
  fields_of_law: nullableStringArray,
  sources: nullableStringArray,
  from_date: { type: "string" },
  until_date: { type: "string" },
  page: { type: "integer", minimum: 1, maximum: 1000 },
  num_results: { type: "integer", minimum: 1, maximum: 100 },
  reference_identifier: nonBlankString,
  reference_direction: { type: ["null", "integer"], minimum: 0, maximum: 2 },
  article_reference_id: { type: "string" },
  output_format: { type: "string", enum: ["toon", "json"] },
} as const;

const dynamicPayloadSchema = {
  type: "object",
  description: "Localized legal source payload. Keys depend on the user's country and source category.",
  additionalProperties: {
    type: "array",
    items: { type: "object", additionalProperties: true },
  },
} as const;

export const OBSERVED_PROVIDER_TOOL_SCHEMAS = {
  MOONLIT: {
    get_document: {
      inputSchema: {
        type: "object",
        properties: { document_identifier: nonBlankString },
        required: ["document_identifier"],
        additionalProperties: false,
      },
      outputSchema: null,
    },
    get_document_elements: {
      inputSchema: {
        type: "object",
        properties: {
          document_identifier: nonBlankString,
          hierarchy: { type: ["null", "boolean"] },
          include_html: { type: "boolean" },
        },
        required: ["document_identifier"],
        additionalProperties: false,
      },
      outputSchema: null,
    },
    search_document_citations: {
      inputSchema: {
        type: "object",
        properties: {
          reference_identifier: nonBlankString,
          reference_direction: { type: "integer", minimum: 0, maximum: 2 },
          article_reference_id: { type: "string" },
          document_types: nullableStringArray,
          jurisdictions: nullableStringArray,
          portals: nullableStringArray,
          fields_of_law: nullableStringArray,
          sources: nullableStringArray,
          from_date: { type: "string" },
          until_date: { type: "string" },
          sort_type: { type: "integer", enum: [0, 1, 2, 3] },
          page: { type: "integer", minimum: 1, maximum: 1000 },
          num_results: { type: "integer", minimum: 1, maximum: 100 },
          facets: { type: "boolean" },
          facet_limit: { type: "integer", minimum: 1, maximum: 4000 },
          output_format: { type: "string", enum: ["toon", "json"] },
        },
        required: ["reference_identifier"],
        dependentRequired: referenceDependencies,
        additionalProperties: false,
      },
      outputSchema: null,
    },
    search_legal_documents: {
      inputSchema: {
        type: "object",
        properties: {
          ...sharedSearchProperties,
          semantic_weight: { type: ["null", "number"], minimum: 0, maximum: 1 },
          reranker_type: { type: "integer", enum: [1, 2] },
        },
        required: ["query"],
        dependentRequired: referenceDependencies,
        additionalProperties: false,
      },
      outputSchema: null,
    },
    search_legal_documents_by_keyword: {
      inputSchema: {
        type: "object",
        properties: {
          ...sharedSearchProperties,
          sort_type: { type: "integer", enum: [0, 1, 2, 3] },
          facets: { type: "boolean" },
          all_facets: { type: "boolean" },
          facet_limit: { type: "integer", minimum: 1, maximum: 4000 },
        },
        required: ["query"],
        dependentRequired: referenceDependencies,
        additionalProperties: false,
      },
      outputSchema: null,
    },
  },
  SIMPLICITER: {
    list_available_sources: {
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          country: { type: ["string", "null"] },
          catalog_version: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source_key: { type: "string" },
                country: { type: "string" },
                kind: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                fetch_reference: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    tool_guidance: { type: "string" },
                    required_fields: { type: "array", items: { type: "string" } },
                    field_hints: { type: "object", additionalProperties: { type: "string" } },
                    accepted_values: {
                      type: "object",
                      additionalProperties: { type: "array", items: { type: "string" } },
                    },
                    examples: {
                      type: "array",
                      items: { type: "object", additionalProperties: { type: "string" } },
                    },
                    notes: { type: "array", items: { type: "string" } },
                  },
                  required: [
                    "description",
                    "tool_guidance",
                    "required_fields",
                    "field_hints",
                    "accepted_values",
                    "examples",
                    "notes",
                  ],
                  additionalProperties: false,
                },
              },
              required: ["source_key", "country", "kind", "title", "description", "fetch_reference"],
              additionalProperties: false,
            },
          },
        },
        required: ["country", "catalog_version", "sources"],
        additionalProperties: false,
      },
    },
    fetch_legal_source: {
      inputSchema: {
        type: "object",
        properties: {
          catalog_version: { type: "string" },
          top_n: { type: "integer", minimum: 1, maximum: 30 },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source_key: { type: "string" },
                number: { type: "string" },
                year: { type: "string" },
                court: { type: "string" },
                law: { type: "string" },
                entity: { type: "string" },
                type: { type: "string" },
              },
              required: ["source_key", "number"],
              additionalProperties: false,
            },
          },
        },
        required: ["sources"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          catalog_version: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
          payload: dynamicPayloadSchema,
        },
        required: ["catalog_version", "source_keys", "payload"],
        additionalProperties: false,
      },
    },
    legal_research: {
      inputSchema: {
        type: "object",
        properties: {
          catalog_version: { type: "string" },
          top_n: { type: "integer", minimum: 1, maximum: 30 },
          query: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          catalog_version: { type: "string" },
          query: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
          payload: dynamicPayloadSchema,
        },
        required: ["catalog_version", "query", "source_keys", "payload"],
        additionalProperties: false,
      },
    },
  },
} as const satisfies Readonly<Record<CatalogProvider, Readonly<Record<string, CatalogTool>>>>;

type CapabilityMapping = Readonly<{
  status: CapabilitySupport;
  toolNames: readonly string[];
}>;

const notConfirmed = { status: "NOT_CONFIRMED", toolNames: [] } as const;

export const PROVIDER_CAPABILITY_MAPPING = {
  MOONLIT: {
    SEMANTIC_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["search_legal_documents"] },
    KEYWORD_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["search_legal_documents_by_keyword"] },
    EXACT_RETRIEVAL: { status: "RESPONSE_VERIFIED", toolNames: ["get_document"] },
    FULL_TEXT_RETRIEVAL: { status: "CATALOG_ONLY", toolNames: ["get_document_elements"] },
    CITATION_NETWORK: { status: "CATALOG_ONLY", toolNames: ["search_document_citations"] },
    CROSS_JURISDICTION_DISCOVERY: { status: "CATALOG_ONLY", toolNames: ["search_legal_documents"] },
    ADVERSE_AUTHORITY_DISCOVERY: notConfirmed,
  },
  SIMPLICITER: {
    SEMANTIC_DISCOVERY: { status: "RESPONSE_VERIFIED", toolNames: ["legal_research"] },
    KEYWORD_DISCOVERY: notConfirmed,
    EXACT_RETRIEVAL: { status: "RESPONSE_VERIFIED", toolNames: ["list_available_sources", "fetch_legal_source"] },
    FULL_TEXT_RETRIEVAL: notConfirmed,
    CITATION_NETWORK: notConfirmed,
    CROSS_JURISDICTION_DISCOVERY: {
      status: "RESPONSE_VERIFIED",
      toolNames: ["list_available_sources", "legal_research"],
    },
    ADVERSE_AUTHORITY_DISCOVERY: notConfirmed,
  },
} as const satisfies Readonly<Record<
  CatalogProvider,
  Readonly<Record<ResearchCapability, CapabilityMapping>>
>>;

export const ADVERSE_AUTHORITY_DISCOVERY_CONTROL = Object.freeze({
  status: "NOT_CONFIRMED" as const,
  normalSearchMaySuggestAdverseAuthority: true,
  normalSearchCanVerifyAdverseAuthority: false,
  automaticVerificationForbidden: true,
  requiresObservedCitationRelation: true,
  requiresReliableTreatmentAssessment: true,
  humanReviewSteps: [
    "VERIFY_OFFICIAL_FULL_TEXT",
    "IDENTIFY_RELEVANT_LEGAL_PROPOSITION",
    "ASSESS_SUPPORT_DIRECTION_IN_CONTEXT",
    "RECORD_REASONED_TREATMENT_WITH_PROVENANCE",
  ] as const,
});

export type ProviderToolInputValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      code: "CAPABILITY_NOT_CONFIRMED" | "TOOL_NOT_MAPPED" | "INPUT_SCHEMA_INVALID";
    }>;

export type ProviderToolOutputValidation =
  | Readonly<{ status: "VALID" }>
  | Readonly<{ status: "NOT_VALIDATED"; reason: "OUTPUT_SCHEMA_NOT_PROVIDED" }>
  | Readonly<{ status: "INVALID"; code: "OUTPUT_SCHEMA_INVALID" | "TOOL_NOT_OBSERVED" }>;

const schemaValidator = new AjvJsonSchemaValidator();
const validators = new Map<string, ReturnType<typeof schemaValidator.getValidator>>();

function observedTool(provider: CatalogProvider, toolName: string): CatalogTool | undefined {
  return (OBSERVED_PROVIDER_TOOL_SCHEMAS[provider] as Readonly<Record<string, CatalogTool>>)[toolName];
}

function validateDependencies(schema: JsonSchema, input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  const dependencies = schema.dependentRequired;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return true;
  const record = input as Record<string, unknown>;
  return Object.entries(dependencies as Record<string, readonly string[]>).every(
    ([property, required]) => !(property in record) || required.every((item) => item in record),
  );
}

function validateObservedToolConstraints(
  provider: CatalogProvider,
  toolName: string,
  input: unknown,
): boolean {
  if (provider !== "SIMPLICITER" || toolName !== "fetch_legal_source") return true;
  const outer = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  if (!outer || !Array.isArray(outer.sources)) return true;
  return outer.sources.every((value) => {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    if (source?.source_key !== "it.legislation.normativa-italiana") return true;
    return typeof source.law === "string" && Boolean(source.law.trim());
  });
}

export function validateProviderToolInput(
  provider: CatalogProvider,
  capability: ResearchCapability,
  toolName: string,
  input: unknown,
): ProviderToolInputValidation {
  const mapping = PROVIDER_CAPABILITY_MAPPING[provider][capability];
  if (mapping.status === "NOT_CONFIRMED") return { valid: false, code: "CAPABILITY_NOT_CONFIRMED" };
  if (!(mapping.toolNames as readonly string[]).includes(toolName)) {
    return { valid: false, code: "TOOL_NOT_MAPPED" };
  }

  const tool = observedTool(provider, toolName);
  if (!tool) return { valid: false, code: "TOOL_NOT_MAPPED" };

  const validatorKey = `${provider}:${toolName}`;
  let validate = validators.get(validatorKey);
  if (!validate) {
    validate = schemaValidator.getValidator(tool.inputSchema as JsonSchemaType);
    validators.set(validatorKey, validate);
  }
  return validate(input).valid
    && validateDependencies(tool.inputSchema, input)
    && validateObservedToolConstraints(provider, toolName, input)
    ? { valid: true }
    : { valid: false, code: "INPUT_SCHEMA_INVALID" };
}

export function validateProviderToolOutput(
  provider: CatalogProvider,
  toolName: string,
  output: unknown,
): ProviderToolOutputValidation {
  const tool = observedTool(provider, toolName);
  if (!tool) return { status: "INVALID", code: "TOOL_NOT_OBSERVED" };
  if (!tool.outputSchema) {
    return { status: "NOT_VALIDATED", reason: "OUTPUT_SCHEMA_NOT_PROVIDED" };
  }

  const validatorKey = `output:${provider}:${toolName}`;
  let validate = validators.get(validatorKey);
  if (!validate) {
    validate = schemaValidator.getValidator(tool.outputSchema as JsonSchemaType);
    validators.set(validatorKey, validate);
  }
  return validate(output).valid
    ? { status: "VALID" }
    : { status: "INVALID", code: "OUTPUT_SCHEMA_INVALID" };
}