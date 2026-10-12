import { CheckCircle2, CircleDot, Lightbulb, ShieldCheck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import {
  materializeOperationalProposalAction,
  reviewOperationalProposalAction,
} from "@/server/actions/fascicolo-operational-proposals";

export type FascicoloProposalType =
  | "DEADLINE"
  | "CRITICALITY"
  | "DOCUMENT_REQUIREMENT"
  | "CHECKLIST_ITEM"
  | "ACTIVITY"
  | "NOTE"
  | "SUBJECT_UPDATE";

export type FascicoloProposalStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "AMENDED_AND_APPROVED"
  | "MATERIALIZED"
  | "SUPERSEDED"
  | "STALE";

export interface FascicoloProposal {
  id: string;
  procedimentoId: string;
  proposalType: FascicoloProposalType;
  status: FascicoloProposalStatus;
  title: string;
  description: string;
  rationale: string;
  reviewVersion: number;
  reviewNote?: string | null;
  warningCodes: readonly string[];
  createdAt: Date;
  reviewedAt?: Date | null;
  materializedAt?: Date | null;
  materializedEntityType?: string | null;
}

export function fascicoloProposalTypeLabel(type: FascicoloProposalType): string {
  switch (type) {
    case "DEADLINE": return "Scadenza";
    case "CRITICALITY": return "Criticità";
    case "DOCUMENT_REQUIREMENT": return "Documento richiesto";
    case "CHECKLIST_ITEM": return "Verifica";
    case "ACTIVITY": return "Attività";
    case "NOTE": return "Nota";
    case "SUBJECT_UPDATE": return "Aggiornamento soggetto";
  }
}

export function fascicoloProposalStatusLabel(status: FascicoloProposalStatus): string {
  switch (status) {
    case "PROPOSED": return "Da revisionare";
    case "APPROVED": return "Approvata";
    case "REJECTED": return "Rifiutata";
    case "AMENDED_AND_APPROVED": return "Approvata con modifiche";
    case "MATERIALIZED": return "Materializzata";
    case "SUPERSEDED": return "Superata";
    case "STALE": return "Non più attuale";
  }
}

const statusTone: Record<FascicoloProposalStatus, string> = {
  PROPOSED: "border-sky-200 bg-sky-50 text-sky-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  AMENDED_AND_APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MATERIALIZED: "border-teal-200 bg-teal-50 text-teal-800",
  REJECTED: "border-slate-300 bg-slate-100 text-slate-700",
  SUPERSEDED: "border-slate-300 bg-slate-100 text-slate-600",
  STALE: "border-amber-200 bg-amber-50 text-amber-800",
};

function present(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function ProposalActions({ proposal, canManage }: { proposal: FascicoloProposal; canManage: boolean }) {
  if (!canManage) return null;
  if (proposal.status === "PROPOSED") {
    return (
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
        <form action={reviewOperationalProposalAction}>
          <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
          <input type="hidden" name="action" value="APPROVE" />
          <Button type="submit" size="sm" variant="outline">Approva</Button>
        </form>
        <form action={reviewOperationalProposalAction}>
          <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="reviewVersion" value={proposal.reviewVersion} />
          <input type="hidden" name="action" value="REJECT" />
          <Button type="submit" size="sm" variant="outline">Rifiuta</Button>
        </form>
      </div>
    );
  }
  const canMaterialize = (proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED")
    && !proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED");
  return canMaterialize ? (
    <form action={materializeOperationalProposalAction} className="mt-4 border-t border-slate-200 pt-3">
      <input type="hidden" name="procedimentoId" value={proposal.procedimentoId} />
      <input type="hidden" name="proposalId" value={proposal.id} />
      <Button type="submit" size="sm" variant="outline">Materializza</Button>
    </form>
  ) : null;
}

function ProposalCard({ proposal, canManage }: { proposal: FascicoloProposal; canManage: boolean }) {
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{fascicoloProposalTypeLabel(proposal.proposalType)}</p>
          <h4 className="mt-1 font-semibold text-slate-950 [overflow-wrap:anywhere]">{proposal.title}</h4>
          <p className="mt-1 text-xs text-slate-500">Proposta del {formatDateIT(proposal.createdAt)}</p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusTone[proposal.status]}`}>
          {fascicoloProposalStatusLabel(proposal.status)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">{proposal.description}</p>

      <details className="mt-3 border-t border-slate-200 pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Dettagli</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate-500">Motivazione</dt>
            <dd className="mt-1 leading-6 text-slate-700 [overflow-wrap:anywhere]">{proposal.rationale}</dd>
          </div>
          {proposal.reviewedAt ? (
            <div><dt className="text-xs font-medium text-slate-500">Revisionata il</dt><dd className="mt-1 text-slate-700">{formatDateIT(proposal.reviewedAt)}</dd></div>
          ) : null}
          {present(proposal.reviewNote) ? (
            <div><dt className="text-xs font-medium text-slate-500">Nota di revisione</dt><dd className="mt-1 text-slate-700 [overflow-wrap:anywhere]">{proposal.reviewNote}</dd></div>
          ) : null}
          {proposal.materializedAt ? (
            <div><dt className="text-xs font-medium text-slate-500">Attuata il</dt><dd className="mt-1 text-slate-700">{formatDateIT(proposal.materializedAt)}</dd></div>
          ) : null}
          {present(proposal.materializedEntityType) ? (
            <div><dt className="text-xs font-medium text-slate-500">Elemento aggiornato</dt><dd className="mt-1 text-slate-700">{formatEnumLabel(proposal.materializedEntityType)}</dd></div>
          ) : null}
        </dl>
      </details>

      {(proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED")
        && proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED") ? (
          <p className="mt-3 text-sm text-slate-600">Approvata; l’attuazione richiede un intervento manuale separato.</p>
        ) : null}
      <ProposalActions proposal={proposal} canManage={canManage} />
    </article>
  );
}

const groups: readonly {
  key: string;
  title: string;
  statuses: readonly FascicoloProposalStatus[];
  icon: typeof CircleDot;
  iconClassName: string;
}[] = [
  { key: "review", title: "Da revisionare", statuses: ["PROPOSED"], icon: CircleDot, iconClassName: "text-sky-700" },
  { key: "approved", title: "Approvate", statuses: ["APPROVED", "AMENDED_AND_APPROVED"], icon: CheckCircle2, iconClassName: "text-emerald-700" },
  { key: "materialized", title: "Attuate", statuses: ["MATERIALIZED"], icon: ShieldCheck, iconClassName: "text-teal-700" },
  { key: "rejected", title: "Rifiutate", statuses: ["REJECTED"], icon: XCircle, iconClassName: "text-slate-600" },
  { key: "past", title: "Non più attuali", statuses: ["STALE", "SUPERSEDED"], icon: Lightbulb, iconClassName: "text-amber-700" },
];

export function FascicoloProposals({ proposals, canManage }: { proposals: readonly FascicoloProposal[]; canManage: boolean }) {
  const reviewCount = proposals.filter((proposal) => proposal.status === "PROPOSED").length;
  const approvedCount = proposals.filter((proposal) => proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED").length;
  const materializedCount = proposals.filter((proposal) => proposal.status === "MATERIALIZED").length;
  const rejectedCount = proposals.filter((proposal) => proposal.status === "REJECTED").length;

  return (
    <section aria-labelledby="proposals-title" className="min-w-0 space-y-6" data-testid="fascicolo-proposals">
      <header className="border-b border-slate-200 pb-4">
        <h2 id="proposals-title" className="text-xl font-semibold text-slate-950">Proposte</h2>
        <p className="mt-1 text-sm text-slate-600">Azioni e aggiornamenti suggeriti, soggetti a revisione e approvazione.</p>
        {proposals.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="inline text-slate-500">Da revisionare </dt><dd className="inline font-semibold text-slate-950">{reviewCount}</dd></div>
            <div><dt className="inline text-slate-500">Approvate </dt><dd className="inline font-semibold text-slate-950">{approvedCount}</dd></div>
            <div><dt className="inline text-slate-500">Materializzate </dt><dd className="inline font-semibold text-slate-950">{materializedCount}</dd></div>
            <div><dt className="inline text-slate-500">Rifiutate </dt><dd className="inline font-semibold text-slate-950">{rejectedCount}</dd></div>
          </dl>
        ) : null}
      </header>

      <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#173d4f]" aria-hidden="true" />
        <p>Nessuna proposta produce effetti operativi senza approvazione.</p>
      </div>

      {proposals.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">Non risultano proposte operative per questo fascicolo.</p>
          <p className="mt-1 text-sm text-slate-600">Le proposte vengono sottoposte a revisione prima di produrre effetti sul fascicolo.</p>
        </div>
      ) : groups.map((group) => {
        const groupProposals = proposals.filter((proposal) => group.statuses.includes(proposal.status));
        if (groupProposals.length === 0) return null;
        const Icon = group.icon;
        return (
          <section key={group.key} aria-labelledby={`proposal-group-${group.key}`}>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${group.iconClassName}`} aria-hidden="true" />
              <h3 id={`proposal-group-${group.key}`} className="text-base font-semibold text-slate-950">{group.title}</h3>
            </div>
            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
              {groupProposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} canManage={canManage} />)}
            </div>
          </section>
        );
      })}
    </section>
  );
}