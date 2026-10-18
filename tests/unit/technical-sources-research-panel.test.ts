import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildTechnicalSourcesCall,
  parseTechnicalSourcesPanelState,
  TechnicalSourcesResearchPanel,
} from "@/components/procedimenti/TechnicalSourcesResearchPanel";
import { technicalSourcesToolCallSchema } from "@/server/technical-sources/technical-sources-mcp";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("technical sources research panel", () => {
  it("builds only server-schema-valid tool calls", () => {
    const calls = [
      buildTechnicalSourcesCall("search", form({ query: "urbanistica Amalfi" })),
      buildTechnicalSourcesCall("fetch", form({ sourceId: "regione-campania-ptr" })),
      buildTechnicalSourcesCall("lista_livelli_wms", form({ wmsSource: "campania-tematica", filtro: "vincoli" })),
      buildTechnicalSourcesCall("lista_livelli_wms", form({ wmsSource: "campania-ctr2020" })),
      buildTechnicalSourcesCall("interroga_punto_wms", form({
        wmsSource: "campania-tematica", layer: "vincoli", latitudine: "40.63", longitudine: "14.6",
      })),
      buildTechnicalSourcesCall("matrice_verifiche_manufatto", form({ tipo: "chiosco", comune: "Amalfi" })),
    ];
    for (const call of calls) {
      expect(technicalSourcesToolCallSchema.safeParse(call).success).toBe(true);
    }
    expect(buildTechnicalSourcesCall("search", form({ query: "  " }))).toBeNull();
    expect(buildTechnicalSourcesCall("interroga_punto_wms", form({
      wmsSource: "campania-tematica", layer: "vincoli", latitudine: "abc", longitudine: "14.6",
    }))).toBeNull();
  });

  it("rejects history payloads with unknown verification states", () => {
    const record = {
      id: "r1",
      missionId: "m1",
      questionSnapshot: "q",
      toolName: "search",
      requestPayload: {},
      responsePayload: {},
      serviceVersion: "0.5.0",
      verificationStatus: "DA_VERIFICARE_SU_FONTE_ORIGINALE",
      retrievedAt: "2026-10-18T12:00:00.000Z",
    };
    expect(parseTechnicalSourcesPanelState({ channelEnabled: false, missions: [], records: [record] }))
      .toMatchObject({ channelEnabled: false, canRequest: false, records: [{ id: "r1" }] });
    expect(parseTechnicalSourcesPanelState({
      channelEnabled: true,
      missions: [],
      records: [{ ...record, verificationStatus: "VERIFICATO" }],
    })).toBeNull();
  });

  it("does not render a request form before the channel state is known", () => {
    const research = renderToStaticMarkup(createElement(TechnicalSourcesResearchPanel, { procedimentoId: "p1" }));
    const analysis = renderToStaticMarkup(createElement(TechnicalSourcesResearchPanel, {
      procedimentoId: "p1",
      variant: "analysis",
    }));
    expect(research).toContain("Fonti tecniche e urbanistiche");
    expect(research).not.toContain("<form");
    expect(analysis).toContain("Riscontri tecnici e urbanistici (non probatori)");
    expect(analysis).not.toContain("<form");
  });
});
