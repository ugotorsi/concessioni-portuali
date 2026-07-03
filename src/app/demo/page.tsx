import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";
import { BACKOFFICE_ROLES, requireRole } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { getDemoPageData } from "@/server/queries/demo";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
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
