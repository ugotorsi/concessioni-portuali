import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { OfficialReconciliationReviewPanel } from "@/components/normativa/OfficialReconciliationReviewPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { formatDateIT, formatEnumLabel } from "@/lib/utils";
import { getOfficialReconciliationReviewQueue } from "@/server/queries/legal-reference-official-reconciliation";

export const dynamic = "force-dynamic";

export default async function OfficialReconciliationPage() {
  await requireRole(["ADMIN", "GIURIDICO"]);
  const queueResult = await getOfficialReconciliationReviewQueue();
  const queue = queueResult.items;

  return (
    <AppShell title="Riconciliazione fonti" subtitle="Coda di verifica delle identita rilevate da fonti esterne">
      <div className="mb-4 flex justify-end">
        <Link href="/normativa" className="text-sm font-medium text-slate-700 underline underline-offset-4">
          Torna alla normativa
        </Link>
      </div>

      <section className="grid gap-4">
        {queueResult.status === "SCHEMA_UNAVAILABLE" ? (
          <div className="border border-amber-300 bg-amber-50 p-8 text-center text-sm text-amber-900">
            Lo schema di riconciliazione ufficiale non e disponibile.
          </div>
        ) : null}
        {queue.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{item.canonicalKey ?? `${formatEnumLabel(item.kind)} incompleta`}</CardTitle>
                <span className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700">
                  {formatEnumLabel(item.state)} · rev. {item.revision}
                </span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="grid gap-3">
                <pre className="overflow-x-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800">
                  {JSON.stringify(item.normalizedIdentity, null, 2)}
                </pre>
                <div className="grid gap-2">
                  {item.evidence.map((evidence) => (
                    <div key={evidence.id} className="border-l-2 border-slate-300 pl-3 text-sm text-slate-700">
                      <p className="font-medium text-slate-900">
                        {evidence.officialHit.lookup.provider} · {evidence.officialHit.providerRecordId}
                      </p>
                      <p>{evidence.officialHit.titoloAtto ?? evidence.officialHit.providerSourceId}</p>
                      <p className="text-xs text-slate-500">
                        {formatEnumLabel(evidence.classification)} · {formatEnumLabel(evidence.disposition)} · {formatDateIT(evidence.observedAt)}
                      </p>
                      {evidence.officialHit.sourceUrl ? (
                        <a
                          href={evidence.officialHit.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium underline underline-offset-4"
                        >
                          Apri evidenza
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <OfficialReconciliationReviewPanel item={item} />
            </CardContent>
          </Card>
        ))}
        {queueResult.status === "READY" && queue.length === 0 ? (
          <div className="border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Nessuna identita in attesa di revisione.
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}