import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The isolated test requires ${name}.`);
  return value;
}

const databaseUrl = requiredEnvironment("DATABASE_URL");
const storageRoot = requiredEnvironment("DOCUMENT_STORAGE_ROOT");
const runId = requiredEnvironment("NOETRA_GUIDED_E2E_RUN_ID");
const url = new URL(databaseUrl);
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55432"
  || url.username !== "noetra_test" || url.pathname !== "/noetra_test_workflow"
  || !path.isAbsolute(storageRoot)
  || path.basename(path.resolve(storageRoot)) !== "browser-test-storage"
  || !/^[a-z0-9-]{1,24}$/.test(runId)
  || process.env.NOETRA_GUIDED_E2E !== "1"
  || process.env.DOCUMENT_STORAGE_BACKEND !== "local"
  || process.env.AI_REAL_DATA_ENABLED !== "false"
  || process.env.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
  || process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED !== "false"
  || process.env.DOCUMENT_WORKER_ACTIVATION_MODE !== "DISABLED"
  || process.env.NODE_ENV === "production"
  || ["preview", "production"].includes(process.env.VERCEL_ENV?.toLowerCase() ?? "")) {
  throw new Error("Refusing to seed outside the dedicated local workflow test environment.");
}

const caseId = (name: string) => `e2e-guided-${runId}-${name}`;
const cases = [
  {
    id: caseId("selvara-synthetic"),
    port: true,
    title: "Riesame di una decadenza simulata",
    fact: "Una determinazione simulata n. 149/2026 dichiara la decadenza dalla concessione portuale. Il concessionario ha presentato istanza di riesame il 16 ottobre 2026.",
    issue: "Valutare l'istanza di riesame della determinazione simulata di decadenza.",
  },
  {
    id: caseId("porto-aurora"),
    port: true,
    title: "Occupazione oltre il perimetro di Porto Aurora",
    fact: "Un verbale sintetico rileva un manufatto sulla banchina portuale all'esterno del perimetro concesso; occorre verificare autorizzazione, rilievi e contraddittorio.",
    issue: "Occupazione di area demaniale portuale oltre il perimetro della concessione.",
  },
  {
    id: caseId("non-port"),
    port: false,
    title: "Segnalazione commerciale comunale",
    fact: "Il Comune ha ricevuto una segnalazione certificata per un esercizio commerciale; il fascicolo richiede verifica documentale e valutazione delle osservazioni.",
    issue: "Verifica della documentazione relativa a una segnalazione commerciale.",
  },
  {
    id: caseId("shared"),
    port: false,
    title: "Verifica del titolo commerciale",
    fact: "Una pratica commerciale comunale richiede la stessa ricostruzione documentale per due verifiche amministrative.",
    issue: "Ricostruzione documentale per la verifica del titolo commerciale.",
    additionalIssue: {
      title: "Verifica delle osservazioni commerciali",
      issue: "Ricostruzione documentale per la verifica delle osservazioni nella stessa pratica.",
    },
  },
  {
    id: caseId("reconciliation"),
    port: false,
    title: "Verifica dell'istanza sintetica",
    fact: "È stata acquisita un'istanza sintetica che richiede verifica documentale.",
    issue: "Verifica amministrativa dell'istanza sintetica.",
  },
] as const;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { persistStructuredKnowledgeRevision } = await import("@/server/fascicolo-knowledge");
  const { buildFascicoloDocumentKnowledgeEvidence, readFascicoloDocumentCorpusInTransaction } =
    await import("@/server/queries/fascicolo-document-corpus");
  try {
    const identity = await prisma.$queryRaw<Array<{ database: string; username: string; port: number }>>`
      SELECT current_database() AS database, current_user AS username, inet_server_port() AS port
    `;
    if (identity[0]?.database !== "noetra_test_workflow" || identity[0]?.username !== "noetra_test"
      || identity[0]?.port !== 55432) {
      throw new Error("The server did not identify itself as the disposable workflow database.");
    }
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.local" },
      select: { id: true, tenantMemberships: { where: { isDefault: true }, select: { enteId: true } } },
    });
    const tenantId = admin.tenantMemberships[0]?.enteId;
    if (!tenantId) throw new Error("The isolated demo administrator has no default tenant.");
    const concession = await prisma.concessione.findFirstOrThrow({
      where: { enteId: tenantId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    await mkdir(storageRoot, { recursive: true });
    for (const scenario of cases) {
      const procedimento = await prisma.procedimento.create({
        data: {
          id: scenario.id,
          enteId: tenantId,
          concessioneId: scenario.port ? concession.id : null,
          tipologia: "ALTRO",
          stato: "IN_CORSO",
          noteIstruttorie: `Scenario esclusivamente sintetico: ${scenario.title}`,
        },
      });
      const scope = { tenantId, procedimentoId: procedimento.id };
      for (const [suffix, name, text] of [
        ["a-base", "Documento di base sintetico", scenario.fact],
        ["b-execution", "Prova sintetica di comunicazione", "Comunicazione simulata nel collaudo isolato."],
        ["c-outcome", "Riscontro sintetico", "Riscontro simulato acquisito nel collaudo isolato."],
      ] as const) {
        const documentId = `${scenario.id}-${suffix}`;
        const fileName = `${documentId}.txt`;
        const bytes = Buffer.from(text, "utf8");
        const checksum = sha256(bytes);
        await writeFile(path.join(storageRoot, fileName), bytes, { flag: "wx" });
        await prisma.documento.create({
          data: {
            id: documentId,
            enteId: tenantId,
            procedimentoId: procedimento.id,
            concessioneId: procedimento.concessioneId,
            nome: name,
            tipologia: "NOTA",
            mimeType: "text/plain",
            storageProvider: "local",
            storageKey: fileName,
            storagePath: fileName,
            checksumSha256: checksum,
            dimensioneBytes: bytes.length,
          },
        });
        const version = await prisma.documentFileVersion.create({
          data: {
            documentId,
            canonicalEnteId: tenantId,
            storageProvider: "local",
            storageKey: fileName,
            mimeType: "text/plain",
            sizeBytes: bytes.length,
            sha256: checksum,
            createdByUserId: admin.id,
            createdByActorId: admin.id,
            createdByRole: "ADMIN",
          },
        });
        await prisma.documento.update({ where: { id: documentId }, data: { currentFileVersionId: version.id } });
        const now = new Date();
        await prisma.documentExtractionAttempt.create({
          data: {
            executionKey: `isolated-${documentId}`,
            documentoId: documentId,
            documentFileVersionId: version.id,
            tenantId,
            procedimentoId: procedimento.id,
            policyVersion: "isolated-test",
            outcome: "SUCCEEDED",
            sourceSha256: checksum,
            declaredMimeType: "text/plain",
            detectedMimeType: "text/plain",
            sourceSizeBytes: bytes.length,
            startedAt: now,
            completedAt: now,
            pages: { create: {
              pageNumber: 1,
              extractionMethod: "DIRECT_TEXT",
              text,
              normalizedText: text,
              textSha256: checksum,
              normalizedCharacterCount: text.length,
            } },
          },
        });
      }
      const corpus = await readFascicoloDocumentCorpusInTransaction(scope, prisma);
      if (!corpus || corpus.availability !== "READY") throw new Error(`Synthetic corpus unavailable for ${scenario.id}.`);
      await persistStructuredKnowledgeRevision({
        ...scope,
        corpusFingerprint: corpus.corpusFingerprint,
        evidenceByBasisRef: buildFascicoloDocumentKnowledgeEvidence(corpus),
        knowledge: {
          version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
          subjects: [],
          items: [
            {
              localId: "fact",
              kind: "FACT",
              confidence: 90,
              basisRefs: ["DOCUMENT_1.PAGE_1"],
              payload: { normalizedStatement: scenario.fact, subjectLocalIds: [], object: null, qualifier: null },
            },
            ...(scenario.id === caseId("porto-aurora") ? [{
              localId: "gap-planimetria",
              kind: "GAP" as const,
              confidence: 90,
              basisRefs: ["DOCUMENT_1.PAGE_1"],
              payload: {
                gapType: "documento mancante",
                description: "Manca la planimetria aggiornata del perimetro.",
                impact: "Il confronto del perimetro resta incerto.",
                relatedItemLocalIds: ["fact"],
              },
            }] : []),
          ],
          legalIssues: [
            {
              localId: "issue",
              title: scenario.title,
              normalizedIssue: scenario.issue,
              areaOfLaw: "diritto amministrativo",
              priority: "HIGH",
              rationale: "Problematica preparata manualmente per il collaudo sintetico.",
              originatingItemLocalIds: ["fact"],
              confidence: 90,
              referenceDateBasis: null,
            },
            ...("additionalIssue" in scenario ? [{
              localId: "second-issue",
              title: scenario.additionalIssue.title,
              normalizedIssue: scenario.additionalIssue.issue,
              areaOfLaw: "diritto amministrativo",
              priority: "HIGH" as const,
              rationale: "Seconda problematica preparata manualmente per verificare la condivisione.",
              originatingItemLocalIds: ["fact"],
              confidence: 90,
              referenceDateBasis: null,
            }] : []),
          ],
          researchQuestions: [],
        },
      });
      console.log(`Created isolated scenario ${scenario.id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
