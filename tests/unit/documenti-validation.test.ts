import { describe, expect, it } from "vitest";

import { parseUploadDocumentFormData, validateUploadFile } from "@/server/documents/validation";

describe("documenti validation", () => {
  it("accepts valid upload payload with linked concessione", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("source", "UPLOAD_UTENTE");
    formData.set("status", "ATTIVO");
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
    formData.set("source", "UPLOAD_UTENTE");
    formData.set("status", "ATTIVO");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    expect(() => parseUploadDocumentFormData(formData)).toThrow(/almeno una entita/i);
  });

  it("rejects unsupported mime types", () => {
    const file = new File(["bad"], "malware.exe", { type: "application/x-msdownload" });

    expect(() => validateUploadFile(file)).toThrow(/Formato file non consentito/i);
  });

  it("accepts protocollo and PEC metadata baseline", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("source", "PEC_METADATA");
    formData.set("status", "ATTIVO");
    formData.set("concessioneId", "concessione-1");
    formData.set("canale", "PEC");
    formData.set("direzione", "ENTRATA");
    formData.set("numeroProtocollo", " pg/2026/123 ");
    formData.set("dataProtocollo", "2026-02-02");
    formData.set("pecMessageId", "<abc@pec.demo>");
    formData.set("pecRicevutaAccettazioneId", "ACC-001");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    const parsed = parseUploadDocumentFormData(formData);

    expect(parsed.numeroProtocollo).toBe("PG/2026/123");
    expect(parsed.canale).toBe("PEC");
    expect(parsed.pecWarningMancataRicevuta).toBe(true);
  });

  it("rejects protocol number without protocol date", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("source", "UPLOAD_UTENTE");
    formData.set("status", "ATTIVO");
    formData.set("concessioneId", "concessione-1");
    formData.set("numeroProtocollo", "PG/2026/999");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    expect(() => parseUploadDocumentFormData(formData)).toThrow(/Numero e data protocollo/i);
  });

  it("rejects payload without mandatory source", () => {
    const formData = new FormData();
    formData.set("tipologia", "NOTA");
    formData.set("status", "ATTIVO");
    formData.set("concessioneId", "concessione-1");
    formData.set("file", new File(["contenuto"], "nota.txt", { type: "text/plain" }));

    expect(() => parseUploadDocumentFormData(formData)).toThrow(/Fonte documento obbligatoria/i);
  });
});
