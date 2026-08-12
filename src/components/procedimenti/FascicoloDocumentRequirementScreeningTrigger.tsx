import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { createFascicoloDocumentRequirementProposal } from "@/server/actions/fascicolo-document-requirements";

interface FascicoloDocumentRequirementScreeningTriggerProps {
  procedimentoId: string;
  canRun: boolean;
  hasCanonicalTenant: boolean;
  screeningDone?: boolean;
}

async function runScreening(procedimentoId: string, _formData: FormData): Promise<void> {
  "use server";

  await createFascicoloDocumentRequirementProposal({ procedimentoId });
  revalidatePath(`/procedimenti/${procedimentoId}`);
  redirect(`/procedimenti/${procedimentoId}?screening=done`);
}

export function FascicoloDocumentRequirementScreeningTrigger({
  procedimentoId,
  canRun,
  hasCanonicalTenant,
  screeningDone = false,
}: FascicoloDocumentRequirementScreeningTriggerProps) {
  if (!canRun || !hasCanonicalTenant) {
    return null;
  }

  const screeningAction = runScreening.bind(null, procedimentoId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Screening requisiti istruttori</CardTitle>
        <CardDescription>
          Lo screening utilizza i dati canonici registrati per generare eventuali proposte istruttorie da sottoporre a revisione umana.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {screeningDone ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Screening eseguito. Eventuali proposte generate richiedono revisione umana.
          </p>
        ) : null}
        <form action={screeningAction}>
          <Button type="submit">Esegui screening istruttorio</Button>
        </form>
      </CardContent>
    </Card>
  );
}