import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import type { AiFascicoloHumanReviewReadModelV1 } from "@/server/queries/ai-fascicolo-human-review";
import type { AiFascicoloTrustedReviewMaterialDiscoveryItemV1 } from "@/server/queries/ai-fascicolo-trusted-review-materials";

type SearchParamValue = string | readonly string[] | undefined;

export type AiFascicoloTrustedReviewSelection =
  | { readonly kind: "NONE" }
  | { readonly kind: "INVALID" }
  | {
      readonly kind: "MATERIAL";
      readonly material: AiFascicoloTrustedReviewMaterialDiscoveryItemV1;
    }
  | {
      readonly kind: "COMPLETE";
      readonly material: AiFascicoloTrustedReviewMaterialDiscoveryItemV1;
      readonly statementPath: string;
    };

interface AiFascicoloTrustedReviewPanelProps {
  readonly procedimentoId: string;
  readonly materials: readonly AiFascicoloTrustedReviewMaterialDiscoveryItemV1[];
  readonly selection: AiFascicoloTrustedReviewSelection;
  readonly humanReview: AiFascicoloHumanReviewReadModelV1 | null;
  readonly readError: boolean;
}

function scalarSearchParam(value: SearchParamValue): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function resolveAiFascicoloTrustedReviewSelection(
  materials: readonly AiFascicoloTrustedReviewMaterialDiscoveryItemV1[],
  materialIdParam: SearchParamValue,
  statementPathParam: SearchParamValue,
): AiFascicoloTrustedReviewSelection {
  const materialId = scalarSearchParam(materialIdParam);
  const statementPath = scalarSearchParam(statementPathParam);
  if (!materialId && !statementPath) {
    return { kind: "NONE" };
  }
  if (!materialId) {
    return { kind: "INVALID" };
  }
  const material = materials.find((item) => item.materialId === materialId);
  if (!material) {
    return { kind: "INVALID" };
  }
  if (!statementPath) {
    return { kind: "MATERIAL", material };
  }
  if (!material.statementPaths.includes(statementPath)) {
    return { kind: "INVALID" };
  }
  return { kind: "COMPLETE", material, statementPath };
}

function materialHref(procedimentoId: string, materialId: string): string {
  const params = new URLSearchParams({ materialId });
  return `/procedimenti/${encodeURIComponent(procedimentoId)}?${params.toString()}`;
}

function statementHref(procedimentoId: string, materialId: string, statementPath: string): string {
  const params = new URLSearchParams({ materialId, statementPath });
  return `/procedimenti/${encodeURIComponent(procedimentoId)}?${params.toString()}`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

function reviewDispositionLabel(value: string): string {
  switch (value) {
    case "COMPANY_ACCEPTED":
      return "Contenuto confermato dal revisore";
    case "COMPANY_REJECTED":
      return "Contenuto non recepito dal revisore";
    case "COMPANY_NEEDS_VERIFICATION":
      return "Ulteriore verifica richiesta";
    case "COMPANY_AMENDED":
      return "Contenuto riformulato dal revisore";
    default:
      return "Revisione registrata";
  }
}

export function AiFascicoloTrustedReviewPanel({
  procedimentoId,
  materials,
  selection,
  humanReview,
  readError,
}: AiFascicoloTrustedReviewPanelProps) {
  const selectedMaterial = selection.kind === "MATERIAL" || selection.kind === "COMPLETE"
    ? selection.material
    : null;

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Trusted Review</CardTitle>
        <CardDescription>
          Materiali di analisi AI destinati alla revisione professionale e umana.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {readError ? (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            I materiali di revisione non sono disponibili in questo momento.
          </p>
        ) : null}

        {selection.kind === "INVALID" ? (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            La selezione richiesta non appartiene allo storico disponibile.
          </p>
        ) : null}

        {materials.length === 0 && !readError ? (
          <p className="text-sm text-slate-600">Nessuna analisi Trusted Review disponibile.</p>
        ) : null}

        {materials.length > 0 ? (
          <section className="space-y-2" aria-labelledby="trusted-review-materials-heading">
            <h3 id="trusted-review-materials-heading" className="text-sm font-semibold text-slate-900">
              Storico materiali
            </h3>
            <div className="space-y-2">
              {materials.map((material) => (
                <Link
                  key={material.materialId}
                  href={materialHref(procedimentoId, material.materialId)}
                  aria-current={selectedMaterial?.materialId === material.materialId ? "true" : undefined}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-slate-400"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere] font-medium text-slate-900">
                    {material.materialId}
                  </span>
                  <time dateTime={material.createdAt}>{formatTimestamp(material.createdAt)}</time>
                </Link>
              ))}
            </div>
            {selection.kind === "NONE" ? (
              <p className="text-sm text-slate-600">Selezionare un materiale per consultarne gli statement.</p>
            ) : null}
          </section>
        ) : null}

        {selectedMaterial ? (
          <section className="space-y-2" aria-labelledby="trusted-review-statements-heading">
            <h3 id="trusted-review-statements-heading" className="text-sm font-semibold text-slate-900">
              Statement
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedMaterial.statementPaths.map((path, index) => (
                <Link
                  key={`${path}:${index}`}
                  href={statementHref(procedimentoId, selectedMaterial.materialId, path)}
                  aria-current={selection.kind === "COMPLETE" && selection.statementPath === path ? "true" : undefined}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-400"
                >
                  {path}
                </Link>
              ))}
            </div>
            {selection.kind === "MATERIAL" ? (
              <p className="text-sm text-slate-600">Selezionare uno statement per consultarne il dettaglio.</p>
            ) : null}
          </section>
        ) : null}

        {humanReview ? (
          <section className="space-y-4" aria-labelledby="trusted-review-detail-heading">
            <div className="space-y-2">
              <h3 id="trusted-review-detail-heading" className="text-sm font-semibold text-slate-900">
                Contenuto canonico dello statement
              </h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                {JSON.stringify(humanReview.material.target.providerStatement.content, null, 2)}
              </pre>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Stato revisione umana</h3>
              <p className="text-sm text-slate-700">
                {humanReview.reviewStatus === "UNREVIEWED"
                  ? "Nessuna revisione umana registrata."
                  : `${reviewDispositionLabel(humanReview.currentState?.status ?? "")} · versione ${humanReview.currentState?.version ?? 0}`}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Storico revisione umana</h3>
              {humanReview.history.length === 0 ? (
                <p className="text-sm text-slate-600">Nessun evento di revisione umana.</p>
              ) : (
                <ol className="space-y-2">
                  {humanReview.history.map((event) => (
                    <li key={event.id} className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
                      <p className="font-medium text-slate-900">
                        Evento {event.sequence}: {reviewDispositionLabel(event.disposition)}
                      </p>
                      <time dateTime={event.occurredAt} className="text-xs text-slate-500">
                        {formatTimestamp(event.occurredAt)}
                      </time>
                      {event.note ? <p className="mt-2">Nota: {event.note}</p> : null}
                      {event.reason ? <p className="mt-2">Motivazione: {event.reason}</p> : null}
                      {event.amendment ? (
                        <div className="mt-2 space-y-1">
                          <p>Testo riformulato: {event.amendment.text}</p>
                          <p>Motivazione: {event.amendment.reason}</p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}