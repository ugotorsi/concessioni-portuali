import { describe, expect, it } from "vitest";

import {
  ACT_DRAFT_SCHEMA_VERSION,
  bodySha256,
  projectActDrafts,
  type ActDraft,
  type ActDraftStatus,
  type ActDraftVersion,
} from "@/server/fascicolo-acts/model";
import {
  ActivityWorkflowError,
  activityForKey,
  activityNeedsReview,
  activityProgress,
  applyActivityCommand,
  openActivityDependencies,
  projectActivities,
  stableActivityKey,
  type ActivityCommand,
  type ActivityCorpusState,
  type ActivityDocumentVersion,
  type ActivityRecord,
  type ActivitySpec,
  type ActivityVersion,
} from "@/server/fascicolo-operational-activities/model";

const procedure = "procedure-a";
const documentKey = "REPORT_PLAN:document-a";
const proposalNote = "Valutazione e motivazione del professionista.";
let requestNumber = 0;

function spec(code: string, issue = "issue-a", withDraft = false): ActivitySpec {
  return {
    activityKey: stableActivityKey(procedure, issue, code),
    issueSemanticKey: issue,
    issueText: `Problematica ${issue}`,
    activityCode: code,
    title: `Attività ${code}`,
    action: "Esaminare gli elementi documentali.",
    office: "Ufficio competente da verificare",
    requiredDocuments: ["Documento di riferimento"],
    completionGate: "Riscontro verificato",
    necessity: "REQUIRED",
    legalSummary: "Conclusione preliminare.",
    legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
    alternatives: [
      { title: "Archiviazione", whenApplicable: "Se motivata", practicalRoute: "Valutare", riskOrLimit: "Verificare" },
      { title: "Proseguimento", whenApplicable: "Se motivato", practicalRoute: "Istruire", riskOrLimit: "Verificare" },
    ],
    documents: withDraft ? [{ templateKey: documentKey, title: "Atto", legacyTemplateKeys: ["PLAN:Atto"] }] : [],
    fingerprint: code.charCodeAt(0).toString(16).padStart(2, "0").repeat(32),
  };
}

function draft(status: ActDraftStatus, currentVersion = 1): ActDraft {
  const versions: ActDraftVersion[] = Array.from({ length: currentVersion }, (_, index) => {
    const body = `Testo della versione ${index + 1}`;
    return {
      schema: ACT_DRAFT_SCHEMA_VERSION,
      procedimentoId: procedure,
      draftKey: "draft-a",
      version: index + 1,
      templateKey: documentKey,
      issueSemanticKey: "issue-a",
      title: "Atto",
      body,
      bodySha256: bodySha256(body),
      status,
      assignee: null,
      dueDate: null,
      progress: 0,
      dependencies: [],
      attachments: [],
      changeNote: null,
      savedAt: new Date("2026-11-01T12:00:00Z"),
      savedBy: "operator@example.test",
      auditHash: "a".repeat(64),
    };
  });
  return projectActDrafts(versions)[0];
}

function runCommand(input: {
  spec: ActivitySpec;
  specs?: readonly ActivitySpec[];
  current?: ActivityRecord;
  records?: readonly ActivityRecord[];
  command: ActivityCommand;
  drafts?: readonly ActDraft[];
  documentIds?: ReadonlySet<string>;
  documentVersions?: ReadonlyMap<string, ActivityDocumentVersion>;
  corpus?: ActivityCorpusState;
}): ActivityRecord {
  const metadata = applyActivityCommand({
    procedimentoId: procedure,
    spec: input.spec,
    specs: input.specs ?? [input.spec],
    current: input.current,
    records: input.records ?? (input.current ? [input.current] : []),
    drafts: input.drafts ?? [],
    documentIds: input.documentIds ?? new Set(["doc-a", "doc-b"]),
    documentVersions: input.documentVersions ?? new Map(["doc-a", "doc-b"].map((id) => [
      id, { documentId: id, fileVersionId: `version-${id}`, sha256: "a".repeat(64) },
    ])),
    corpus: input.corpus ?? { fingerprint: "c".repeat(64), analysisCurrent: true },
    command: input.command,
    requestId: `00000000-0000-4000-8000-${String(++requestNumber).padStart(12, "0")}`,
    requestFingerprint: "e".repeat(64),
    today: "2026-11-03",
    approvedProposalId: input.command.kind === "ADOPT_APPROVAL" ? input.command.proposalId : null,
  });
  const version: ActivityVersion = {
    ...metadata,
    savedAt: new Date("2026-11-03T10:00:00Z"),
    savedBy: "operator@example.test",
    auditHash: "f".repeat(64),
  };
  return { activityKey: metadata.activityKey, current: version, history: [version, ...(input.current?.history ?? [])] };
}

