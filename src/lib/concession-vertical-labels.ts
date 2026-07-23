import { formatEnumLabel } from "@/lib/utils";

export function getConcessionVerticalLabel(value: string): string {
  switch (value) {
    case "PORTUALE_ADSP":
      return "Portuale / AdSP";
    case "MARITTIMA_TURISTICO_RICREATIVA":
      return "Turistico-ricreativa / Comune costiero";
    case "ALTRA_CONCESSIONE_DEMANIALE":
      return "Altro demanio";
    default:
      return formatEnumLabel(value);
  }
}

export function getLegalFrameworkLabel(value: string): string {
  switch (value) {
    case "ART_36_COD_NAV":
      return "Art. 36 cod. nav.";
    case "ART_18_L_84_1994":
      return "Art. 18 l. 84/1994";
    case "ART_37_COD_NAV":
      return "Art. 37 cod. nav.";
    case "ART_47_COD_NAV":
      return "Art. 47 cod. nav. (profilo istruttorio)";
    case "DL_400_1993":
      return "d.l. 400/1993";
    case "DIR_2006_123_ART_12":
      return "Dir. 2006/123/CE art. 12";
    default:
      return formatEnumLabel(value);
  }
}