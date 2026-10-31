import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { isAuthorizedStagingFascicoloEvaluationEnvironment } from "@/server/ai/fascicoloAnalysisEvaluationStaging";

import { EvaluationAuthorizationPanel } from "./EvaluationAuthorizationPanel";

export const dynamic = "force-dynamic";

export default async function FascicoloAnalysisEvaluationPage() {
  if (!isAuthorizedStagingFascicoloEvaluationEnvironment()) notFound();
  await requireRole(["ADMIN"]);

  return (
    <AppShell
      title="Valutazione fascicolo TEST-LEGAL-001"
      subtitle="Autorizzazione ed esecuzione one-off sono azioni separate e richiedono conferme distinte"
    >
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Controllo della valutazione</CardTitle>
        </CardHeader>
        <CardContent>
          <EvaluationAuthorizationPanel />
        </CardContent>
      </Card>
    </AppShell>
  );
}
