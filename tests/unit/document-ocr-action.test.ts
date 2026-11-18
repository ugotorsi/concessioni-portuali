import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const ensureAuthorizedDocumentOcrExtractionJobMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  requireRole: requireRoleMock,
}));
vi.mock("@/server/documents/documentOcrJobAdmission", () => ({
  ensureAuthorizedDocumentOcrExtractionJob: ensureAuthorizedDocumentOcrExtractionJobMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { startDocumentoOcrAction } from "@/server/actions/document-ocr";
import { DocumentOcrAuthorizationError } from "@/server/documents/documentOcrAuthorization";

function formData(attemptId = "attempt-ocr-required") {
  const data = new FormData();
  data.set("failedAttemptId", attemptId);
  return data;
}

describe("startDocumentoOcrAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("TECNICO");
    ensureAuthorizedDocumentOcrExtractionJobMock.mockResolvedValue({
      id: "job-ocr",
      status: "QUEUED",
    });
  });

  it("requires an ADMIN or TECNICO session and delegates to the idempotent admission path", async () => {
    await expect(startDocumentoOcrAction(formData())).rejects.toThrow(
      "REDIRECT:/documenti?ocr=queued",
    );
    expect(requireRoleMock).toHaveBeenCalledWith(["ADMIN", "TECNICO"]);
    expect(ensureAuthorizedDocumentOcrExtractionJobMock).toHaveBeenCalledOnce();
    expect(ensureAuthorizedDocumentOcrExtractionJobMock).toHaveBeenCalledWith(
      "attempt-ocr-required",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/documenti");
  });

  it("does not admit a job when the request is invalid", async () => {
    await expect(startDocumentoOcrAction(formData(""))).rejects.toThrow(
      "REDIRECT:/documenti?ocr=error",
    );
    expect(ensureAuthorizedDocumentOcrExtractionJobMock).not.toHaveBeenCalled();
  });

  it("returns a controlled tenant authorization error without admitting another path", async () => {
    ensureAuthorizedDocumentOcrExtractionJobMock.mockRejectedValue(
      new DocumentOcrAuthorizationError("TENANT_ACCESS_DENIED"),
    );
    await expect(startDocumentoOcrAction(formData())).rejects.toThrow(
      /REDIRECT:\/documenti\?ocr=error&ocrMessage=/,
    );
    expect(ensureAuthorizedDocumentOcrExtractionJobMock).toHaveBeenCalledOnce();
  });
});
