import { describe, expect, it } from "vitest";

import { parseUploadDocumentFormData, validateUploadFile } from "@/server/documents/validation";

describe("documenti validation", () => {
  it("accepts valid upload payload with linked concessione", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("concessioneId", "concessione-1");
    formData.set("descrizione", "Nota istruttoria");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    const parsed = parseUploadDocumentFormData(formData);

    expect(parsed.tipologia).toBe("NOTA");
    expect(parsed.concessioneId).toBe("concessione-1");
    expect(parsed.nome).toBe("nota.txt");
  });

  it("rejects payload without linked entities", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    expect(() => parseUploadDocumentFormData(formData)).toThrow(/almeno una entita/i);
  });

  it("rejects unsupported mime types", () => {
    const file = new File(["bad"], "malware.exe", { type: "application/x-msdownload" });

    expect(() => validateUploadFile(file)).toThrow(/Formato file non consentito/i);
  });
});
