import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";
import {
  DOCUMENT_CANALE_VALUES,
  DOCUMENT_DIREZIONE_VALUES,
  type DocumentoCanaleValue,
  type DocumentoDirezioneValue,
} from "@/server/documents/protocollo";
import { DOCUMENT_TIPOLOGIA_VALUES } from "@/server/documents/validation";

export const DOCUMENT_STATO_VALUES = ["ATTIVO", "ARCHIVIATO", "TUTTI"] as const;

export type DocumentoStatoFilter = (typeof DOCUMENT_STATO_VALUES)[number];

export interface GetDocumentiListParams {
  search?: string;
  tipologia?: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
  stato?: DocumentoStatoFilter;
  direzione?: DocumentoDirezioneValue;
  canale?: DocumentoCanaleValue;
  pecWarning?: "SI" | "NO";
}

export interface DocumentoListItem {
  id: string;
  nome: string;
  tipologia: string;
  statoDocumento: string;
  mimeType: string | null;
  dimensioneBytes: number | null;
  dataDocumento: Date | null;
  direzione: string | null;
  canale: string | null;
  numeroProtocollo: string | null;
  dataProtocollo: Date | null;
  mittente: string | null;
  destinatario: string | null;
  pecMessageId: string | null;
  pecRicevutaAccettazioneId: string | null;
  pecRicevutaConsegnaId: string | null;
  pecWarningMancataRicevuta: boolean;
  createdAt: Date;
  concessioneId: string | null;
  criticitaId: string | null;
  procedimentoId: string | null;
  sopralluogoId: string | null;
  pagamentoId: string | null;
  reportId: string | null;
  downloadUrl: string;
  uploadedByUserEmail: string | null;
}

export interface DocumentiFiltersData {
  tipologie: Array<{ value: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number]; label: string }>;
  stati: Array<{ value: DocumentoStatoFilter; label: string }>;
  direzioni: Array<{ value: DocumentoDirezioneValue; label: string }>;
  canali: Array<{ value: DocumentoCanaleValue; label: string }>;
  concessioni: Array<{ id: string; label: string }>;
  criticita: Array<{ id: string; label: string }>;
  procedimenti: Array<{ id: string; label: string }>;
  sopralluoghi: Array<{ id: string; label: string }>;
  pagamenti: Array<{ id: string; label: string }>;
  report: Array<{ id: string; label: string }>;
}

function buildWhere(params: GetDocumentiListParams): Prisma.DocumentoWhereInput {
  const search = params.search?.trim();

  return {
    ...(search
      ? {
          OR: [
            { nome: { contains: search } },
            { descrizione: { contains: search } },
            { uploadedByUserEmail: { contains: search } },
          ],
        }
      : {}),
    ...(params.tipologia ? { tipologia: params.tipologia } : {}),
    ...(params.stato === "TUTTI" || !params.stato ? {} : { statoDocumento: params.stato }),
    ...(params.direzione ? { direzione: params.direzione } : {}),
    ...(params.canale ? { canale: params.canale } : {}),
    ...(params.pecWarning === "SI"
      ? { pecWarningMancataRicevuta: true }
      : params.pecWarning === "NO"
        ? { pecWarningMancataRicevuta: false }
        : {}),
  };
}

export async function getDocumentiList(params: GetDocumentiListParams): Promise<DocumentoListItem[]> {
  const rows = await prisma.documento.findMany({
    where: buildWhere(params),
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      nome: true,
      tipologia: true,
      statoDocumento: true,
      mimeType: true,
      dimensioneBytes: true,
      dataDocumento: true,
      direzione: true,
      canale: true,
      numeroProtocollo: true,
      dataProtocollo: true,
      mittente: true,
      destinatario: true,
      pecMessageId: true,
      pecRicevutaAccettazioneId: true,
      pecRicevutaConsegnaId: true,
      pecWarningMancataRicevuta: true,
      createdAt: true,
      concessioneId: true,
      criticitaId: true,
      procedimentoId: true,
      sopralluogoId: true,
      pagamentoId: true,
      reportId: true,
      uploadedByUserEmail: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    dimensioneBytes: row.dimensioneBytes ?? null,
    downloadUrl: `/documenti/${row.id}/download`,
  }));
}

export async function getDocumentiFiltersData(): Promise<DocumentiFiltersData> {
  const [
    concessioni,
    criticita,
    procedimenti,
    sopralluoghi,
    pagamenti,
    report,
  ] = await Promise.all([
    prisma.concessione.findMany({
      orderBy: [{ dataScadenza: "asc" }],
      select: { id: true, numeroAtto: true },
    }),
    prisma.criticita.findMany({
      orderBy: [{ dataRilevazione: "desc" }],
      take: 50,
      select: { id: true, tipologia: true, concessione: { select: { numeroAtto: true } } },
    }),
    prisma.procedimento.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: { id: true, tipologia: true, concessione: { select: { numeroAtto: true } } },
    }),
    prisma.sopralluogo.findMany({
      orderBy: [{ data: "desc" }],
      take: 50,
      select: { id: true, data: true, concessione: { select: { numeroAtto: true } } },
    }),
    prisma.pagamento.findMany({
      orderBy: [{ dataScadenza: "desc" }],
      take: 50,
      select: { id: true, annoRiferimento: true, concessione: { select: { numeroAtto: true } } },
    }),
    prisma.report.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: { id: true, titolo: true },
    }),
  ]);

  return {
    tipologie: DOCUMENT_TIPOLOGIA_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    stati: DOCUMENT_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    direzioni: DOCUMENT_DIREZIONE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    canali: DOCUMENT_CANALE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    concessioni: concessioni.map((item) => ({ id: item.id, label: item.numeroAtto })),
    criticita: criticita.map((item) => ({ id: item.id, label: `${item.concessione.numeroAtto} - ${formatEnumLabel(item.tipologia)}` })),
    procedimenti: procedimenti.map((item) => ({ id: item.id, label: `${item.concessione.numeroAtto} - ${formatEnumLabel(item.tipologia)}` })),
    sopralluoghi: sopralluoghi.map((item) => ({ id: item.id, label: `${item.concessione.numeroAtto} - ${item.data.toISOString().slice(0, 10)}` })),
    pagamenti: pagamenti.map((item) => ({ id: item.id, label: `${item.concessione.numeroAtto} - ${item.annoRiferimento}` })),
    report: report.map((item) => ({ id: item.id, label: item.titolo })),
  };
}
