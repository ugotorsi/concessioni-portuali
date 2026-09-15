import { describe, expect, it, vi } from "vitest";

import {
  buildNormattivaQuery,
  createNormattivaProvider,
  MAX_NORMATTIVA_RESULTS,
  NORMATTIVA_ADVANCED_SEARCH_ENDPOINT,
  NormattivaProviderError,
} from "@/server/intake/official-source-lookup/normattiva";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function hit(overrides: Record<string, unknown> = {}) {
  return {
    codiceRedazionale: "090G0291",
    denominazioneAtto: "LEGGE",
    numeroProvvedimento: "241",
    annoProvvedimento: 1990,
    dataEmanazione: "1990-08-07",
    titoloAtto: "Nuove norme in materia di procedimento amministrativo",
    ...overrides,
  };
}

describe("B2C12 Block 3B.6C Normattiva provider", () => {
  it.each([
    ["LEGGE", "LEGGE"],
    ["DECRETO_LEGGE", "DECRETO-LEGGE"],
    ["DECRETO_LEGISLATIVO", "DECRETO LEGISLATIVO"],
    ["DECRETO_PRESIDENTE_REPUBBLICA", "DECRETO DEL PRESIDENTE DELLA REPUBBLICA"],
  ])("projects %s onto its official denomination", (actType, denomination) => {
    expect(buildNormattivaQuery({ kind: "LEGISLATION", actType, actNumber: "0241", year: 1990 })).toEqual({
      denominazioneAtto: denomination,
      annoProvvedimento: 1990,
      numeroProvvedimento: "241",
      orderType: "DATA_DESC",
      paginazione: { paginaCorrente: 1, numeroElementiPerPagina: MAX_NORMATTIVA_RESULTS + 1 },
    });
  });

  it.each([
    { kind: "CASE_LAW", actType: null, actNumber: "1", year: 2020 },
    { kind: "CODE", actType: "CODICE_CIVILE", actNumber: "2043", year: null },
    { kind: "LEGISLATION", actType: "LEGGE_REGIONALE", actNumber: "5", year: 2021 },
    { kind: "LEGISLATION", actType: "DECRETO", actNumber: "36", year: 2023 },
    { kind: "LEGISLATION", actType: "LEGGE", actNumber: null, year: 1990 },
  ])("fails closed for unsupported or insufficient identity", (reference) => {
    expect(buildNormattivaQuery(reference)).toBeNull();
  });

  it("sends only the explicit structured allowlist to the fixed endpoint", async () => {
    const transport = vi.fn(async () => jsonResponse({ risultati: [] }));
    const provider = createNormattivaProvider({ transport });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await provider.lookup(query);
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(NORMATTIVA_ADVANCED_SEARCH_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual([
      "annoProvvedimento", "denominazioneAtto", "numeroProvvedimento", "orderType", "paginazione",
    ].sort());
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining([
      "titoloRicerca", "testoRicerca", "tenantId", "enteId", "fascicoloId", "userId",
      "filename", "documentId", "intakeId", "mentionId",
    ]));
  });

  it("classifies zero, one, and multiple exact hits without selecting the first", async () => {
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    const zero = createNormattivaProvider({ transport: async () => jsonResponse({ risultati: [] }) });
    const one = createNormattivaProvider({ transport: async () => jsonResponse({ risultati: [hit()] }) });
    const many = createNormattivaProvider({
      transport: async () => jsonResponse({ risultati: [hit(), hit({ codiceRedazionale: "090G0292" })] }),
    });
    await expect(zero.lookup(query)).resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
    await expect(one.lookup(query)).resolves.toMatchObject({ status: "FOUND_UNIQUE", resultCount: 1 });
    await expect(many.lookup(query)).resolves.toMatchObject({ status: "AMBIGUOUS", resultCount: 2 });
  });

  it("collapses identical duplicate provider records before cardinality classification", async () => {
    const provider = createNormattivaProvider({
      transport: async () => jsonResponse({ risultati: [hit(), hit()] }),
    });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{ providerRecordId: "090G0291" }],
    });
  });

  it("fails closed when one provider record ID has conflicting normalized identity", async () => {
    const provider = createNormattivaProvider({
      transport: async () => jsonResponse({ risultati: [
        hit(),
        hit({ numeroProvvedimento: "0241", denominazioneAtto: "LEGGE", annoProvvedimento: 1990 }),
        hit({ annoProvvedimento: 1991 }),
      ] }),
    });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("keeps distinct provider record IDs ambiguous even when act identity is equal", async () => {
    const provider = createNormattivaProvider({
      transport: async () => jsonResponse({ risultati: [hit(), hit({ codiceRedazionale: "090G0292" })] }),
    });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).resolves.toMatchObject({ status: "AMBIGUOUS", resultCount: 2 });
  });

  it("rejects mismatched provider hits during local identity reconciliation", async () => {
    const provider = createNormattivaProvider({
      transport: async () => jsonResponse({ risultati: [
        hit({ codiceRedazionale: "mismatch-number", numeroProvvedimento: "240" }),
        hit({ codiceRedazionale: "mismatch-year", annoProvvedimento: 1991 }),
        hit({ codiceRedazionale: "mismatch-type", denominazioneAtto: "DECRETO LEGISLATIVO" }),
      ] }),
    });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
  });

  it("fails closed on provider result overflow", async () => {
    const provider = createNormattivaProvider({
      transport: async () => jsonResponse({
        risultati: Array.from({ length: MAX_NORMATTIVA_RESULTS + 1 }, (_, index) =>
          hit({ codiceRedazionale: `record-${index}` })),
      }),
    });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).rejects.toMatchObject({ code: "RESULT_LIMIT_EXCEEDED", retryable: false });
  });

  it.each([[429, true], [503, true], [400, false]])("classifies HTTP %i retryability", async (status, retryable) => {
    const provider = createNormattivaProvider({ transport: async () => new Response(null, { status }) });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).rejects.toMatchObject({ retryable });
  });

  it("enforces timeout, redirect rejection, JSON content, and response-size ceiling", async () => {
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    const timeout = createNormattivaProvider({
      timeoutMs: 5,
      transport: async (_url, init) => new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(timeout.lookup(query)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });

    const nonJson = createNormattivaProvider({
      transport: async (_url, init) => {
        expect(init?.redirect).toBe("error");
        return new Response("html", { headers: { "Content-Type": "text/html" } });
      },
    });
    await expect(nonJson.lookup(query)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const oversized = createNormattivaProvider({
      maxResponseBytes: 10,
      transport: async () => jsonResponse({ risultati: [hit()] }),
    });
    await expect(oversized.lookup(query)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("never exposes raw provider payload on protocol errors", async () => {
    const provider = createNormattivaProvider({ transport: async () => jsonResponse({ secret: "raw-body" }) });
    const query = buildNormattivaQuery({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "241", year: 1990 })!;
    await expect(provider.lookup(query)).rejects.toEqual(expect.any(NormattivaProviderError));
    await expect(provider.lookup(query)).rejects.not.toThrow(/raw-body/);
  });
});