import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { isInvestorDemoMode } from "@/lib/investor-demo";
import { investorDemoPageSections, investorDemoPrimaryLinks } from "@/lib/investor-demo-data";
import { getDemoPageData } from "@/server/queries/demo";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  if (isInvestorDemoMode()) {
    return (
      <AppShell
        title="Demo"
        subtitle="Percorso dimostrativo investitore con contenuti statici e non persistiti"
      >
        <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4" data-testid="investor-demo-page">
          <Card>
            <CardHeader>
              <CardTitle>Panoramica demo investitore</CardTitle>
              <CardDescription>
                Contenuti esclusivamente dimostrativi: nessun dato reale, nessuna operazione amministrativa.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {investorDemoPageSections.map((section) => (
                <article key={section.title} className="rounded-md border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                  <p className="mt-2 text-sm text-slate-700">{section.body}</p>
                </article>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Navigazione rapida</CardTitle>
              <CardDescription>Accesso diretto alle sezioni abilitate in modalita investitore</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {investorDemoPrimaryLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex h-10 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-900 hover:bg-slate-100"
                >
                  {item.label}
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  await requireRole(BACKOFFICE_ROLES);
  const data = await getDemoPageData();

  return (
    <AppShell
      title="Demo"
      subtitle="Percorso guidato per presentazione a soci e interlocutori istituzionali"
    >
      <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Percorso dimostrativo consigliato</CardTitle>
            <CardDescription>
              Flusso: concessione - sopralluogo - criticità - pagamento/scadenza - procedimento - report
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Caso guida suggerito: <span className="font-semibold text-slate-900">{data.journey.concessioneNumeroAtto}</span>
              {" "}
              - {data.journey.concessionario}
            </div>

            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.journey.steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step {index + 1}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-sm text-slate-700">{step.description}</p>
                  <Link
                    href={step.href}
                    className="mt-3 inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                  >
                    {step.label}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <Card key={card.href}>
              <CardHeader>
                <CardTitle>{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700">{card.subtitle}</p>
                <Link
                  href={card.href}
                  className="mt-3 inline-flex text-sm font-medium text-slate-900 underline underline-offset-4"
                >
                  Apri modulo
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
