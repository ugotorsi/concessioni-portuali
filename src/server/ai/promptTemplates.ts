import type { AiTaskContext } from "@/server/ai/types";

export function buildAiPrompt(context: AiTaskContext): string {
  const norme = context.referenceNorme?.length
    ? `Riferimenti normativi da considerare: ${context.referenceNorme.join(", ")}.`
    : "Nessun riferimento normativo fornito.";

  return [
    "Sei un assistente interno per supporto istruttorio concessioni portuali.",
    "Produci solo output di supporto, mai decisioni finali.",
    `Ruolo utente: ${context.role}.`,
    `Task: ${context.taskType}.`,
    norme,
    `Input operativo: ${context.input}`,
    "Rispondi in italiano con: sintesi, azioni consigliate e avvertenza di non sostituzione della decisione dell Autorita.",
  ].join("\n");
}
