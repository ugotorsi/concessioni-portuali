export const LEGACY_LEGAL_SOURCE_STATUS_MAP = {
  VIGENTE: "CURRENT_SUBJECT_TO_REVIEW",
  SUPERATA: "SUPERSEDED",
  BOZZA: "DRAFT_OR_ONGOING_PROCEDURE",
} as const;

export type LegacyLegalSourceStatus = keyof typeof LEGACY_LEGAL_SOURCE_STATUS_MAP;

export interface LegacyStatusCount {
  status: LegacyLegalSourceStatus;
  count: number;
}

export interface LegalSourceStatusNormalizationReport {
  dryRun: boolean;
  tableExists: boolean;
  enumExists: boolean;
  legacyFound: LegacyStatusCount[];
  totalLegacyFound: number;
  updatedRecords: number;
  unchangedRecords: number;
  remainingLegacy: number;
  status: "DRY_RUN" | "UPDATED" | "NO_CHANGES";
}

export interface LegalSourceStatusNormalizationRepository {
  ensureLegalSourceTableExists(): Promise<boolean>;
  ensureLegalSourceStatusEnumExists(): Promise<boolean>;
  hasEnumValue(value: string): Promise<boolean>;
  addEnumValue(value: string): Promise<void>;
  countLegacyStatuses(): Promise<Record<LegacyLegalSourceStatus, number>>;
  updateLegacyStatuses(mapping: Readonly<Record<LegacyLegalSourceStatus, string>>): Promise<number>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
}

export class LegalSourceStatusNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalSourceStatusNormalizationError";
  }
}

function toLegacyRows(counts: Record<LegacyLegalSourceStatus, number>): LegacyStatusCount[] {
  return (Object.keys(LEGACY_LEGAL_SOURCE_STATUS_MAP) as LegacyLegalSourceStatus[]).map((status) => ({
    status,
    count: counts[status] ?? 0,
  }));
}

function sumLegacyCounts(counts: Record<LegacyLegalSourceStatus, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

export function sanitizeNormalizationErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://***@");
}

export async function normalizeLegacyLegalSourceStatus(
  repository: LegalSourceStatusNormalizationRepository,
  options?: { dryRun?: boolean },
): Promise<LegalSourceStatusNormalizationReport> {
  const dryRun = options?.dryRun ?? false;
  const tableExists = await repository.ensureLegalSourceTableExists();
  if (!tableExists) {
    throw new LegalSourceStatusNormalizationError("Table LegalSource does not exist in the selected database.");
  }

  const enumExists = await repository.ensureLegalSourceStatusEnumExists();
  if (!enumExists) {
    throw new LegalSourceStatusNormalizationError("Enum LegalSourceStatus does not exist in the selected database.");
  }

  const legacyCounts = await repository.countLegacyStatuses();
  const totalLegacyFound = sumLegacyCounts(legacyCounts);

  if (dryRun) {
    return {
      dryRun: true,
      tableExists,
      enumExists,
      legacyFound: toLegacyRows(legacyCounts),
      totalLegacyFound,
      updatedRecords: 0,
      unchangedRecords: totalLegacyFound,
      remainingLegacy: totalLegacyFound,
      status: "DRY_RUN",
    };
  }

  for (const targetStatus of Object.values(LEGACY_LEGAL_SOURCE_STATUS_MAP)) {
    const enumHasTarget = await repository.hasEnumValue(targetStatus);
    if (!enumHasTarget) {
      await repository.addEnumValue(targetStatus);
    }
  }

  const updatedRecords = await repository.transaction(async () => {
    return repository.updateLegacyStatuses(LEGACY_LEGAL_SOURCE_STATUS_MAP);
  });

  const remainingCounts = await repository.countLegacyStatuses();
  const remainingLegacy = sumLegacyCounts(remainingCounts);

  return {
    dryRun: false,
    tableExists,
    enumExists,
    legacyFound: toLegacyRows(legacyCounts),
    totalLegacyFound,
    updatedRecords,
    unchangedRecords: Math.max(totalLegacyFound - updatedRecords, 0),
    remainingLegacy,
    status: updatedRecords > 0 ? "UPDATED" : "NO_CHANGES",
  };
}