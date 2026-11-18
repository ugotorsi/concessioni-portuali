export type ResearchMissionDisplayState =
  | "REQUESTED"
  | "QUEUED"
  | "RUNNING"
  | "BLOCKED"
  | "FAILED"
  | "COMPLETED_NO_RESULTS"
  | "COMPLETED_SOURCES_TO_VERIFY"
  | "VALIDATED";

export const RESEARCH_MISSION_DISPLAY_LABELS: Readonly<Record<ResearchMissionDisplayState, string>> = {
  REQUESTED: "Richiesta",
  QUEUED: "Accodata",
  RUNNING: "In esecuzione",
  BLOCKED: "Bloccata",
  FAILED: "Fallita",
  COMPLETED_NO_RESULTS: "Completata senza risultati",
  COMPLETED_SOURCES_TO_VERIFY: "Completata: fonti da verificare",
  VALIDATED: "Fonti validate",
};

/** A queued job not taken in charge within this window is reported as blocked, never as running. */
export const RESEARCH_QUEUE_STALL_MS = 30 * 60 * 1000;

export interface ResearchMissionExecutionJobView {
  status: "QUEUED" | "RUNNING" | "RETRY_WAIT" | "CANCELLATION_REQUESTED" | "SUCCEEDED" | "TERMINAL_FAILED" | "CANCELLED";
  failureCode: string | null;
  availableAt: Date;
  leaseExpiresAt: Date | null;
  createdAt: Date;
}

export interface ResearchMissionDisplayInput {
  status: string;
  lifecycleStatus: string;
  claimExpiresAt: Date | null;
  results: readonly { classificationReviewStatus: string }[];
  job: ResearchMissionExecutionJobView | null;
  now: Date;
}

export interface ResearchMissionDisplay {
  state: ResearchMissionDisplayState;
  label: string;
  detail: string;
  stalled: boolean;
}

const FAILURE_DETAILS: Readonly<Record<string, string>> = {
  RESEARCH_MISSION_NOT_CURRENT: "la missione appartiene a una revisione dell'analisi non più corrente",
  RESEARCH_MISSION_NOT_ACCESSIBLE: "la missione non è accessibile nell'ambito del fascicolo e del tenant",
  RESEARCH_POLICY_CHANGED_SINCE_ADMISSION: "la policy di ricerca è cambiata dopo l'autorizzazione",
  RESEARCH_JOB_SCOPE_INVALID: "il job non corrisponde all'operazione o al tenant autorizzati",
  MANUAL_RESEARCH_POLICY_DISABLED: "l'esecuzione manuale non è abilitata",
  AUTOMATIC_RESEARCH_POLICY_DISABLED: "l'esecuzione automatica è disattivata",
  AUTOMATIC_RESEARCH_POLICY_OR_SCOPE_INVALID: "policy, ambito o revisione della missione non più validi",
};

function failureDetail(code: string | null): string {
  if (!code) return "esito tecnico non specificato";
  return FAILURE_DETAILS[code]
    ?? (/_BUDGET_/.test(code) ? "budget non consentito dalla policy"
      : /_TENANT_|_PROCEDIMENTO_/.test(code) ? "fascicolo o ente fuori dall'ambito autorizzato"
        : "errore tecnico registrato nell'audit dell'esecuzione");
}

function display(state: ResearchMissionDisplayState, detail: string, stalled = false): ResearchMissionDisplay {
  return { state, label: RESEARCH_MISSION_DISPLAY_LABELS[state], detail, stalled };
}

function hours(ms: number): string {
  const value = Math.max(1, Math.round(ms / 3_600_000));
  return value === 1 ? "circa 1 ora" : `circa ${value} ore`;
}

/**
 * Derives one explicit state from mission, latest execution job and result reviews.
 * A mission is reported as running only while a live lease or claim exists.
 */
