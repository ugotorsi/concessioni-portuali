import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  useState: vi.fn(),
  useRef: vi.fn(),
  setters: [] as ReturnType<typeof vi.fn>[],
}));
const uploadEvidence = vi.hoisted(() => vi.fn());
const uploadDocument = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/server/actions/documenti", () => ({ createDocumentoUploadAction: uploadDocument }));
vi.mock("@/server/actions/fascicolo-document-requirement-upload", () => ({
  uploadFascicoloDocumentRequirementEvidence: uploadEvidence,
}));

import { DirectDocumentUploadForm } from "@/components/documents/DirectDocumentUploadForm";

const nativeFormData = FormData;
const operationId = "11111111-1111-4111-8111-111111111111";
const nextOperationId = "22222222-2222-4222-8222-222222222222";

function formHarness(size = 100, purpose: "DOCUMENT" | "REQUIREMENT_EVIDENCE" = "REQUIREMENT_EVIDENCE") {
  const file = new File([new Uint8Array(size)], "atto.pdf", { type: "application/pdf" });
  vi.stubGlobal("FormData", class extends nativeFormData {
    constructor() {
      super();
      this.set("file", file);
      this.set("proposalId", "proposal-1");
      this.set("tipologia", "NOTA");
    }
  });
  const form = DirectDocumentUploadForm({ children: null, className: "", submitLabel: "Carica", purpose });
  const props = form.props as {
    onSubmit(event: { preventDefault(): void; currentTarget: { reset(): void } }): Promise<void>;
  };
  const reset = vi.fn();
  return { submit: () => props.onSubmit({ preventDefault: vi.fn(), currentTarget: { reset } }), reset, file };
}

describe("direct upload form requirement evidence behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hooks.setters.length = 0;
    hooks.useState.mockImplementation((initial: unknown) => {
      const setter = vi.fn();
      hooks.setters.push(setter);
      return [initial, setter];
    });
    hooks.useRef.mockImplementation((initial: unknown) => ({ current: initial }));
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValueOnce(operationId).mockReturnValue(nextOperationId),
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("UNEXPECTED_NETWORK"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the proposal-bound action, resets successful attempts and announces neutral success", async () => {
    const form = formHarness();
    await form.submit();
    await form.submit();
    expect(uploadEvidence).toHaveBeenNthCalledWith(1, {
      proposalId: "proposal-1", operationId, file: form.file, tipologia: "NOTA",
      nome: undefined, descrizione: undefined, dataDocumento: undefined,
    });
    expect(uploadEvidence.mock.calls[1][0].operationId).toBe(nextOperationId);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(form.reset).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(hooks.setters[2]).toHaveBeenCalledWith("Documento caricato e associato.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks simultaneous submissions and retains the operation ID only for a failed attempt", async () => {
    let rejectUpload: (reason: Error) => void = () => { throw new Error("MISSING_UPLOAD"); };
    uploadEvidence.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectUpload = reject; }));
    const form = formHarness();
    const first = form.submit();
    await form.submit();
    expect(uploadEvidence).toHaveBeenCalledTimes(1);
    rejectUpload(new Error("synthetic internal storage detail"));
    await first;
    expect(form.reset).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(hooks.setters[3]).toHaveBeenLastCalledWith("Caricamento non completato. Verificare i dati e riprovare.");
    await form.submit();
    expect(uploadEvidence.mock.calls[1][0].operationId).toBe(operationId);
    await form.submit();
    expect(uploadEvidence.mock.calls[2][0].operationId).toBe(nextOperationId);
  });

  it("completes large proposal uploads using only mocked transport and refreshes authoritative data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ objectKey: "synthetic-key", uploadUrl: "https://storage.example.test", headers: {} }))
      .mockResolvedValueOnce(Response.json({ procedimentoId: null }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      status = 200;
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() { queueMicrotask(() => this.onload?.()); }
    });
    const form = formHarness(512 * 1024 + 1);
    await form.submit();
    const initiated = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(initiated).toMatchObject({
      purpose: "REQUIREMENT_EVIDENCE", operationId,
      metadata: { proposalId: "proposal-1", tipologia: "NOTA" },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/document-uploads/direct/complete");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ ...initiated, objectKey: "synthetic-key" });
    expect(uploadEvidence).not.toHaveBeenCalled();
    expect(form.reset).toHaveBeenCalledOnce();
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(hooks.setters[2]).toHaveBeenLastCalledWith("Documento caricato e associato.");
  });

  it("does not expose direct-upload server errors or report success on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "R2 synthetic bucket detail" }, { status: 500 })));
    const form = formHarness(512 * 1024 + 1);
    await form.submit();
    expect(hooks.setters[3]).toHaveBeenLastCalledWith("Caricamento non completato. Verificare i dati e riprovare.");
    expect(form.reset).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("preserves the small general-document upload path", async () => {
    const form = formHarness(100, "DOCUMENT");
    await form.submit();
    expect(uploadDocument).toHaveBeenCalledOnce();
    expect(uploadEvidence).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
