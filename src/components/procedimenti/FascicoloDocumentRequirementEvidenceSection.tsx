"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { FascicoloDocumentRequirementUploadForm } from "@/components/procedimenti/FascicoloDocumentRequirementUploadForm";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  createFascicoloDocumentRequirementEvidence,
  reviewFascicoloDocumentRequirementEvidence,
  revokeFascicoloDocumentRequirementEvidence,
} from "@/server/actions/fascicolo-document-requirement-evidence";
import type { getFascicoloDocumentRequirementEvidenceData } from "@/server/queries/fascicolo-document-requirement-evidence";

type EvidenceData = Awaited<ReturnType<typeof getFascicoloDocumentRequirementEvidenceData>>;
type Association = EvidenceData["associationsByProposalId"][string][number];
type EligibleDocument = EvidenceData["eligibleDocumentsByProposalId"][string][number];

interface FascicoloDocumentRequirementEvidenceSectionProps {
  proposalId: string;
  associations: Association[];
  eligibleDocuments: EligibleDocument[];
  canManage: boolean;
}

function actorLabel(email: string | null | undefined, actorId: string | null | undefined) {
  return email ?? actorId ?? "-";
}

function EvidenceReviewReceipt({
  review,
  historical = false,
}: {
  review: NonNullable<Association["review"]>;
  historical?: boolean;
}) {
  return (
    <div className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
      <p className="text-slate-700">Esame umano</p>
      <p className="font-medium text-slate-800">Esame registrato</p>
      {historical ? (
        <p>Ricevuta storica dell&apos;esame umano svolto prima della revoca dell&apos;evidenza.</p>
      ) : null}
      <p>
        Esaminato da {review.reviewedByEmail ?? "Operatore"} ({review.reviewedByRole}) · Data esame {formatDateIT(review.createdAt)}
      </p>
      {review.reviewNote ? (
        <p><span className="font-medium text-slate-700">Nota sull&apos;esame:</span> {review.reviewNote}</p>
      ) : null}
    </div>
  );
}

