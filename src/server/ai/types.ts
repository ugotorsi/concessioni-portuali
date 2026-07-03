export type AiTaskType = "ANALISI_CRITICITA" | "SUPPORTO_PROCEDIMENTO" | "SINTESI_REPORT";

export interface AiTaskContext {
  role: string;
  taskType: AiTaskType;
  input: string;
  referenceNorme?: string[];
}

export interface AiSuggestion {
  summary: string;
  recommendedActions: string[];
  warning: string;
}
