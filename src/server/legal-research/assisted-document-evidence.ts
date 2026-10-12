import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { readDocumentFileBoundedFromProvider } from "@/server/documents/storage";
import type { Prisma } from "@/generated/prisma/client";
import type { ResearchMission } from "./bridge";
import type { OfficialSourceEvidence, VerifiedDocumentEvidence } from "./assisted-verification";

export async function readAssistedDocumentEvidence(
  mission: ResearchMission,
  tenantId: string,
  sources: readonly OfficialSourceEvidence[],
  dependencies: Readonly<{
    client: Pick<Prisma.TransactionClient, "documentFileVersion" | "legalSourceVersion">;
    read: typeof readDocumentFileBoundedFromProvider;
  }> = { client: prisma, read: readDocumentFileBoundedFromProvider },
): Promise<readonly VerifiedDocumentEvidence[]> {
  const verified: VerifiedDocumentEvidence[] = [];
  const caseIds = [mission.caseReference.caseId, mission.caseReference.fascicoloReference]
    .filter((value): value is string => Boolean(value));
  for (const source of sources) {
    const { documentId, fileVersionId, contentSha256 } = source.fullText;
    if (!documentId || !fileVersionId || !contentSha256 || !source.fullText.available) continue;
    const version = await dependencies.client.documentFileVersion.findFirst({
      where: {
        id: fileVersionId, documentId, canonicalEnteId: tenantId,
        document: {
          enteId: tenantId,
          OR: [{ procedimentoId: { in: caseIds } }, { concessioneId: { in: caseIds } }],
        },
      },
    });
    if (!version || version.sha256 !== contentSha256 || version.sizeBytes <= 0
      || version.sizeBytes > 32 * 1024 * 1024
      || (version.storageProvider !== "local" && version.storageProvider !== "s3")) continue;
    const representation = await dependencies.client.legalSourceVersion.findFirst({
      where: {
        sourceFamilyId: source.legalSourceId,
        legalExpressionVersionId: source.legalExpressionVersionId,
        observedSha256: version.sha256,
        observedSizeBytes: version.sizeBytes,
        sourceFamily: {
          enteId: tenantId,
          identityAssertions: { some: {
            normalizedValue: source.officialIdentifier,
            verificationStatus: "VERIFIED",
          } },
        },
      },
    });
    if (!representation) continue;
    try {
      const bytes = await dependencies.read({
        storageProvider: version.storageProvider,
        storageKey: version.storageKey,
        storageBucket: version.storageBucket,
        maxBytes: version.sizeBytes,
      });
      if (bytes.disposition !== "FOUND" || bytes.body.length !== version.sizeBytes
        || createHash("sha256").update(bytes.body).digest("hex") !== version.sha256) continue;
      verified.push({ evidenceSourceId: source.evidenceSourceId, documentId, fileVersionId, contentSha256 });
    } catch {
      continue;
    }
  }
  return verified;
}