export function FascicoloDocumentRequirementEvidenceSection({
  proposalId,
  associations,
  eligibleDocuments,
  canManage,
}: FascicoloDocumentRequirementEvidenceSectionProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const reviewSubmittingRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const activeAssociations = associations.filter((association) => association.revokedAt === null);
  const revokedAssociations = associations.filter((association) => association.revokedAt !== null);

  function submitAssociation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const documentoId = String(new FormData(form).get("documentoId") ?? "").trim();
    if (!documentoId) {
      setErrorMessage("Selezionare un documento da associare.");
      return;
    }

    setErrorMessage(null);
    setPendingAction("create");
    startTransition(async () => {
      try {
        await createFascicoloDocumentRequirementEvidence({ proposalId, documentoId });
        form.reset();
        router.refresh();
      } catch {
        setErrorMessage("Associazione non completata. Verificare i dati e riprovare.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function submitRevocation(event: FormEvent<HTMLFormElement>, evidenceId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const revocationNote = String(new FormData(form).get("revocationNote") ?? "").trim();
    if (!revocationNote) {
      setErrorMessage("Indicare il motivo della revoca.");
      return;
    }

    setErrorMessage(null);
    setPendingAction(`revoke:${evidenceId}`);
    startTransition(async () => {
      try {
        await revokeFascicoloDocumentRequirementEvidence({ evidenceId, revocationNote });
        router.refresh();
      } catch {
        setErrorMessage("Revoca non completata. Verificare i dati e riprovare.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function submitReview(event: FormEvent<HTMLFormElement>, evidenceId: string) {
    event.preventDefault();
    if (reviewSubmittingRef.current) {
      return;
    }

    const reviewNote = String(new FormData(event.currentTarget).get("reviewNote") ?? "").trim();
    reviewSubmittingRef.current = true;
    setErrorMessage(null);
    setSuccessMessage(null);
    setPendingAction(`review:${evidenceId}`);
    startTransition(async () => {
      try {
        await reviewFascicoloDocumentRequirementEvidence({
          evidenceId,
          ...(reviewNote ? { reviewNote } : {}),
        });
        setSuccessMessage("Dati dell\u0027esame aggiornati.");
        router.refresh();
      } catch {
        setErrorMessage("Esame non registrato. Verificare i dati e riprovare.");
      } finally {
        reviewSubmittingRef.current = false;
        setPendingAction(null);
      }
    });
  }

  return (
    <section className="space-y-3 border-t border-slate-200 pt-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-slate-900">Evidenze documentali associate</h4>
        <p className="text-xs text-slate-600">
          L&apos;associazione documenta un collegamento istruttorio e non certifica validità, completezza, sufficienza o efficacia giuridica.
        </p>
      </div>

      <div className="space-y-2">
        {activeAssociations.map((association) => (
          <div key={association.id} className="space-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <a
                  href={`/documenti/${association.documentoId}/download`}
                  className="font-medium text-slate-900 underline underline-offset-4"
                >
                  {association.documento.nome}
                </a>
                <p className="mt-1">{formatEnumLabel(association.documento.tipologia)}</p>
              </div>
              <p>Associata il {formatDateIT(association.createdAt)}</p>
            </div>
            <p>
              Associata da {actorLabel(association.createdByEmail, association.createdByActorId)} ({association.createdByRole}).
            </p>
            {association.review ? (
              <EvidenceReviewReceipt review={association.review} />
            ) : canManage ? (
              <form onSubmit={(event) => submitReview(event, association.id)} className="space-y-2 border-t border-slate-100 pt-2">
                <p className="text-slate-700">Esame umano</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-64 flex-1 text-xs text-slate-700">
                    Nota sull&apos;esame (facoltativa)
                    <Textarea
                      name="reviewNote"
                      maxLength={2000}
                      rows={2}
                      className="mt-1"
                      disabled={pendingAction === `review:${association.id}`}
                    />
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pendingAction === `review:${association.id}`}
                  >
                    {pendingAction === `review:${association.id}` ? "Registrazione..." : "Registra esame"}
                  </Button>
                </div>
              </form>
            ) : null}
            {canManage ? (
              <form onSubmit={(event) => submitRevocation(event, association.id)} className="flex flex-wrap items-end gap-2">
                <label className="min-w-64 flex-1 text-xs text-slate-700">
                  Motivo della revoca
                  <Textarea
                    name="revocationNote"
                    required
                    maxLength={2000}
                    rows={2}
                    className="mt-1"
                    disabled={pendingAction === `revoke:${association.id}`}
                  />
                </label>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pendingAction === `revoke:${association.id}`}
                >
                  {pendingAction === `revoke:${association.id}` ? "Revoca in corso..." : "Revoca associazione"}
                </Button>
              </form>
            ) : null}
          </div>
        ))}
        {activeAssociations.length === 0 ? (
          <p className="text-xs text-slate-500">Nessuna evidenza documentale attiva associata.</p>
        ) : null}
      </div>

      {canManage ? (
        <div className="space-y-3">
          <FascicoloDocumentRequirementUploadForm proposalId={proposalId} />
          <div className="space-y-2">
            <h5 className="text-sm font-medium text-slate-900">Associa un documento esistente</h5>
            {eligibleDocuments.length > 0 ? (
              <form onSubmit={submitAssociation} className="flex flex-wrap items-center gap-2">
                <Select name="documentoId" required defaultValue="" className="min-w-64" disabled={pendingAction === "create"}>
                  <option value="" disabled>Seleziona documento</option>
                  {eligibleDocuments.map((documento) => (
                    <option key={documento.id} value={documento.id}>
                      {documento.nome} · {formatEnumLabel(documento.tipologia)}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" variant="outline" disabled={pendingAction === "create"}>
                  {pendingAction === "create" ? "Associazione in corso..." : "Associa documento"}
                </Button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">Nessun documento attivo associabile disponibile nel procedimento.</p>
            )}
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p role="status" className="text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {revokedAssociations.length > 0 ? (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <h4 className="text-sm font-semibold text-slate-900">Storico associazioni revocate</h4>
          {revokedAssociations.map((association) => (
            <div key={association.id} className="space-y-1 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={`/documenti/${association.documentoId}/download`}
                  className="font-medium text-slate-900 underline underline-offset-4"
                >
                  {association.documento.nome}
                </a>
                <span>{formatEnumLabel(association.documento.tipologia)}</span>
              </div>
              <p>
                Associata il {formatDateIT(association.createdAt)} da {actorLabel(association.createdByEmail, association.createdByActorId)} ({association.createdByRole}).
              </p>
              <p>
                Revocata il {association.revokedAt ? formatDateIT(association.revokedAt) : "-"} da {actorLabel(association.revokedByEmail, association.revokedByActorId)} ({association.revokedByRole ?? "-"}).
              </p>
              <p><span className="font-medium text-slate-700">Motivo della revoca:</span> {association.revocationNote ?? "-"}</p>
              {association.review ? (
                <EvidenceReviewReceipt review={association.review} historical />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}