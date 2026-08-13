import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { FascicoloDocumentRequirementEvidenceSection } from "@/components/procedimenti/FascicoloDocumentRequirementEvidenceSection";
import { Textarea } from "@/components/ui/Textarea";
import { formatDateIT } from "@/lib/utils";
import { reviewFascicoloDocumentRequirementProposalAction } from "@/server/actions/fascicolo-document-requirements";
import type { getFascicoloDocumentRequirementEvidenceData } from "@/server/queries/fascicolo-document-requirement-evidence";
import type { getFascicoloDocumentRequirementProposals } from "@/server/queries/fascicolo-document-requirements";

type ProposalData = Awaited<ReturnType<typeof getFascicoloDocumentRequirementProposals>>["proposals"];
type EvidenceData = Awaited<ReturnType<typeof getFascicoloDocumentRequirementEvidenceData>>;

interface FascicoloDocumentRequirementProposalsPanelProps {
  proposals: ProposalData;
  evidenceData: EvidenceData;
  canReview: boolean;
  hasCanonicalTenant: boolean;
}

const matchedFactLabels: Record<string, string> = {
  normaRiferimento: "Riferimento normativo rilevato",
  portActivityLegalType: "Tipologia di attività portuale rilevata",
};

function statusDetails(status: "PROPOSTO" | "VALIDATO" | "RIFIUTATO") {
  if (status === "VALIDATO") {
    return { label: "Applicabilità confermata da revisione umana", variant: "success" as const };
  }
  if (status === "RIFIUTATO") {
    return { label: "Proposta ritenuta non applicabile", variant: "default" as const };
  }
  return { label: "In attesa di verifica umana dell'applicabilità", variant: "default" as const };
}

function getMatchedFacts(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }

  return Object.entries(snapshot)
    .filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
    )
    .map(([key, value]) => ({
      key,
      label: matchedFactLabels[key] ?? key,
      value: String(value),
    }));
}

function getRelevantProvisions(snapshot: unknown) {
  if (!Array.isArray(snapshot)) {
    return "-";
  }

  const provisions = snapshot.filter((provision): provision is string => typeof provision === "string");
  return provisions.length > 0 ? provisions.join(", ") : "-";
}

export function FascicoloDocumentRequirementProposalsPanel({
  proposals,
  evidenceData,
  canReview,
  hasCanonicalTenant,
}: FascicoloDocumentRequirementProposalsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requisiti istruttori proposti</CardTitle>
        <CardDescription>Proposte tecniche sottoposte a verifica umana di applicabilità.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {proposals.map((proposal) => {
          const status = statusDetails(proposal.status);
          const matchedFacts = getMatchedFacts(proposal.matchedCriteriaSnapshot);
          const canReviewProposal = proposal.status === "PROPOSTO" && canReview && hasCanonicalTenant;
          const associations = evidenceData.associationsByProposalId[proposal.id] ?? [];
          const eligibleDocuments = evidenceData.eligibleDocumentsByProposalId[proposal.id] ?? [];

          return (
            <article key={proposal.id} className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Requisito istruttorio proposto</p>
                  <h3 className="mt-1 font-semibold text-slate-900">{proposal.gapLabelSnapshot}</h3>
                  <p className="mt-1">{proposal.gapDescriptionSnapshot}</p>
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fonte normativa</p>
                  <p className="mt-1 text-slate-900">{proposal.sourceTitleSnapshot}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Disposizioni rilevanti</p>
                  <p className="mt-1 text-slate-900">{getRelevantProvisions(proposal.sourceRelevantProvisionsSnapshot)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fatti usati nello screening</p>
                {matchedFacts.length > 0 ? (
                  <dl className="mt-2 grid gap-2 md:grid-cols-2">
                    {matchedFacts.map((fact) => (
                      <div key={fact.key} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                        <dt className="text-xs text-slate-500">{fact.label}</dt>
                        <dd className="mt-1 font-medium text-slate-900">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-1 text-slate-500">Nessun fatto di screening registrato.</p>
                )}
              </div>

              <div className="space-y-1 text-xs text-slate-600">
                <p>
                  Proposta creata da {proposal.createdByEmail ?? proposal.createdByActorId} ({proposal.createdByRole}) il {formatDateIT(proposal.createdAt)}.
                </p>
                {proposal.status !== "PROPOSTO" && proposal.reviewedAt ? (
                  <p>
                    Revisione di {proposal.reviewedByEmail ?? proposal.reviewedByActorId ?? "-"}
                    {proposal.reviewedByRole ? ` (${proposal.reviewedByRole})` : ""} il {formatDateIT(proposal.reviewedAt)}.
                  </p>
                ) : null}
                {proposal.status !== "PROPOSTO" && proposal.reviewNote ? (
                  <p><span className="font-medium">Nota di revisione:</span> {proposal.reviewNote}</p>
                ) : null}
              </div>

              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <p>
                  Questa proposta richiede una verifica umana dell'applicabilità e della sussistenza, per il procedimento, del requisito di autorizzazione ex art. 16.
                </p>
                <p className="mt-1">
                  Non accerta l'esistenza o l'assenza del titolo, né la sua validità, efficacia o sufficienza; non determina la completezza documentale, la regolarità del procedimento, l'ammissibilità dell'istanza o la concedibilità.
                </p>
              </div>

              {proposal.status === "VALIDATO" ? (
                <FascicoloDocumentRequirementEvidenceSection
                  proposalId={proposal.id}
                  associations={associations}
                  eligibleDocuments={eligibleDocuments}
                  canManage={canReview && hasCanonicalTenant && evidenceData.hasCanonicalTenant}
                />
              ) : null}

              {canReviewProposal ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  <form action={reviewFascicoloDocumentRequirementProposalAction} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="targetStatus" value="VALIDATO" />
                    <label className="block text-sm text-slate-700">
                      Nota di revisione (facoltativa)
                      <Textarea name="reviewNote" rows={2} className="mt-1" />
                    </label>
                    <Button type="submit" size="sm">VALIDA APPLICABILITÀ</Button>
                  </form>
                  <form action={reviewFascicoloDocumentRequirementProposalAction} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="targetStatus" value="RIFIUTATO" />
                    <label className="block text-sm text-slate-700">
                      Motivazione della non applicabilità
                      <Textarea name="reviewNote" rows={2} required className="mt-1" />
                    </label>
                    <Button type="submit" size="sm" variant="outline">RIFIUTA PROPOSTA</Button>
                  </form>
                </div>
              ) : null}
            </article>
          );
        })}

        {proposals.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun requisito istruttorio proposto.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}