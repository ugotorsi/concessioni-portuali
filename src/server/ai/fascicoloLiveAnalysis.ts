import {
  AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
  analyzeFascicoloOutboundV1,
  type AiFascicoloOutboundAnalysisV1,
  type AiFascicoloTrustedHashContextV1,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import { buildAiFascicoloBasisRefRegistryV1 } from "@/server/ai/fascicoloBasisRefResolution";
import {
  buildAiFascicoloSnapshotV1,
} from "@/server/ai/fascicoloSnapshot";
import {
  projectAiFascicoloOutboundV1,
  type AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";
import { AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION } from "@/server/ai/fascicoloSnapshotContract";
import {
  AiProviderAdapterError,
  type AiProviderFailureCategory,
} from "@/server/ai/providerErrors";
import {
  assertRealDataActivation,
  type RealDataActivationPolicy,
} from "@/server/ai/realDataActivation";

export { AiProviderAdapterError } from "@/server/ai/providerErrors";
export type { AiProviderFailureCategory } from "@/server/ai/providerErrors";

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
  snapshotSchemaVersion: typeof AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION;
  outboundSchemaVersion: AiFascicoloOutboundAnalysisV1["outboundSchemaVersion"];
  outboundProjectionHash: string;
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
  analyze(procedimentoId: string): ReturnType<typeof analyzeFascicoloOutboundV1>;
}

export interface AiFascicoloLiveAnalysisPreparedContext {
  readonly snapshot: Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;
  readonly projection: AiFascicoloOutboundProjectionResultV1;
  readonly analysis: AiFascicoloOutboundAnalysisV1;
}

export interface FascicoloLiveAnalysisPreparationService {
  prepare(procedimentoId: string): Promise<AiFascicoloLiveAnalysisPreparedContext>;
}

interface FascicoloLiveAnalysisConfig {
  readonly provider: AiOutboundAnalysisProvider;
  readonly maxInputBytes?: number;
  readonly realDataActivation?: RealDataActivationPolicy;
  readonly logger?: AiFascicoloLiveAnalysisLogger;
  readonly providerIdentifier?: string;
  readonly modelIdentifier?: string;
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

function utf8RequestBytes(request: AiOutboundAnalysisProviderRequestV1): number {
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

export function createFascicoloLiveAnalysisPreparationService(
  config: FascicoloLiveAnalysisConfig,
): FascicoloLiveAnalysisPreparationService {
  assertValidMaxInputBytes(config.maxInputBytes);
  const maxInputBytes = config.maxInputBytes;

  return {
    async prepare(procedimentoId: string) {
      const snapshot = await buildAiFascicoloSnapshotV1(procedimentoId);
      assertRealDataActivation(config.realDataActivation);
      const startedAt = Date.now();
      const projection = projectAiFascicoloOutboundV1(snapshot);
      const basisRefRegistry = buildAiFascicoloBasisRefRegistryV1({
        providerBound: projection.providerBound,
        localAliasMapping: projection.localOnly.localAliasMapping,
      });
      const trustedHashContext: AiFascicoloTrustedHashContextV1 = {
        snapshotSchemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
        outboundSchemaVersion: projection.providerBound.outboundProjection.schemaVersion,
        sourceSnapshotContentHash: projection.localOnly.sourceSnapshotContentHash,
        outboundProjectionHash: projection.providerBound.outboundProjectionHash,
        outboundProjectionHashAlgorithm: projection.providerBound.outboundProjectionHashAlgorithm,
      };
      let measuredInputBytes = 0;

      const boundedProvider: AiOutboundAnalysisProvider = {
        async analyze(request) {
          measuredInputBytes = utf8RequestBytes(request);
          if (measuredInputBytes > maxInputBytes) {
            throw new AiFascicoloLiveAnalysisError("AI_INPUT_TOO_LARGE");
          }
          return config.provider.analyze(request);
        },
      };

      try {
        const analysis = await analyzeFascicoloOutboundV1({
          providerBound: projection.providerBound,
          trustedHashContext,
          basisRefRegistry,
          provider: boundedProvider,
        });
        safeLog(config.logger, {
          outcome: "SUCCESS",
          snapshotSchemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
          outboundSchemaVersion: projection.providerBound.outboundProjection.schemaVersion,
          outboundProjectionHash: projection.providerBound.outboundProjectionHash,
          analysisSchemaVersion: AI_FASCICOLO_ANALYSIS_V1_SCHEMA_VERSION,
          inputBytes: measuredInputBytes,
          durationMs: Date.now() - startedAt,
          ...(config.providerIdentifier ? { providerIdentifier: config.providerIdentifier } : {}),
          ...(config.modelIdentifier ? { modelIdentifier: config.modelIdentifier } : {}),
        });
        return Object.freeze({ snapshot, projection, analysis });
      } catch (error) {
        const normalizedError = error instanceof AiProviderAdapterError ? mapAdapterError(error) : error;
        if (normalizedError instanceof AiFascicoloLiveAnalysisError) {
          safeLog(config.logger, {
            outcome: "ERROR",
            snapshotSchemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
            outboundSchemaVersion: projection.providerBound.outboundProjection.schemaVersion,
            outboundProjectionHash: projection.providerBound.outboundProjectionHash,
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

export function createFascicoloLiveAnalysisService(
  config: FascicoloLiveAnalysisConfig,
): FascicoloLiveAnalysisService {
  const preparation = createFascicoloLiveAnalysisPreparationService(config);
  return {
    async analyze(procedimentoId: string) {
      const context = await preparation.prepare(procedimentoId);
      return context.analysis;
    },
  };
}
