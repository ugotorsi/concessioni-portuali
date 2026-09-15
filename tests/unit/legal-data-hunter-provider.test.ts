import { describe, expect, it, vi } from "vitest";

import {
  createLegalDataHunterProvider,
  LEGAL_DATA_HUNTER_BASE_URL,
  LegalDataHunterProviderError,
  MAX_LEGAL_DATA_HUNTER_RESULTS,
} from "@/server/intake/official-source-lookup/legalDataHunter";

const reference = {
  kind: "CASE_LAW",
  authorityHint: "CASSAZIONE CIVILE",
  actType: null,
  actNumber: "1234",
  year: 2024,
  chamberSection: "III",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function discovery(courtName: string | null = "Corte Suprema di Cassazione") {
  return json({ country: "IT", sources: [{
    source_id: "IT/Cassazione",
    data_types: ["case_law"],
    court_name: courtName,
    document_count: 100,
  }] });
}

function hit(overrides: Record<string, unknown> = {}) {
  return {
    source: "IT/Cassazione",
    source_id: "decision-1234-2024",
    court: "Corte Suprema di Cassazione",
    authority: "Cassazione civile",
    decision_number: "1234",
    date: "2024-03-15",
    chamber: "III",
    decision_type: "SENTENZA",
    title: "Cassazione civile, sezione III, n. 1234/2024",
    url: "https://www.cortedicassazione.it/decision-1234-2024",
    ...overrides,
  };
}

function sequencedTransport(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  });
}

