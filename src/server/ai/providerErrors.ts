export type AiProviderFailureCategory = "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "CONFIGURATION";

export interface AiProviderErrorDiagnostics {
  readonly httpStatus: number;
  readonly providerCode: string | null;
}

export class AiProviderAdapterError extends Error {
  constructor(
    readonly category: AiProviderFailureCategory,
    readonly diagnostics: AiProviderErrorDiagnostics | null = null,
  ) {
    super(category);
    this.name = "AiProviderAdapterError";
  }
}
