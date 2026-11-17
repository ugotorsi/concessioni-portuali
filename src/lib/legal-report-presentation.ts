import type { StructuredReportLegalApplication } from "@/server/fascicolo-report/legal-application";

import { humanizeProfessionalText } from "./professional-text";

type Element = NonNullable<StructuredReportLegalApplication["elementAnalysis"]>["elements"][number];

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function sentence(text: string): string {
  const trimmed = humanizeProfessionalText(text).trim().replace(/[.;:,]+$/, "");
  return trimmed;
}

function list(elements: readonly Element[]): string {
  const items = elements.map((element) => lowerFirst(sentence(element.requirement)));
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join("; ")} e ${items.at(-1)}`;
}

/**
 * Discursive exposition of one legal issue: documented facts, which conditions of the rule are met,
 * which are not proven or contradicted (distinguishing the decisive ones), and the resulting qualification.
 * It rearranges existing assessed content only; it never adds facts or conclusions.
 */
export function legalIssueNarrative(item: StructuredReportLegalApplication): string[] {
  const paragraphs: string[] = [];
  const facts = item.facts.filter((fact) => fact.text.trim()).slice(0, 3);
  if (facts.length) {
    const described = facts.map((fact) =>
      `${sentence(fact.text)}${fact.pages.length ? ` (pag. ${fact.pages.join(", ")})` : ""}${fact.humanConfirmed ? "" : ", da confermare"}`);
    paragraphs.push(`Dai documenti del fascicolo risulta quanto segue: ${described.join("; ")}.${item.facts.length > facts.length ? ` Ulteriori ${item.facts.length - facts.length} elementi sono riportati nel dettaglio.` : ""}`);
  } else {
    paragraphs.push("Il fascicolo non contiene fatti estratti collegati a questa questione: ogni valutazione resta subordinata all'acquisizione dei documenti pertinenti.");
  }
  const analysis = item.elementAnalysis;
  if (analysis) {
    const met = analysis.elements.filter((element) => element.status === "PROVEN" || element.status === "INDICATED");
    const unproven = analysis.elements.filter((element) => element.status === "NOT_PROVEN");
    const contrary = analysis.elements.filter((element) => element.status === "CONTRARY_EVIDENCE");
    const decisive = [...unproven, ...contrary].filter((element) => element.core);
    const parts = [`Ai fini della qualificazione come «${lowerFirst(sentence(analysis.label))}» occorre verificare ${analysis.elements.length} presupposti.`];
    if (met.length) {
      const toConfirm = met.filter((element) => element.status === "INDICATED").length;
      parts.push(`Risultano dai documenti: ${list(met)}${toConfirm ? ` (${toConfirm === met.length ? "tutti" : toConfirm} ancora da confermare da parte del professionista)` : ""}.`);
    }
    if (unproven.length) parts.push(`Non sono dimostrati: ${list(unproven)}.`);
    if (contrary.length) parts.push(`Sono presenti elementi contrari o giustificativi riguardo a: ${list(contrary)}.`);
    if (decisive.length) {
      parts.push(`${decisive.length === 1 ? "Il presupposto determinante ancora da accertare è" : "I presupposti determinanti ancora da accertare sono"}: ${list(decisive)}; finché non ${decisive.length === 1 ? "è chiarito" : "sono chiariti"}, la fattispecie non può dirsi integrata e l'assenza di un documento non equivale alla prova dell'inesistenza del fatto.`);
    } else if (!unproven.length && !contrary.length) {
      parts.push("Tutti i presupposti trovano riscontro documentale, fermo restando il contraddittorio con l'interessato.");
    }
    paragraphs.push(parts.join(" "));
    paragraphs.push(sentence(analysis.qualification) + ".");
  }
  const conclusion = conclusionRemainder(item.conclusion, paragraphs);
  if (conclusion) paragraphs.push(`Conclusione: ${conclusion}`);
  return paragraphs;
}

const RESTATED_PREFIXES = /^(Condizioni che risultano dai documenti|Condizioni non dimostrate|Determinanti per la decisione)\b/;

/** Conclusion sentences not already expressed by the exposition (the structured conclusion restates qualification and conditions). */
function conclusionRemainder(conclusion: string, previous: readonly string[]): string {
  const text = humanizeProfessionalText(conclusion).trim().replace(/^Qualificazione proposta:\s*/, "");
  const normalized = (value: string) => value.replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  const said = normalized(previous.join(" "));
  const parts = text.split(/(?<=[.;])\s+(?=[A-ZÀ-Ú«])/)
    .filter((part) => !RESTATED_PREFIXES.test(part) && !said.includes(normalized(part)));
  return parts.join(" ").trim();
}

export interface CommonLegalContent {
  /** Keys from {@link legalRuleKey}. */
  readonly ruleKeys: ReadonlySet<string>;
  readonly arguments: ReadonlySet<string>;
  readonly consequences: ReadonlySet<string>;
}

/** A rule is shared only if its temporal status and application to the facts are identical too. */
export function legalRuleKey(rule: StructuredReportLegalApplication["rules"][number]): string {
  return [rule.ruleId, rule.temporalStatus, rule.temporalReasoning, rule.applicationToFacts].join("\u0000");
}

/** Rules and warnings repeated identically in every issue are shown once instead of in each issue. */
export function commonLegalContent(items: readonly StructuredReportLegalApplication[]): CommonLegalContent {
  if (items.length < 2) return { ruleKeys: new Set(), arguments: new Set(), consequences: new Set() };
  const intersect = (sets: readonly Set<string>[]) =>
    new Set([...sets[0]!].filter((value) => sets.every((set) => set.has(value))));
  return {
    ruleKeys: intersect(items.map((item) => new Set(item.rules.map(legalRuleKey)))),
    arguments: intersect(items.map((item) => new Set(item.contraryArguments))),
    consequences: intersect(items.map((item) => new Set(item.consequences))),
  };
}
