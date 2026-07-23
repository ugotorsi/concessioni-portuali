import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { canUseAI, requireRole } from "@/lib/auth";
import { getAiSupportSuggestion } from "@/server/ai/aiService";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  const role = await requireRole();

  if (!canUseAI(role)) {
    redirect(role === "VIEWER_ADSP" ? "/adsp" : "/dashboard");
  }

  const suggestion = getAiSupportSuggestion({
    role,
    taskType: "SUPPORTO_PROCEDIMENTO",
    input: "Verifica procedimenti con termini in scadenza e criticità economiche ad alta priorità.",
    referenceNorme: ["ART_47_COD_NAV", "ART_42_COD_NAV"],
  });

  return (
    <AppShell title="Assistente AI" subtitle="Supporto istruttorio assistivo con validazione umana obbligatoria">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Sintesi supporto AI</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">{suggestion.summary}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Azioni suggerite</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-slate-700">
              {suggestion.recommendedActions.map((item, index) => (
                <li key={`${index}-${item}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avvertenza</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">{suggestion.warning}</CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
