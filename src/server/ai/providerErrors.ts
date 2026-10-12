export type AiProviderFailureCategory = "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "CONFIGURATION";

export class AiProviderAdapterError extends Error {
  constructor(readonly category: AiProviderFailureCategory) {
    super(category);
    this.name = "AiProviderAdapterError";
  }
}