function complete(currentSpec: ActivitySpec, specs: readonly ActivitySpec[] = [currentSpec]): ActivityRecord {
  let current = runCommand({ spec: currentSpec, specs, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
  current = runCommand({ spec: currentSpec, specs, current, command: { kind: "TAKE_CHARGE", note: "Presa in carico." } });
  current = runCommand({
    spec: currentSpec, specs, current,
    command: { kind: "RECORD_EXECUTION", note: "Attività eseguita.", date: "2026-11-01", documentIds: ["doc-a"] },
  });
  current = runCommand({
    spec: currentSpec, specs, current,
    command: { kind: "RECORD_OUTCOME", note: "Riscontro documentato.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null },
  });
  return runCommand({ spec: currentSpec, specs, current, command: { kind: "VERIFY_COMPLETION", note: "Esito verificato.", confirmed: true } });
}

const configuration = {
  kind: "CONFIGURE" as const,
  note: "Configurazione motivata.",
  assignee: null,
  dueDate: null,
  dueDateReason: null,
  dueDateDocumentIds: [],
  dueDateVerified: false,
  dependencyKeys: [],
  sharedActivityKeys: [],
  attachedDocumentIds: [],
};

describe("audited operational activity state machine", () => {
  it("counts only necessary or started activities as pending; conditional ones stay optional", () => {
    const required = spec("REQ");
    const conditional = { ...spec("COND"), necessity: "CONDITIONAL" as const };
    const unjustified = { ...spec("NJ"), necessity: "NOT_JUSTIFIED" as const };
    const all = [required, conditional, unjustified];
    expect(activityProgress(all, [], all)).toMatchObject({ completed: 0, pending: 1, optional: 1, excluded: 0, percentage: 0 });
    const done = complete(required, all);
    expect(activityProgress(all, [done], all)).toMatchObject({ completed: 1, pending: 0, optional: 1, percentage: 100 });
    const started = runCommand({ spec: conditional, specs: all, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    expect(activityProgress(all, [done, started], all)).toMatchObject({ completed: 1, pending: 1, optional: 0, percentage: 50 });
  });

  it("uses a stable identity scoped to procedure, issue and activity", () => {
    expect(stableActivityKey(procedure, "issue-a", "A")).toBe(stableActivityKey(procedure, "issue-a", "A"));
    expect(new Set([
      stableActivityKey(procedure, "issue-a", "A"),
      stableActivityKey(procedure, "issue-b", "A"),
      stableActivityKey(procedure, "issue-a", "B"),
      stableActivityKey("procedure-b", "issue-a", "A"),
    ]).size).toBe(4);
  });

  it("requires approval, charge, current approved draft, execution evidence, outcome and verified completion", () => {
    const activity = spec("A", "issue-a", true);
    expect(() => runCommand({ spec: activity, command: { kind: "TAKE_CHARGE", note: proposalNote } }))
      .toThrow("Approvare o escludere");
    let current = runCommand({ spec: activity, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    current = runCommand({ spec: activity, current, command: { kind: "TAKE_CHARGE", note: "Presa in carico." } });
    current = runCommand({
      spec: activity, current, drafts: [draft("BOZZA")],
      command: { kind: "PREPARE_DRAFT", note: "Bozza predisposta.", templateKey: documentKey, draftKey: "draft-a", draftVersion: 1 },
    });
    expect(activityProgress([activity], [current]).percentage).toBe(0);
    expect(() => runCommand({
      spec: activity, current, drafts: [draft("BOZZA")],
      command: { kind: "VALIDATE_DRAFT", note: "Validazione proposta.", templateKey: documentKey, draftKey: "draft-a", draftVersion: 1 },
    })).toThrow("approvata internamente");
    current = runCommand({
      spec: activity, current, drafts: [draft("APPROVATA_INTERNAMENTE")],
      command: { kind: "VALIDATE_DRAFT", note: "Validazione della versione.", templateKey: documentKey, draftKey: "draft-a", draftVersion: 1 },
    });
    expect(() => runCommand({
      spec: activity, current, drafts: [draft("IN_REVISIONE", 2)],
      command: { kind: "RECORD_EXECUTION", note: "Invio registrato.", date: "2026-11-01", documentIds: ["doc-a"] },
    })).toThrow("modificata o non è più approvata");
    expect(() => runCommand({
      spec: activity, current, drafts: [draft("APPROVATA_INTERNAMENTE")],
      command: { kind: "RECORD_EXECUTION", note: "Invio registrato.", date: "2026-11-01", documentIds: ["foreign"] },
    })).toThrow("non appartengono al fascicolo");
    current = runCommand({
      spec: activity, current, drafts: [draft("APPROVATA_INTERNAMENTE")],
      command: { kind: "RECORD_EXECUTION", note: "Invio protocollato.", date: "2026-11-01", documentIds: ["doc-a"] },
    });
    expect(() => runCommand({ spec: activity, current, command: { kind: "VERIFY_COMPLETION", note: "Conclusa.", confirmed: true } }))
      .toThrow("Esecuzione e riscontro documentati");
    current = runCommand({
      spec: activity, current,
      command: { kind: "RECORD_OUTCOME", note: "Riscontro acquisito.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: "Archiviazione" },
    });
    current = runCommand({ spec: activity, current, command: { kind: "VERIFY_COMPLETION", note: "Esito verificato.", confirmed: true } });
    expect(current.current.status).toBe("COMPLETED");
    expect(current.history.map((version) => version.event)).toEqual([
      "VERIFY_COMPLETION", "RECORD_OUTCOME", "RECORD_EXECUTION", "VALIDATE_DRAFT",
      "PREPARE_DRAFT", "TAKE_CHARGE", "APPROVE",
    ]);
    expect(activityProgress([activity], [current])).toMatchObject({ completed: 1, pending: 0, percentage: 100 });
  });

  it("accepts only evidenced verified deadlines and real documents", () => {
    const activity = spec("A");
    const current = runCommand({ spec: activity, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    expect(() => runCommand({
      spec: activity, current,
      command: { ...configuration, dueDate: "2026-12-01", dueDateVerified: true },
    })).toThrow("termine richiede una verifica motivata");
    expect(() => runCommand({
      spec: activity, current,
      command: { ...configuration, dueDate: "2026-12-01", dueDateReason: "Termine nel documento", dueDateVerified: true, dueDateDocumentIds: ["foreign"] },
    })).toThrow("non appartengono al fascicolo");
    const configured = runCommand({
      spec: activity, current,
      command: { ...configuration, assignee: "Ufficio istruttoria", dueDate: "2026-12-01", dueDateReason: "Termine nel documento", dueDateVerified: true, dueDateDocumentIds: ["doc-a"], attachedDocumentIds: ["doc-b"] },
    });
    expect(configured.current).toMatchObject({
      assignee: "Ufficio istruttoria", dueDate: "2026-12-01", dueDateDocumentIds: ["doc-a"], attachedDocumentIds: ["doc-b"],
    });
    expect(() => runCommand({
      spec: activity, current,
      command: { ...configuration, dueDate: "2026-02-30", dueDateReason: "Documento", dueDateVerified: true, dueDateDocumentIds: ["doc-a"] },
    })).toThrow();
  });

  it("does not execute before dependencies and invalidates progress when a dependency becomes stale", () => {
    const first = spec("A");
    const second = spec("B");
    const specs = [first, second];
    let prerequisite = complete(first, specs);
    let dependent = runCommand({ spec: second, specs, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    dependent = runCommand({ spec: second, specs, current: dependent, records: [prerequisite, dependent], command: { ...configuration, dependencyKeys: [first.activityKey] } });
    dependent = runCommand({ spec: second, specs, current: dependent, records: [prerequisite, dependent], command: { kind: "TAKE_CHARGE", note: "Presa in carico." } });
    expect(openActivityDependencies(dependent, [prerequisite, dependent], specs)).toEqual([]);
    const changedSpecs = [{ ...first, fingerprint: "b".repeat(64) }, second];
    expect(activityNeedsReview(prerequisite, changedSpecs)).toBe(true);
    expect(openActivityDependencies(dependent, [prerequisite, dependent], changedSpecs)).toEqual([first.activityKey]);
    expect(() => runCommand({
      spec: second, specs: changedSpecs, current: dependent, records: [prerequisite, dependent],
      command: { kind: "RECORD_EXECUTION", note: "Esecuzione tentata.", date: "2026-11-01", documentIds: ["doc-a"] },
    })).toThrow("attività presupposte");
    prerequisite = runCommand({
      spec: changedSpecs[0], specs: changedSpecs, current: prerequisite, records: [prerequisite, dependent],
      command: { kind: "REOPEN", note: "Nuova valutazione necessaria.", confirmed: true },
    });
    expect(openActivityDependencies(dependent, [prerequisite, dependent], changedSpecs)).toEqual([first.activityKey]);
    prerequisite = runCommand({
      spec: changedSpecs[0], specs: changedSpecs, current: prerequisite, records: [prerequisite, dependent],
      command: { kind: "RECORD_EXECUTION", note: "Esecuzione riesaminata.", date: "2026-11-01", documentIds: ["doc-a"] },
    });
    prerequisite = runCommand({
      spec: changedSpecs[0], specs: changedSpecs, current: prerequisite, records: [prerequisite, dependent],
      command: { kind: "RECORD_OUTCOME", note: "Riscontro riesaminato.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null },
    });
    prerequisite = runCommand({
      spec: changedSpecs[0], specs: changedSpecs, current: prerequisite, records: [prerequisite, dependent],
      command: { kind: "VERIFY_COMPLETION", note: "Nuova verifica completata.", confirmed: true },
    });
    expect(openActivityDependencies(dependent, [prerequisite, dependent], changedSpecs)).toEqual([]);
  });

  it("rejects dependency cycles and conflicting shared histories", () => {
    const first = spec("A");
    const second = spec("B", "issue-b");
    const specs = [first, second];
    let a = runCommand({ spec: first, specs, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    let b = runCommand({ spec: second, specs, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    a = runCommand({ spec: first, specs, current: a, records: [a, b], command: { ...configuration, dependencyKeys: [second.activityKey] } });
    expect(() => runCommand({ spec: second, specs, current: b, records: [a, b], command: { ...configuration, dependencyKeys: [first.activityKey] } }))
      .toThrow("ciclo");
    expect(() => runCommand({ spec: first, specs, current: a, records: [a, b], command: { ...configuration, sharedActivityKeys: [second.activityKey] } }))
      .toThrow("propria cronologia");
    b = runCommand({ spec: second, specs, current: b, command: { kind: "EXCLUDE", note: "Iniziativa non pertinente.", confirmed: true } });
    expect(b.current.status).toBe("EXCLUDED");
  });

  it("tracks one explicitly shared completion in both issues without treating stale links as complete", () => {
    const first = spec("A", "issue-a");
    const second = spec("A", "issue-b");
    const specs = [first, second];
    let current = complete(first, specs);
    current = runCommand({
      spec: first, specs, current,
      command: { ...configuration, sharedActivityKeys: [second.activityKey], note: "Stesso lavoro verificato per entrambe le problematiche." },
    });
    expect(activityForKey([current], second.activityKey)?.activityKey).toBe(first.activityKey);
    expect(activityProgress([second], [current], specs).percentage).toBe(100);
    const changed = [first, { ...second, fingerprint: "d".repeat(64) }];
    expect(activityProgress([second], [current], changed).percentage).toBe(0);
    expect(() => projectActivities([...current.history, { ...current.current, activityKey: second.activityKey, issueSemanticKey: second.issueSemanticKey, activityCode: second.activityCode, version: 1 }]))
      .toThrow("più cronologie");
  });

  it("requires reopening and re-verifying a completion when the corpus or its legal specification changes", () => {
    const activity = spec("A");
    const done = complete(activity);
    const updatedCorpus = { fingerprint: "d".repeat(64), analysisCurrent: true };
    expect(activityNeedsReview(done, [activity], updatedCorpus)).toBe(true);
    expect(activityProgress([activity], [done], [activity], updatedCorpus).percentage).toBe(0);
    expect(() => runCommand({
      spec: activity, current: done, corpus: updatedCorpus,
      command: { kind: "RECONFIRM", note: "Conferma senza verifiche.", confirmed: true },
    })).toThrow("Riaprire l'attività");
    const changedSpec = { ...activity, fingerprint: "e".repeat(64) };
    expect(() => runCommand({
      spec: changedSpec, current: done,
      command: { kind: "RECONFIRM", note: "Conferma senza verifiche.", confirmed: true },
    })).toThrow("Riaprire l'attività");
    const reopened = runCommand({
      spec: activity, current: done, corpus: updatedCorpus,
      command: { kind: "REOPEN", note: "Riesame del nuovo fascicolo.", confirmed: true },
    });
    expect(reopened.current).toMatchObject({ status: "IN_PROGRESS", execution: null, outcome: null });
    expect(reopened.history.some((version) => version.status === "COMPLETED")).toBe(true);
    expect(activityProgress([activity], [reopened], [activity], updatedCorpus).percentage).toBe(0);
  });

  it("revisits an exclusion after corpus changes and permits a reasoned reconfirmation", () => {
    const activity = { ...spec("A"), necessity: "NOT_JUSTIFIED" as const };
    const excluded = runCommand({ spec: activity, command: { kind: "EXCLUDE", note: "Non pertinente.", confirmed: true } });
    const updatedCorpus = { fingerprint: "d".repeat(64), analysisCurrent: true };
    expect(activityNeedsReview(excluded, [activity], updatedCorpus)).toBe(true);
    expect(activityProgress([activity], [excluded], [activity], updatedCorpus).excluded).toBe(0);
    const reconfirmed = runCommand({
      spec: activity, current: excluded, corpus: updatedCorpus,
      command: { kind: "RECONFIRM", note: "Esclusione rivalutata sul fascicolo corrente.", confirmed: true },
    });
    expect(reconfirmed.current.exclusionCorpusFingerprint).toBe(updatedCorpus.fingerprint);
    expect(activityNeedsReview(reconfirmed, [activity], updatedCorpus)).toBe(false);
    expect(activityProgress([activity], [reconfirmed], [activity], updatedCorpus).excluded).toBe(1);
  });

  it("rejects future dates, unlisted alternatives and execution of unjustified initiatives", () => {
    const activity = spec("A");
    let current = runCommand({ spec: activity, command: { kind: "APPROVE", note: proposalNote, confirmed: true } });
    current = runCommand({ spec: activity, current, command: { kind: "TAKE_CHARGE", note: "Presa in carico." } });
    expect(() => runCommand({
      spec: activity, current,
      command: { kind: "RECORD_EXECUTION", note: "Esecuzione futura.", date: "2026-11-04", documentIds: ["doc-a"] },
    })).toThrow("non può essere futura");
    current = runCommand({
      spec: activity, current,
      command: { kind: "RECORD_EXECUTION", note: "Esecuzione svolta.", date: "2026-11-01", documentIds: ["doc-a"] },
    });
    expect(() => runCommand({
      spec: activity, current,
      command: { kind: "RECORD_OUTCOME", note: "Riscontro acquisito.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: "Alternativa inventata" },
    })).toThrow("non appartiene al percorso");
    expect(() => runCommand({
      spec: { ...activity, necessity: "NOT_JUSTIFIED" },
      command: { kind: "APPROVE", note: proposalNote, confirmed: true },
    })).toThrow(ActivityWorkflowError);
  });
});
