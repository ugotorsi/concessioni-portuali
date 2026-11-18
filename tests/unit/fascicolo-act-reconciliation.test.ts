import { describe, expect, it } from "vitest";

import { bodySha256, stableActDraftKey, type ActDraft, type ActDraftVersion } from "@/server/fascicolo-acts/model";
import { actDraftRecipient, groupActDraftsForReview } from "@/server/fascicolo-acts/reconciliation";

function draft(draftKey: string, body: string, overrides: Partial<ActDraftVersion> = {}): ActDraft {
  const current: ActDraftVersion = {
    schema: "FASCICOLO_ACT_DRAFT_V1",
    procedimentoId: "p1",
    draftKey,
    version: 1,
    bodySha256: bodySha256(body),
    templateKey: "CONTESTAZIONE_ADDEBITI",
    issueSemanticKey: "issue-m4",
    title: "Contestazione degli addebiti",
    body,
    status: "BOZZA",
    assignee: null,
    dueDate: null,
    progress: 10,
    dependencies: [],
    attachments: [],
    changeNote: null,
    savedAt: new Date("2026-11-03T10:00:00.000Z"),
    savedBy: "user",
    auditHash: "h",
    ...overrides,
  } as ActDraftVersion;
  return { draftKey, current, history: [current], openDependencies: [] };
}

describe("act draft reconciliation simulation", () => {
  it("flags historical duplicates without changing any draft and prefers the linked, more advanced one", () => {
    const text = "Destinatario: Selvara Terminal S.r.l.\nOggetto: contestazione relativa al magazzino M4.";
    const drafts = [
      draft("act_random_1", text),
      draft("act_random_2", text, { version: 2, savedAt: new Date("2026-11-03T11:00:00.000Z") }),
      draft("act_random_3", `${text}\nIntegrazione.`),
      draft("act_random_4", text),
      draft("act_random_5", text),
      draft(stableActDraftKey("NOTA_VERIFICA", "issue-m4"), "Nota", { templateKey: "NOTA_VERIFICA", title: "Nota di verifica" }),
    ];
    const snapshot = JSON.stringify(drafts);
    const groups = groupActDraftsForReview(drafts, new Set(["act_random_4"]));

    expect(JSON.stringify(drafts)).toBe(snapshot);
    expect(groups).toHaveLength(2);
    const duplicates = groups.find((group) => group.templateKey === "CONTESTAZIONE_ADDEBITI")!;
    expect(duplicates.duplicated).toBe(true);
    expect(duplicates.distinctContents).toBe(2);
    expect(duplicates.members[0]).toMatchObject({ draftKey: "act_random_4", reconciliation: "KEEP_AS_REFERENCE", linkedToActivity: true });
    expect(duplicates.members.filter((member) => member.reconciliation === "IDENTICAL_DUPLICATE")).toHaveLength(3);
    expect(duplicates.members.find((member) => member.draftKey === "act_random_3")?.reconciliation).toBe("DIVERGENT_CONTENT");
    expect(duplicates.members.every((member) => member.recipient === "Selvara Terminal S.r.l")).toBe(true);
    expect(duplicates.reconciliationNote).toContain("Nessuna bozza, versione o evento di audit viene eliminato");

    const distinctActivity = groups.find((group) => group.templateKey === "NOTA_VERIFICA")!;
    expect(distinctActivity.duplicated).toBe(false);
    expect(distinctActivity.members[0]?.stableIdentity).toBe(true);
  });

  it("does not invent recipients from placeholders or missing indications", () => {
    expect(actDraftRecipient("Destinatario: [DESTINATARIO DA VERIFICARE]\nTesto")).toBeNull();
    expect(actDraftRecipient("Oggetto: verifica")).toBeNull();
  });
});
