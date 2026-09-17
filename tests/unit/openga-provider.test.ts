import { describe, expect, it, vi } from "vitest";

import {
  buildOpenGaCompositeNumber,
  createOpenGaProvider,
  OPENGA_BASE_URL,
  OPENGA_DATASET_MAPPING,
  OpenGaProviderError,
  resolveOpenGaCourt,
} from "@/server/intake/official-source-lookup/openga";

const cdsReference = {
  kind: "CASE_LAW",
  authorityHint: "Consiglio di Stato",
  actType: "SENTENZA",
  actNumber: "471",
  year: 2025,
  chamberSection: "III",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function packageMetadata(
  slug = "sentenze-consiglio-di-stato",
  resources: Record<string, unknown>[] = [{
    id: "resource-2025",
    name: "Sentenze 2025",
    format: "JSON",
    datastore_active: true,
    url: `${OPENGA_BASE_URL}/dataset/resource-2025.json`,
  }],
) {
  return json({ success: true, result: { name: slug, resources } });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    _id: 10,
    organo: "Consiglio di Stato",
    sezione: "III",
    tipo_provvedimento: "Sentenza",
    numero: "202500471",
    anno: 2025,
    data_decisione: "2025-01-15",
    data_pubblicazione: "16/01/2025",
    esito: "Respinge",
    oggetto: "Concessione demaniale",
    ...overrides,
  };
}

function transport(rows: unknown[], metadata = packageMetadata()) {
  return vi.fn(async (url: string) => url.includes("package_show")
    ? metadata
    : json({ success: true, result: { records: rows } }));
}

