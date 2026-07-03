import { DEMO_ROLES, canUseAI, type DemoRole } from "@/lib/auth";
import { buildAiPrompt } from "@/server/ai/promptTemplates";
import type { AiSuggestion, AiTaskContext } from "@/server/ai/types";

function toDemoRole(role: string): DemoRole | null {
  return DEMO_ROLES.includes(role as DemoRole) ? (role as DemoRole) : null;
}

export function getAiSupportSuggestion(context: AiTaskContext): AiSuggestion {
  const role = toDemoRole(context.role);

  if (!role || !canUseAI(role)) {
    return {
      summary: "Profilo non abilitato al modulo assistente AI.",
      recommendedActions: ["Richiedere supporto a un profilo back-office abilitato."],
      warning:
        "La funzionalita AI e disabilitata per il profilo corrente; nessuna elaborazione istruttoria automatica disponibile.",
    };
  }

  const prompt = buildAiPrompt(context);
  const shortInput = context.input.length > 220 ? `${context.input.slice(0, 220)}...` : context.input;

  return {
    summary: `Supporto istruttorio generato da template interno. Contesto analizzato: ${shortInput}`,
    recommendedActions: [
      "Verificare coerenza tra fatti, documenti e stato dei moduli collegati.",
      "Confrontare riferimenti normativi suggeriti con la versione vigente nel modulo Normativa.",
      "Far validare le conclusioni operative a un responsabile umano prima di qualunque comunicazione esterna.",
      `Prompt operativo usato: ${prompt}`,
    ],
    warning:
      "Output assistivo: non costituisce provvedimento, non sostituisce valutazione discrezionale e decisione dell Autorita competente.",
  };
}
