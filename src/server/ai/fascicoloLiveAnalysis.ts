import {
  AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
  analyzeFascicoloSnapshotV1,
  type AiAnalysisProvider,
  type AiAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
  buildAiFascicoloSnapshotV1,
} from "@/server/ai/fascicoloSnapshot";

export type AiProviderFailureCategory = "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "CONFIGURATION";

export class AiProviderAdapterError extends Error {
  constructor(readonly category: AiProviderFailureCategory) {
    super(category);
    this.name = "AiProviderAdapterError";
  }
}

export type AiFascicoloLiveAnalysisErrorCode =
  | "AI_INPUT_TOO_LARGE"
  | "AI_CONFIGURATION_ERROR"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_RATE_LIMITED";

export class AiFascicoloLiveAnalysisError extends Error {
  constructor(readonly code: AiFascicoloLiveAnalysisErrorCode) {
    super(code);
    this.name = "AiFascicoloLiveAnalysisError";
  }
}

export interface AiFascicoloLiveAnalysisLogEvent {
  outcome: "SUCCESS" | "ERROR";
  snapshotContentHash: string;
  snapshotSchemaVersion: typeof AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION;
  analysisSchemaVersion: typeof AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION;
  inputBytes: number;
  durationMs: number;
  providerIdentifier?: string;
  modelIdentifier?: string;
  errorCategory?: AiFascicoloLiveAnalysisErrorCode;
}

export interface AiFascicoloLiveAnalysisLogger {
  log(event: AiFascicoloLiveAnalysisLogEvent): void;
}

export interface FascicoloLiveAnalysisService {
  analyze(procedimentoId: string): ReturnType<typeof analyzeFascicoloSnapshotV1>;
}

function assertValidMaxInputBytes(value: number | undefined): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    throw new AiFascicoloLiveAnalysisError("AI_CONFIGURATION_ERROR");
  }
}

function safeLog(logger: AiFascicoloLiveAnalysisLogger | undefined, event: AiFascicoloLiveAnalysisLogEvent): void {
  try {
    logger?.log(event);
  } catch {
    // Telemetry is best-effort and must not alter orchestration behavior.
  }
}

function utf8RequestBytes(request: AiAnalysisProviderRequestV1): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

function mapAdapterError(error: AiProviderAdapterError): AiFascicoloLiveAnalysisError {
  switch (error.category) {
    case "UNAVAILABLE":
      return new AiFascicoloLiveAnalysisError("AI_PROVIDER_UNAVAILABLE");
    case "TIMEOUT":
      return new AiFascicoloLiveAnalysisError("AI_PROVIDER_TIMEOUT");
    case "RATE_LIMITED":
      return new AiFascicoloLiveAnalysisError("AI_PROVIDER_RATE_LIMITED");
    case "CONFIGURATION":
      return new AiFascicoloLiveAnalysisError("AI_CONFIGURATION_ERROR");
  }
}

export function createFascicoloLiveAnalysisService(config: {
  provider: AiAnalysisProvider;
  maxInputBytes?: number;
  logger?: AiFascicoloLiveAnalysisLogger;
  providerIdentifier?: string;
  modelIdentifier?: string;
}): FascicoloLiveAnalysisService {
  assertValidMaxInputBytes(config.maxInputBytes);
  const maxInputBytes = config.maxInputBytes;

  return {
    async analyze(procedimentoId: string) {
      const snapshot = await buildAiFascicoloSnapshotV1(procedimentoId);
      const startedAt = Date.now();
      let measuredInputBytes = 0;

      const boundedProvider: AiAnalysisProvider = {
        async analyze(request) {
          measuredInputBytes = utf8RequestBytes(request);
          if (measuredInputBytes > maxInputBytes) {
            throw new AiFascicoloLiveAnalysisError("AI_INPUT_TOO_LARGE");
          }
          return config.provider.analyze(request);
        },
      };

      try {
        const result = await analyzeFascicoloSnapshotV1({ snapshot, provider: boundedProvider });
        safeLog(config.logger, {
          outcome: "SUCCESS",
          snapshotContentHash: snapshot.metadata.contentHash,
          snapshotSchemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
          analysisSchemaVersion: AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
          inputBytes: measuredInputBytes,
          durationMs: Date.now() - startedAt,
          ...(config.providerIdentifier ? { providerIdentifier: config.providerIdentifier } : {}),
          ...(config.modelIdentifier ? { modelIdentifier: config.modelIdentifier } : {}),
        });
        return result;
      } catch (error) {
        const normalizedError = error instanceof AiProviderAdapterError ? mapAdapterError(error) : error;
        if (normalizedError instanceof AiFascicoloLiveAnalysisError) {
          safeLog(config.logger, {
            outcome: "ERROR",
            snapshotContentHash: snapshot.metadata.contentHash,
            snapshotSchemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
            analysisSchemaVersion: AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
            inputBytes: measuredInputBytes,
            durationMs: Date.now() - startedAt,
            errorCategory: normalizedError.code,
            ...(config.providerIdentifier ? { providerIdentifier: config.providerIdentifier } : {}),
            ...(config.modelIdentifier ? { modelIdentifier: config.modelIdentifier } : {}),
          });
        }
        throw normalizedError;
      }
    },
  };
}