describe("Block 3B.10A OpenGA official provider", () => {
  it.each([
    ["Consiglio di Stato", "sentenze-consiglio-di-stato"],
    ["CDS", "sentenze-consiglio-di-stato"],
    ["Consiglio di Giustizia Amministrativa per la Regione Siciliana", "sentenze-cga-sicilia"],
    ["Tribunale Amministrativo Regionale per il Lazio, sede di Roma", "sentenze-tar-lazio-roma"],
    ["Tribunale Regionale di Giustizia Amministrativa Trento", "sentenze-trga-trento"],
  ])("maps the known court alias %s deterministically", (alias, datasetSlug) => {
    expect(resolveOpenGaCourt(alias)).toMatchObject({ datasetSlug });
  });

  it("covers all 31 closed-reconnaissance Sentenze datasets", () => {
    expect(Object.keys(OPENGA_DATASET_MAPPING)).toHaveLength(31);
  });

  it.each(["TAR Lazio", "TAR Campania", "TAR Lombardia", "TAR Puglia", "TAR Sicilia"])(
    "does not guess a seat for ambiguous authority %s",
    (authorityHint) => expect(resolveOpenGaCourt(authorityHint)).toBeNull(),
  );

  it.each([
    ["471", 2025, "202500471"],
    ["00471", 2025, "202500471"],
    ["202500471", 2025, "202500471"],
  ])("normalizes provider decision number %s", (number, year, expected) => {
    expect(buildOpenGaCompositeNumber(number, year)).toBe(expected);
  });

  it.each([
    [cdsReference, "Consiglio di Stato", "sentenze-consiglio-di-stato"],
    [{ ...cdsReference, authorityHint: "TAR Campania Napoli" }, "TAR Campania Napoli", "sentenze-tar-campania-napoli"],
    [{ ...cdsReference, authorityHint: "CGA Sicilia" }, "CGA Sicilia", "sentenze-cga-sicilia"],
  ])("returns a unique verified %s hit", async (reference, officialName, datasetSlug) => {
    const provider = createOpenGaProvider({
      transport: transport([row({ organo: officialName })], packageMetadata(datasetSlug)),
    });
    await expect(provider.lookup(reference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{
        providerSourceId: `${datasetSlug}:resource-2025`,
        authority: officialName,
        decisionNumber: "471",
        decisionYear: 2025,
        decisionType: "SENTENZA",
        ecli: null,
        sourceUrl: null,
        subject: "Concessione demaniale",
        outcome: "Respinge",
      }],
    });
  });

  it("selects the unique machine-readable resource for the requested year", async () => {
    const request = transport([row()], packageMetadata("sentenze-consiglio-di-stato", [
      { id: "csv-2024", name: "Sentenze 2024", format: "CSV", url: `${OPENGA_BASE_URL}/2024.csv` },
      { id: "json-2025", name: "Sentenze 2025", format: "JSON", url: `${OPENGA_BASE_URL}/2025.json` },
      { id: "ods-2025", name: "Sentenze 2025", format: "ODS", url: `${OPENGA_BASE_URL}/2025.ods` },
    ]));
    await createOpenGaProvider({ transport: request }).lookup(cdsReference);
    expect(request.mock.calls[1][0]).toBe(`${OPENGA_BASE_URL}/2025.json`);
  });

  it("prefers a unique DataStore resource over direct JSON for the year", async () => {
    const request = transport([row()], packageMetadata("sentenze-consiglio-di-stato", [
      { id: "json-2025", name: "Sentenze 2025", format: "JSON", url: `${OPENGA_BASE_URL}/2025.json` },
      { id: "store-2025", name: "Sentenze 2025", format: "CSV", datastore_active: true },
    ]));
    await createOpenGaProvider({ transport: request }).lookup(cdsReference);
    expect(request.mock.calls[1][0]).toContain("datastore_search?resource_id=store-2025&q=202500471&limit=101");
  });

  it("fails closed when resource selection is equally valid", async () => {
    const provider = createOpenGaProvider({ transport: transport([], packageMetadata(
      "sentenze-consiglio-di-stato",
      [
        { id: "a", name: "Sentenze 2025 A", format: "JSON", url: `${OPENGA_BASE_URL}/a.json` },
        { id: "b", name: "Sentenze 2025 B", format: "JSON", url: `${OPENGA_BASE_URL}/b.json` },
      ],
    )) });
    await expect(provider.lookup(cdsReference)).rejects.toMatchObject({ code: "AMBIGUOUS_RESOURCE", retryable: false });
  });

  it("returns not found for no resource or no matching row", async () => {
    const noResource = createOpenGaProvider({ transport: transport([], packageMetadata(
      "sentenze-consiglio-di-stato",
      [{ id: "old", name: "Sentenze 2024", format: "JSON", url: `${OPENGA_BASE_URL}/2024.json` }],
    )) });
    await expect(noResource.lookup(cdsReference)).resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
    await expect(createOpenGaProvider({ transport: transport([]) }).lookup(cdsReference))
      .resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
  });

  it("returns ambiguous rather than selecting one of multiple matching rows", async () => {
    const provider = createOpenGaProvider({ transport: transport([row({ _id: 1 }), row({ _id: 2 })]) });
    await expect(provider.lookup(cdsReference)).resolves.toMatchObject({ status: "AMBIGUOUS", resultCount: 2 });
  });

  it("maps known CSV/JSON field names independently of punctuation and casing", async () => {
    const provider = createOpenGaProvider({ transport: transport([{
      ID: "cds-471",
      Organo: "Consiglio di Stato",
      Sezione: "III",
      "Tipo Provvedimento": "Sentenza",
      "Numero Provvedimento": "202500471",
      Anno: 2025,
      "Data Pubblicazione": "16/01/2025",
      Oggetto: "Concessione demaniale",
      Esito: "Respinge",
    }]) });
    await expect(provider.lookup(cdsReference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      hits: [{ providerRecordId: "cds-471", publicationDate: new Date("2025-01-16T00:00:00.000Z") }],
    });
  });

  it.each([
    ["court", { organo: "TAR Lazio Roma" }],
    ["year", { anno: 2024 }],
    ["decision type", { tipo_provvedimento: "Ordinanza" }],
    ["number", { numero: "202500472" }],
    ["section", { sezione: "IV" }],
  ])("rejects a provider row with mismatched %s", async (_label, mismatch) => {
    const provider = createOpenGaProvider({ transport: transport([row(mismatch)]) });
    await expect(provider.lookup(cdsReference)).resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
  });

  it.each([
    ["unsupported court", { ...cdsReference, authorityHint: "Corte dei conti" }],
    ["missing number", { ...cdsReference, actNumber: null }],
    ["missing year", { ...cdsReference, year: null }],
    ["unsupported decision type", { ...cdsReference, actType: "AVVISO" }],
  ])("does not route %s", (_label, reference) => {
    const provider = createOpenGaProvider({ transport: vi.fn() });
    expect(provider.supports(reference)).toBe(false);
    expect(provider.lookup(reference)).rejects.toMatchObject({ code: "UNSUPPORTED_REFERENCE", retryable: false });
  });

  it.each([
    ["malformed metadata", vi.fn(async () => json({ success: true, result: {} })), "INVALID_RESPONSE", false],
    ["malformed rows", transport([], packageMetadata()), "INVALID_RESPONSE", false],
    ["rate limit", vi.fn(async () => new Response(null, { status: 429 })), "RATE_LIMITED", true],
    ["provider outage", vi.fn(async () => new Response(null, { status: 503 })), "UPSTREAM_UNAVAILABLE", true],
    ["network error", vi.fn(async () => { throw new Error("offline"); }), "NETWORK_ERROR", true],
  ])("classifies %s", async (_label, request, code, retryable) => {
    if (_label === "malformed rows") {
      request.mockImplementationOnce(async () => packageMetadata()).mockImplementationOnce(async () => json({ wrong: [] }));
    }
    const provider = createOpenGaProvider({ transport: request });
    await expect(provider.lookup(cdsReference)).rejects.toMatchObject({ code, retryable });
  });

  it("enforces timeout and does not expose unexpected response bodies", async () => {
    const timeout = createOpenGaProvider({
      timeoutMs: 5,
      transport: vi.fn(async (_url, init) => new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    });
    await expect(timeout.lookup(cdsReference)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });

    const malformed = createOpenGaProvider({ transport: vi.fn(async () => json({ secret: "raw-body" })) });
    await expect(malformed.lookup(cdsReference)).rejects.toEqual(expect.any(OpenGaProviderError));
    await expect(malformed.lookup(cdsReference)).rejects.not.toThrow(/raw-body/);
  });

  it("caches dataset metadata but not decision rows", async () => {
    let now = 100;
    const request = transport([row()]);
    const provider = createOpenGaProvider({ transport: request, now: () => now, metadataTtlMs: 1_000 });
    await provider.lookup(cdsReference);
    now = 500;
    await provider.lookup(cdsReference);
    expect(request.mock.calls.filter(([url]) => String(url).includes("package_show"))).toHaveLength(1);
    expect(request.mock.calls.filter(([url]) => String(url).includes("datastore_search"))).toHaveLength(2);
  });
});