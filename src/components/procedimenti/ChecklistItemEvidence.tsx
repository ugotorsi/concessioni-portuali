import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ChecklistItemCode } from "@/lib/procedimento-checklist";
import { formatDateIT } from "@/lib/utils";
import {
  createChecklistEvidenceAction,
  reviewChecklistEvidenceAction,
} from "@/server/actions/checklist-evidence";
import type { getChecklistEvidenceData } from "@/server/queries/checklist-evidence";

type ChecklistEvidenceData = Awaited<ReturnType<typeof getChecklistEvidenceData>>;

interface ChecklistItemEvidenceProps {
  procedimentoId: string;
  itemCode: ChecklistItemCode;
  canManage: boolean;
  data: ChecklistEvidenceData;
}

function statusVariant(status: "PROPOSTO" | "VALIDATO" | "RIFIUTATO") {
  if (status === "VALIDATO") {
    return "success" as const;
  }
  if (status === "RIFIUTATO") {
    return "danger" as const;
  }
  return "default" as const;
}

export function ChecklistItemEvidence({ procedimentoId, itemCode, canManage, data }: ChecklistItemEvidenceProps) {
  const itemEvidence = data.evidence.filter((evidence) => evidence.checklistItemCode === itemCode);
  const associatedDocumentIds = new Set(itemEvidence.map((evidence) => evidence.documento.id));
  const eligibleDocuments = data.eligibleDocuments.filter((documento) => !associatedDocumentIds.has(documento.id));

  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
      <p className="text-xs font-medium text-slate-700">Evidenze istruttorie</p>
      {itemEvidence.map((evidence) => (
        <div key={evidence.id} className="space-y-2 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={`/documenti/${evidence.documento.id}/download`} className="font-medium text-slate-900 underline underline-offset-4">
              {evidence.documento.nome}
            </a>
            <Badge variant={statusVariant(evidence.status)}>{evidence.status}</Badge>
          </div>
          <p>
            Associata da {evidence.createdByEmail} ({evidence.createdByRole}) il {formatDateIT(evidence.createdAt)}.
          </p>
          {evidence.reviewedAt ? (
            <p>
              Verifica umana di {evidence.reviewedByEmail ?? evidence.reviewedByActorId ?? "-"}
              {evidence.reviewedByRole ? ` (${evidence.reviewedByRole})` : ""} il {formatDateIT(evidence.reviewedAt)}
              {evidence.reviewNote ? `: ${evidence.reviewNote}` : "."}
            </p>
          ) : null}
          {canManage && evidence.status === "PROPOSTO" ? (
            <div className="grid gap-2 lg:grid-cols-2">
              <form action={reviewChecklistEvidenceAction} className="flex gap-2">
                <input type="hidden" name="evidenceId" value={evidence.id} />
                <input type="hidden" name="status" value="VALIDATO" />
                <Input name="reviewNote" placeholder="Nota opzionale" />
                <Button type="submit" size="sm">Valida collegamento</Button>
              </form>
              <form action={reviewChecklistEvidenceAction} className="flex gap-2">
                <input type="hidden" name="evidenceId" value={evidence.id} />
                <input type="hidden" name="status" value="RIFIUTATO" />
                <Input name="reviewNote" required placeholder="Nota obbligatoria" />
                <Button type="submit" size="sm" variant="outline">Rifiuta collegamento</Button>
              </form>
            </div>
          ) : null}
        </div>
      ))}
      {itemEvidence.length === 0 ? <p className="text-xs text-slate-500">Nessuna evidenza associata.</p> : null}

      {canManage && data.hasCanonicalTenant && eligibleDocuments.length > 0 ? (
        <form action={createChecklistEvidenceAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="procedimentoId" value={procedimentoId} />
          <input type="hidden" name="checklistItemCode" value={itemCode} />
          <Select name="documentoId" required defaultValue="" className="min-w-64">
            <option value="" disabled>Seleziona documento</option>
            {eligibleDocuments.map((documento) => (
              <option key={documento.id} value={documento.id}>{documento.nome}</option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">Associa documento</Button>
        </form>
      ) : null}
    </div>
  );
}