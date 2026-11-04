import { createHash } from "node:crypto";

import { z } from "zod";

import { stableStringify } from "@/server/audit/hash";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const reconciliationProposalStateSchema = z.object({
  id: z.string().min(1),
  proposalFingerprint: hashSchema,
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "AMENDED_AND_APPROVED", "MATERIALIZED", "SUPERSEDED", "STALE"]),
  reviewVersion: z.number().int().nonnegative(),
  supersededAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
}).strict();

export type ReconciliationProposalState = z.infer<typeof reconciliationProposalStateSchema>;

export function proposalReconciliationStates(proposals: readonly {
  id: string;
  proposalFingerprint: string;
  status: ReconciliationProposalState["status"];
  reviewVersion: number;
  supersededAt: Date | null;
  updatedAt: Date;
}[]): ReconciliationProposalState[] {
  return proposals.map((proposal) => reconciliationProposalStateSchema.parse({
    id: proposal.id,
    proposalFingerprint: proposal.proposalFingerprint,
    status: proposal.status,
    reviewVersion: proposal.reviewVersion,
    supersededAt: proposal.supersededAt?.toISOString() ?? null,
    updatedAt: proposal.updatedAt.toISOString(),
  })).sort((left, right) => left.id.localeCompare(right.id));
}

export function proposalReconciliationFingerprint(input: {
  tenantId: string;
  procedimentoId: string;
  reportFingerprint: string;
  candidateFingerprints: readonly string[];
  states: readonly ReconciliationProposalState[];
}): string {
  return createHash("sha256").update(stableStringify({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    reportFingerprint: input.reportFingerprint,
    candidateFingerprints: [...new Set(input.candidateFingerprints)].sort(),
    states: [...input.states].sort((left, right) => left.id.localeCompare(right.id)),
  }), "utf8").digest("hex");
}
