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
    "Concessioni portuali ricadenti nel perimetro delle Autorita di sistema portuale.",
  MARITTIMA_TURISTICO_RICREATIVA:
    "Perimetro concessorio autonomo per gli usi turistico-ricreativi del demanio marittimo-costiero.",
  ALTRA_CONCESSIONE_DEMANIALE:
    "Concessioni demaniali non ricomprese nei perimetri portuale e turistico-ricreativo.",
};

const VERTICAL_COVERAGE_BY_VALUE: Record<ConcessionVerticalValue, string> = {
  PORTUALE_ADSP: "Configurata",
  MARITTIMA_TURISTICO_RICREATIVA: "Configurata",
  ALTRA_CONCESSIONE_DEMANIALE: "Configurata",
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