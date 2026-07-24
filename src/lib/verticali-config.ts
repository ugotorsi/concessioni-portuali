import { CONCESSION_VERTICAL_VALUES } from "@/lib/concession-vertical";
import { getConcessionVerticalLabel } from "@/lib/concession-vertical-labels";

export type ConcessionVerticalValue = (typeof CONCESSION_VERTICAL_VALUES)[number];

export interface VerticaleConfigItem {
  value: ConcessionVerticalValue;
  slug: string;
  label: string;
  description: string;
  coverageLabel: string;
}

const VERTICAL_SLUG_BY_VALUE: Record<ConcessionVerticalValue, string> = {
  PORTUALE_ADSP: "portuale-adsp",
  MARITTIMA_TURISTICO_RICREATIVA: "marittima-turistico-ricreativa",
  ALTRA_CONCESSIONE_DEMANIALE: "altra-concessione-demaniale",
};

const VERTICAL_DESCRIPTION_BY_VALUE: Record<ConcessionVerticalValue, string> = {
  PORTUALE_ADSP:
    "Gestione operativa concessioni portuali con presidio su scadenze, criticita istruttorie e monitoraggio dei rapporti in area AdSP.",
  MARITTIMA_TURISTICO_RICREATIVA:
    "Vista dedicata alle concessioni marittime turistico-ricreative con attenzione a uso del bene, stagionalita e procedimenti correlati.",
  ALTRA_CONCESSIONE_DEMANIALE:
    "Perimetro residuale per concessioni demaniali non riconducibili ai due ambiti principali, con monitoraggio operativo centralizzato.",
};

const VERTICAL_COVERAGE_BY_VALUE: Record<ConcessionVerticalValue, string> = {
  PORTUALE_ADSP: "Perimetro configurato",
  MARITTIMA_TURISTICO_RICREATIVA: "Perimetro configurato",
  ALTRA_CONCESSIONE_DEMANIALE: "Perimetro configurato",
};

export const VERTICALI_CONFIG: VerticaleConfigItem[] = CONCESSION_VERTICAL_VALUES.map((value) => ({
  value,
  slug: VERTICAL_SLUG_BY_VALUE[value],
  label: getConcessionVerticalLabel(value),
  description: VERTICAL_DESCRIPTION_BY_VALUE[value],
  coverageLabel: VERTICAL_COVERAGE_BY_VALUE[value],
}));

const verticaleBySlug = new Map(VERTICALI_CONFIG.map((item) => [item.slug, item]));
const verticaleByValue = new Map(VERTICALI_CONFIG.map((item) => [item.value, item]));

export function getVerticaleBySlug(slug: string): VerticaleConfigItem | null {
  return verticaleBySlug.get(slug) ?? null;
}

export function getVerticaleByValue(value: string | null | undefined): VerticaleConfigItem | null {
  if (!value) {
    return null;
  }

  return verticaleByValue.get(value as ConcessionVerticalValue) ?? null;
}