describe("B2C13 Block 3B.6D Legal Data Hunter provider", () => {
  it.each([
    ["CASSAZIONE", "1"],
    ["CASSAZIONE CIVILE", "1"],
    ["CASSAZIONE PENALE", "1"],
    ["CONSIGLIO DI STATO", "1"],
    ["CORTE COSTITUZIONALE", "1"],
    ["TAR LAZIO ROMA", "1"],
  ])("supports the structured Italian authority %s", (authorityHint, actNumber) => {
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport: vi.fn() });
    expect(provider.supports({ ...reference, authorityHint, actNumber })).toBe(true);
  });

  it("is disabled without the server-side deployment key", async () => {
    const transport = vi.fn();
    const provider = createLegalDataHunterProvider({ apiKey: null, transport });
    expect(provider.supports(reference)).toBe(false);
    await expect(provider.lookup(reference)).rejects.toMatchObject({ code: "DISABLED", retryable: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends only structured identity to fixed discovery and resolve endpoints", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ reference: "structured", resolved: true, match_type: "exact", documents: [hit()] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "test-key", transport });
    await expect(provider.lookup(reference)).resolves.toMatchObject({ status: "FOUND_UNIQUE", resultCount: 1 });

    expect(transport).toHaveBeenCalledTimes(2);
    const [discoveryUrl, discoveryInit] = transport.mock.calls[0];
    expect(discoveryUrl).toBe(`${LEGAL_DATA_HUNTER_BASE_URL}/v1/discover/countries/IT/sources`);
    expect(discoveryInit).toMatchObject({ method: "GET", redirect: "error" });
    expect(discoveryInit?.headers).toMatchObject({ Authorization: "Bearer test-key" });

    const [resolveUrl, resolveInit] = transport.mock.calls[1];
    expect(resolveUrl).toBe(`${LEGAL_DATA_HUNTER_BASE_URL}/v1/resolve`);
    const body = JSON.parse(String(resolveInit?.body));
    expect(body).toEqual({
      reference: "CASSAZIONE CIVILE, sez. III, n. 1234/2024",
      hint_country: "IT",
      hint_type: "case_law",
    });
    expect(String(resolveInit?.body)).not.toMatch(/observedText|documentId|intakeId|mentionId|snippet|full_text/i);
  });

  it("caches runtime source discovery within the configured TTL", async () => {
    let now = 100;
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [hit()] }),
      json({ match_type: "exact", documents: [hit()] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport, now: () => now, discoveryTtlMs: 1_000 });
    await provider.lookup(reference);
    now = 500;
    await provider.lookup(reference);
    expect(transport.mock.calls.filter(([url]) => String(url).includes("/discover/"))).toHaveLength(1);
  });

  it("deterministically collapses identical payloads for the same provider identity", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [hit(), hit()] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(reference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{ providerRecordId: "decision-1234-2024" }],
    });
  });

  it("fails closed when one provider identity carries conflicting decision numbers", async () => {
    const requested = { ...reference, actNumber: "9414", year: 2025 };
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [
        hit({ source_id: "same-record", decision_number: "9414", date: "2025-01-01" }),
        hit({ source_id: "same-record", decision_number: "9168", date: "2025-01-01" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(requested)).rejects.toMatchObject({
      code: "PROVIDER_IDENTITY_CONFLICT",
      retryable: false,
    });
  });

  it("fails closed when one provider identity carries conflicting populated chambers", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [
        hit({ source_id: "same-record", chamber: "III" }),
        hit({ source_id: "same-record", chamber: "IV" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(reference)).rejects.toMatchObject({
      code: "PROVIDER_IDENTITY_CONFLICT",
      retryable: false,
    });
  });

  it("fails closed when one TAR provider identity carries conflicting localities", async () => {
    const tarReference = { ...reference, authorityHint: "TAR LAZIO ROMA" };
    const transport = sequencedTransport([
      discovery("TAR Lazio Roma"),
      json({ match_type: "exact", documents: [
        hit({ source_id: "same-record", authority: "TAR LAZIO ROMA", court: "TAR LAZIO ROMA" }),
        hit({ source_id: "same-record", authority: "TAR LOMBARDIA MILANO", court: "TAR LOMBARDIA MILANO" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(tarReference)).rejects.toMatchObject({
      code: "PROVIDER_IDENTITY_CONFLICT",
      retryable: false,
    });
  });

  it("deterministically collapses equivalent TAR locality spellings for one provider identity", async () => {
    const tarReference = { ...reference, authorityHint: "TAR LAZIO ROMA" };
    const transport = sequencedTransport([
      discovery("TAR Lazio Roma"),
      json({ match_type: "exact", documents: [
        hit({ source_id: "same-record", authority: "tar lazio roma", court: "TAR Lazio Roma" }),
        hit({ source_id: "same-record", authority: "TAR  LAZIO   ROMA", court: "tar lazio roma" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(tarReference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{ providerRecordId: "same-record" }],
    });
  });

  it("filters a nonmatching TAR locality normally when provider identities differ", async () => {
    const tarReference = { ...reference, authorityHint: "TAR LAZIO ROMA" };
    const transport = sequencedTransport([
      discovery("TAR Lazio Roma"),
      json({ match_type: "exact", documents: [
        hit({ source_id: "tar-lazio", authority: "TAR LAZIO ROMA", court: "TAR LAZIO ROMA" }),
        hit({ source_id: "tar-lombardia", authority: "TAR LOMBARDIA MILANO", court: "TAR LOMBARDIA MILANO" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(tarReference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{ providerRecordId: "tar-lazio" }],
    });
  });

  it("does not treat a missing TAR locality as an identity conflict", async () => {
    const tarReference = { ...reference, authorityHint: "TAR LAZIO ROMA" };
    const transport = sequencedTransport([
      discovery("TAR Lazio Roma"),
      json({ match_type: "exact", documents: [
        hit({ source_id: "same-record", authority: "TAR", court: "TAR" }),
        hit({ source_id: "same-record", authority: "TAR LAZIO ROMA", court: "TAR LAZIO ROMA" }),
      ] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(tarReference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      resultCount: 1,
      hits: [{ providerRecordId: "same-record" }],
    });
  });

  it("classifies matching records with different provider identities as ambiguous", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "ambiguous", documents: [hit(), hit({ source_id: "decision-other" })] }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(reference)).resolves.toMatchObject({ status: "AMBIGUOUS", resultCount: 2 });
  });

  it("uses exactly one bounded keyword-heavy search fallback and verifies identity locally", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ resolved: false, match_type: "none", documents: [] }),
      json({ query: "structured", hits: [
        hit({ source_id: "wrong-number", decision_number: "9999", score: 1 }),
        hit({ source_id: "exact", score: 0.01 }),
      ], total_hits: 2, alpha: 0, namespace: "case_law", elapsed_ms: 2 }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(reference)).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      hits: [{ providerRecordId: "exact", decisionNumber: "1234", decisionYear: 2024 }],
    });
    const [url, init] = transport.mock.calls[2];
    expect(url).toBe(`${LEGAL_DATA_HUNTER_BASE_URL}/v1/search`);
    expect(JSON.parse(String(init?.body))).toEqual({
      q: "CASSAZIONE CIVILE, sez. III, n. 1234/2024",
      namespace: "case_law",
      country: ["IT"],
      source: ["IT/Cassazione"],
      date_start: "2024-01-01",
      date_end: "2024-12-31",
      top_k: MAX_LEGAL_DATA_HUNTER_RESULTS,
      alpha: 0,
      result_detail: "snippet",
    });
  });

  it("rejects a criminal Cassation hit for a civil Cassation reference", async () => {
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [hit({ authority: "Cassazione penale" })] }),
      json({ hits: [], query: "structured", total_hits: 0, alpha: 0, namespace: "case_law", elapsed_ms: 1 }),
    ]);
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport });
    await expect(provider.lookup(reference)).resolves.toEqual({ status: "NOT_FOUND", resultCount: 0, hits: [] });
  });

  it("does not turn an unsupported discovered court into NOT_FOUND", async () => {
    const provider = createLegalDataHunterProvider({
      apiKey: "key",
      transport: async () => discovery("Tribunale di Milano"),
    });
    await expect(provider.lookup(reference)).rejects.toMatchObject({ code: "UNSUPPORTED_AUTHORITY", retryable: false });
  });

  it("rejects malformed and overflowing payloads without exposing raw bodies", async () => {
    const malformed = createLegalDataHunterProvider({
      apiKey: "key",
      transport: sequencedTransport([discovery(), json({ secret: "raw-secret" })]),
    });
    await expect(malformed.lookup(reference)).rejects.toEqual(expect.any(LegalDataHunterProviderError));
    await expect(malformed.lookup(reference)).rejects.not.toThrow(/raw-secret/);

    const overflow = createLegalDataHunterProvider({
      apiKey: "key",
      transport: sequencedTransport([
        discovery(),
        json({ match_type: "ambiguous", documents: Array.from({ length: MAX_LEGAL_DATA_HUNTER_RESULTS + 1 }, (_, index) => hit({ source_id: `id-${index}` })) }),
      ]),
    });
    await expect(overflow.lookup(reference)).rejects.toMatchObject({ code: "RESULT_LIMIT_EXCEEDED", retryable: false });
  });

  it.each([
    [401, "AUTHENTICATION_FAILED", false],
    [429, "RATE_LIMITED", true],
    [503, "UPSTREAM_UNAVAILABLE", true],
  ])("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = createLegalDataHunterProvider({ apiKey: "key", transport: async () => new Response(null, { status }) });
    await expect(provider.lookup(reference)).rejects.toMatchObject({ code, retryable });
  });

  it("bounds timeout, response size, and redirects", async () => {
    const timeout = createLegalDataHunterProvider({
      apiKey: "key",
      timeoutMs: 5,
      transport: async (_url, init) => new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(timeout.lookup(reference)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });

    const oversized = createLegalDataHunterProvider({ apiKey: "key", maxResponseBytes: 10, transport: async () => discovery() });
    await expect(oversized.lookup(reference)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", retryable: false });
  });
});
