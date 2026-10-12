import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/procedimenti/FascicoloAutomaticWorkflowPanel.tsx", "utf8");

describe("Lotto 7 operational proposal UI", () => {
  it("states that proposals require approval and keeps origins, codes and history available", () => {
    for (const label of [
      "Proposte operative",
      "Le proposte richiedono approvazione prima di produrre effetti.",
      "Dettagli tecnici",
      "Origini:",
      "Codici:",
      "Storico review",
      "Entità creata:",
      "Azione manuale richiesta",
    ]) expect(source).toContain(label);
  });

  it("keeps generation, review and materialization wired to separate server actions", () => {
    expect(source).toContain("action={generateOperationalProposalsAction}");
    expect(source).toContain("action={reviewOperationalProposalAction}");
    expect(source).toContain("action={materializeOperationalProposalAction}");
    for (const command of ["Genera proposte operative", "Approva", "Rifiuta", "Modifica e approva", "Materializza"]) {
      expect(source).toContain(command);
    }
  });

  it("shows materialization only for approved non-manual proposals", () => {
    expect(source).toContain('proposal.status === "APPROVED" || proposal.status === "AMENDED_AND_APPROVED"');
    expect(source).toContain('!proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED")');
    expect(source).toContain('proposal.status === "PROPOSED"');
  });
});