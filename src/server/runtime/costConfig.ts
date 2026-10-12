export class RuntimeCostConfigurationError extends Error {
  constructor(readonly variableName: string) {
    super("RUNTIME_COST_CONFIGURATION_INVALID");
    this.name = "RuntimeCostConfigurationError";
  }
}

export function runtimeCostEstimate(
  variableName: "ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR" | "ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment[variableName];
  if (raw === undefined || !/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new RuntimeCostConfigurationError(variableName);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new RuntimeCostConfigurationError(variableName);
  return value;
}