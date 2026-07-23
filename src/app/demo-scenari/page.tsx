import Link from "next/link";

import { ResumeDemoBanner } from "@/components/demo-guidata/ResumeDemoBanner";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { getConcessionVerticalLabel } from "@/lib/concession-vertical-labels";
import { getDemoScenarios } from "@/server/queries/demo-scenari";

export const dynamic = "force-dynamic";

function riskVariant(level: "MEDIO" | "ALTO" | "CRITICO"): "default" | "warning" | "danger" {
  if (level === "CRITICO") {
    return "danger";
  }

  if (level === "ALTO") {
    return "warning";
  }

  return "default";
}

export default async function DemoScenariPage() {
  await requireRole();
  const scenarios = await getDemoScenarios();

  return (
    <AppShell
      title="Scenari demo istituzionali"
      subtitle="Casi guidati per presentazione operativa a PA, AdSP ed ente concedente"
    >
      <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4">
        <ResumeDemoBanner />

        <Card>
          <CardHeader>
            <CardTitle>Scenari demo istituzionali</CardTitle>
            <CardDescription>
              Questa sezione raccoglie casi dimostrativi per illustrare il funzionamento della piattaforma in contesti istruttori tipici.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            <p>
              I contenuti rappresentano supporto istruttorio: evidenziano elementi da valutare dal responsabile del procedimento,
              senza introdurre automatismi decisori.
            </p>
          </CardContent>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scenarios.map((scenario) => (
            <Card key={scenario.slug} data-testid={`demo-scenario-card-${scenario.slug}`}>
              <CardHeader>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge variant={riskVariant(scenario.riskLevel)}>Livello demo {scenario.riskLevel}</Badge>
                  <span className="text-xs uppercase tracking-wide text-slate-500">{scenario.slug}</span>
                </div>
                <CardTitle>{scenario.title}</CardTitle>
                <CardDescription>{scenario.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Problema amministrativo</p>
                  <p className="mt-1">{scenario.administrativeProblem}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Cosa evidenzia la piattaforma</p>
                  <p className="mt-1">{scenario.platformFocus}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Moduli coinvolti</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {scenario.modules.map((item) => (
                      <Badge key={`${scenario.slug}-${item}`} variant="default">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>

                {scenario.concessionVertical ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Verticale concessione</p>
                    <div className="mt-1">
                      <Badge data-testid={`demo-scenario-vertical-${scenario.slug}`}>
                        {getConcessionVerticalLabel(scenario.concessionVertical)}
                      </Badge>
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Note istruttorie</p>
                  <p className="mt-1">{scenario.notes}</p>
                </div>

                <div className="space-y-1 border-t border-slate-200 pt-3" data-testid={`demo-scenario-links-${scenario.slug}`}>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Link rapidi</p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {scenario.concessioneId ? (
                      <Link href={`/concessioni/${scenario.concessioneId}`} className="font-medium text-slate-900 underline underline-offset-4">
                        Apri concessione
                      </Link>
                    ) : (
                      <span className="text-slate-500">Concessione non disponibile</span>
                    )}

                    {scenario.criticitaId ? (
                      <Link href={`/criticita/${scenario.criticitaId}`} className="font-medium text-slate-900 underline underline-offset-4">
                        Apri criticità
                      </Link>
                    ) : (
                      <span className="text-slate-500">Criticità non disponibile</span>
                    )}

                    {scenario.procedimentoId ? (
                      <Link href={`/procedimenti/${scenario.procedimentoId}`} className="font-medium text-slate-900 underline underline-offset-4">
                        Apri procedimento
                      </Link>
                    ) : (
                      <span className="text-slate-500">Procedimento non disponibile</span>
                    )}

                    {scenario.reportId ? (
                      <Link href={`/report/${scenario.reportId}`} className="font-medium text-slate-900 underline underline-offset-4">
                        Apri report
                      </Link>
                    ) : (
                      <span className="text-slate-500">Report non disponibile</span>
                    )}

                    {scenario.pdfUrl ? (
                      <Link href={scenario.pdfUrl} className="font-medium text-slate-900 underline underline-offset-4">
                        Scarica PDF
                      </Link>
                    ) : (
                      <span className="text-slate-500">PDF non disponibile</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
