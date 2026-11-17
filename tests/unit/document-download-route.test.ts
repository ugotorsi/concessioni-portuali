import { beforeEach, describe, expect, it, vi } from "vitest";

const readAuthorizedVerifiedDocumentBytesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/documents/authorizedVerifiedByteReader", async () => {
  const actual = await vi.importActual<typeof import("@/server/documents/authorizedVerifiedByteReader")>(
    "@/server/documents/authorizedVerifiedByteReader",
  );

  return {
    ...actual,
    readAuthorizedVerifiedDocumentBytes: readAuthorizedVerifiedDocumentBytesMock,
  };
});

import { GET } from "@/app/documenti/[id]/download/route";
import {
  DocumentReadAuditError,
  DocumentReadAuthorizationError,
  DocumentReadIntegrityError,
} from "@/server/documents/authorizedVerifiedByteReader";

function makeRequest(query = ""): Request {
  return new Request(`https://example.test/documenti/document-123/download${query}`);
}

function makeContext(id = "document-123") {
  return { params: Promise.resolve({ id }) };
}

function availableResult(overrides?: { mimeType?: string; fileName?: string }) {
  return {
    status: "AVAILABLE_VERIFIED" as const,
    body: Buffer.from([0, 1, 2, 255]),
    mimeType: overrides?.mimeType ?? "application/pdf",
    fileName: overrides?.fileName ?? "documento.pdf",
    sizeBytes: 4,
    sha256: "a".repeat(64),
  };
}

describe("GET /documenti/[id]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns verified bytes and reader-owned metadata as an attachment", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(availableResult());

    const response = await GET(makeRequest(), makeContext());

    expect(readAuthorizedVerifiedDocumentBytesMock).toHaveBeenCalledTimes(1);
    expect(readAuthorizedVerifiedDocumentBytesMock).toHaveBeenCalledWith({ documentoId: "document-123" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="documento.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it("escapes double quotes in the quoted filename", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(
      availableResult({ fileName: 'contratto "finale".pdf' }),
    );

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="contratto \\"finale\\".pdf"',
    );
    expect(readAuthorizedVerifiedDocumentBytesMock).toHaveBeenCalledTimes(1);
  });

  it("escapes backslashes in the quoted filename", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(
      availableResult({ fileName: "cartella\\documento.pdf" }),
    );

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="cartella\\\\documento.pdf"',
    );
  });

  it("neutralizes CR/LF in the filename without changing verified bytes", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(
      availableResult({ fileName: "contratto\r\nfinale.pdf" }),
    );

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="contratto__finale.pdf"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it.each([
    ["application/pdf", "preview.pdf"],
    ["image/png", "preview.png"],
  ])("serves previewable %s content inline when requested", async (mimeType, fileName) => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(availableResult({ mimeType, fileName }));

    const response = await GET(makeRequest("?preview=1"), makeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(`inline; filename="${fileName}"`);
  });

  it("keeps non-previewable content as an attachment when preview is requested", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue(
      availableResult({ mimeType: "text/plain", fileName: "note.txt" }),
    );

    const response = await GET(makeRequest("?preview=1"), makeContext());

    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="note.txt"');
  });

  it.each([
    ["NO_FILE_VERSION", 404, "File non disponibile"],
    ["SOURCE_MISSING", 404, "File non disponibile"],
    ["LEGACY_UNVERIFIED", 409, "Documento non disponibile in formato verificato"],
    ["SOURCE_UNAVAILABLE", 503, "Servizio documento non disponibile"],
  ] as const)("maps %s to HTTP %i", async (status, expectedStatus, expectedBody) => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValue({ status });

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(expectedStatus);
    expect(await response.text()).toBe(expectedBody);
    expect(readAuthorizedVerifiedDocumentBytesMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["UNAUTHENTICATED", 401, "Unauthorized"],
    ["FORBIDDEN", 403, "Forbidden"],
    ["NOT_FOUND_NON_OBSERVABLE", 404, "File non disponibile"],
  ] as const)("maps authorization error %s to HTTP %i", async (code, expectedStatus, expectedBody) => {
    readAuthorizedVerifiedDocumentBytesMock.mockRejectedValue(new DocumentReadAuthorizationError(code));

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(expectedStatus);
    expect(await response.text()).toBe(expectedBody);
  });

  it.each([
    [new DocumentReadIntegrityError("INVALID_MANIFEST"), "integrity-secret"],
    [new DocumentReadAuditError(new Error("audit-secret")), "audit-secret"],
    [new Error("unknown-secret"), "unknown-secret"],
  ])("maps internal failures to a generic 500 response", async (error, sensitiveText) => {
    readAuthorizedVerifiedDocumentBytesMock.mockRejectedValue(error);

    const response = await GET(makeRequest(), makeContext());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe("Errore download documento");
    expect(body).not.toContain(sensitiveText);
  });

  it("does not distinguish a missing version from a non-observable document", async () => {
    readAuthorizedVerifiedDocumentBytesMock.mockResolvedValueOnce({ status: "NO_FILE_VERSION" });
    const missingVersionResponse = await GET(makeRequest(), makeContext());
    const missingVersionBody = await missingVersionResponse.text();

    readAuthorizedVerifiedDocumentBytesMock.mockRejectedValueOnce(
      new DocumentReadAuthorizationError("NOT_FOUND_NON_OBSERVABLE"),
    );
    const nonObservableResponse = await GET(makeRequest(), makeContext());
    const nonObservableBody = await nonObservableResponse.text();

    expect(nonObservableResponse.status).toBe(missingVersionResponse.status);
    expect(nonObservableBody).toBe(missingVersionBody);
  });
});