export function researchMissionDisplayState(input: ResearchMissionDisplayInput): ResearchMissionDisplay {
  const confirmed = input.results.filter((result) => result.classificationReviewStatus === "HUMAN_CONFIRMED").length;
  const reviewable = input.results.filter((result) => result.classificationReviewStatus !== "REJECTED").length;

  if (input.lifecycleStatus !== "CURRENT") {
    return display("BLOCKED", "Missione storica: è stata superata da una revisione successiva dell'analisi e non viene eseguita.");
  }
  if (confirmed > 0) {
    return display("VALIDATED", confirmed === 1 ? "1 fonte confermata dal professionista." : `${confirmed} fonti confermate dal professionista.`);
  }
  if (reviewable > 0 && (input.status === "COMPLETED" || input.status === "BUDGET_EXHAUSTED")) {
    return display("COMPLETED_SOURCES_TO_VERIFY", `${reviewable} risultat${reviewable === 1 ? "o" : "i"} da sottoporre a verifica professionale.`);
  }
  if (input.status === "COMPLETED") {
    return display("COMPLETED_NO_RESULTS", "La ricerca è terminata senza fonti utilizzabili: nessuna conclusione giuridica è stata desunta.");
  }
  if (input.status === "REJECTED") return display("FAILED", "Missione respinta.");
  if (input.status === "DEFERRED") {
    if (input.job?.status === "SUCCEEDED") {
      // Executed but closed as incomplete: the outcome is a research limit, not a policy refusal.
      return reviewable > 0
        ? display("COMPLETED_SOURCES_TO_VERIFY", `Ricerca eseguita ma incompleta: ${reviewable} risultat${reviewable === 1 ? "o" : "i"} da sottoporre a verifica professionale; mancano fonti sufficienti per concludere.`)
        : display("COMPLETED_NO_RESULTS", "Ricerca eseguita ma incompleta: nessuna fonte utilizzabile, nessuna conclusione giuridica è stata desunta.");
    }
    if (!input.job) return display("BLOCKED", "Non ancora eseguita: in attesa di ammissione per il limite del ciclo di ricerca o per la policy corrente.");
    return display("BLOCKED", "Missione non ammessa dalla policy corrente.");
  }
  if (input.status === "BUDGET_EXHAUSTED") return display("BLOCKED", "Budget della missione esaurito senza risultati.");

  const job = input.job;
  if (job) {
    if (job.status === "TERMINAL_FAILED") return display("FAILED", `Esecuzione non riuscita: ${failureDetail(job.failureCode)}.`);
    if (job.status === "CANCELLED" || job.status === "CANCELLATION_REQUESTED") {
      return display("BLOCKED", "Esecuzione annullata: la missione non è in corso.");
    }
    if (job.status === "RUNNING") {
      if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > input.now.getTime()) {
        return display("RUNNING", "Esecuzione in corso con lease attivo.");
      }
      return display("BLOCKED", "Esecuzione interrotta: il worker non rinnova più il lease. Serve una verifica prima di qualsiasi ripresa.", true);
    }
    if (job.status === "QUEUED" || job.status === "RETRY_WAIT") {
      const waitingMs = input.now.getTime() - job.availableAt.getTime();
      if (waitingMs > RESEARCH_QUEUE_STALL_MS) {
        return display("BLOCKED", `In coda da ${hours(waitingMs)} senza presa in carico: nessun worker attivo l'ha elaborata.`, true);
      }
      return display("QUEUED", "In attesa di presa in carico da parte del worker autorizzato.");
    }
  }

  if (input.status === "IN_PROGRESS") {
    if (input.claimExpiresAt && input.claimExpiresAt.getTime() > input.now.getTime()) {
      return display("RUNNING", "Esecuzione in corso presso il canale autorizzato.");
    }
    return display("BLOCKED", "Esecuzione senza riscontro: l'incarico è scaduto senza esiti registrati.", true);
  }
  return display("REQUESTED", "Richiesta registrata: nessuna esecuzione è ancora stata avviata.");
}
