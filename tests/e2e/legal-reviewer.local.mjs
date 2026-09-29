import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceRoot = process.env.REVIEWER_TEST_OUTPUT;
assert(evidenceRoot && path.isAbsolute(evidenceRoot) && path.relative(root, evidenceRoot).startsWith(`..${path.sep}`),
  "REVIEWER_TEST_OUTPUT must be an absolute directory outside the checkout");
const output = path.join(evidenceRoot, new Date().toISOString().replaceAll(/[:.]/g, "-"));
const through = Number(process.argv.find(argument => argument.startsWith("--through="))?.split("=")[1] ?? Infinity);
await mkdir(output, { recursive: true });
console.log(`Evidence: ${output}`);
const origin = "http://127.0.0.1:41783";
const apiPath = "/api/legal-research/assisted-verification";
const now = "2026-09-27T10:00:00.000Z";
const events = [];
const failures = [];
const results = [];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const options = { absWorkingDir: root, bundle: true, write: false, logLevel: "silent", metafile: true };
const coreBundle = await build({ ...options, platform: "node", format: "esm", packages: "external",
  stdin: { contents: `export * from "./src/server/legal-research/assisted-verification";
    export * from "./src/server/legal-research/adverse-search";
    export { createResearchMission, RESEARCH_BRIDGE_VERSION } from "./src/server/legal-research/bridge";`,
  resolveDir: root, loader: "ts" } });
for (const input of Object.keys(coreBundle.metafile.inputs)) {
  assert(!/prisma|persistence|provider|tenant-auth|dotenv/i.test(input), `Forbidden dependency: ${input}`);
}
const corePath = path.join(output, "pure-contracts.mjs");
await writeFile(corePath, coreBundle.outputFiles[0].text.replace(/from "zod"/g,
  `from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/zod/index.js")).href)}`));
const core = await import(pathToFileURL(corePath).href);
const mission = core.createResearchMission({
  kind: "RESEARCH_MISSION", version: core.RESEARCH_BRIDGE_VERSION,
  caseReference: { caseId: "synthetic-browser-case" }, legalIssueIds: ["synthetic-issue"],
  legalPropositionIds: ["synthetic-proposition"], referenceDate: "2026-09-26T00:00:00.000Z",
  mode: "ADVERSE_SEARCH", researchQuestion: "Synthetic browser test only, no real legal research.",
  knownAuthorities: [], excludedAuthorities: [], preferredSourceFamilies: ["CJEU"],
  missingSourceFamilies: [], knownCounterArguments: [], knownEvidenceGaps: [],
  requiredOutput: { authorityCandidates: true, citationObservations: true,
    legalResearchSuggestions: true, evidenceGaps: true, fullTextRequired: true },
  budget: { maxTotalResearchCalls: 3, maxMoonlitCalls: 1, maxSimpliciterCalls: 1, maxLegalDataHunterCalls: 1 },
  status: "PENDING", executionPlan: { requiredCapabilities: ["FULL_TEXT_RETRIEVAL", "CITATION_NETWORK", "ADVERSE_AUTHORITY_DISCOVERY"] },
});
const missionFingerprint = sha256(JSON.stringify(mission));
const documents = new Map([
  ["synthetic-file-v1", Buffer.from("SYNTHETIC DOCUMENT V1. Browser fixture only. Not legal evidence.")],
  ["synthetic-file-v2", Buffer.from("SYNTHETIC DOCUMENT V2. Changed fixture only. Not legal evidence.")],
]);
for (const [name, bytes] of documents) await writeFile(path.join(output, `${name}.txt`), bytes);
const sourceDraft = version => ({
  evidenceSourceId: "synthetic-evidence", authorityId: "synthetic-authority",
  legalSourceId: "synthetic-legal-source", legalExpressionVersionId: `synthetic-expression-${version}`,
  officialIdentifier: "SYNTHETIC-CJEU-001", sourceUrl: "https://synthetic.invalid/document",
  sourceFamily: "CJEU", courtOrBody: "Synthetic court - not a real authority", documentType: "Synthetic fixture",
  contentSha256: sha256(documents.get(`synthetic-file-${version}`)), documentId: "synthetic-document",
  fileVersionId: `synthetic-file-${version}`,
  termsOfUseBasis: "Dati sintetici creati esclusivamente per il collaudo locale.",
  verificationRationale: "Attestazione sintetica di prova; nessuna verifica giuridica reale.",
});
let sequence = 0;
function verification(input) {
  const snapshot = core.createAssistedVerificationSnapshot(input);
  const verifiedDocuments = snapshot.sources.flatMap(source => source.fullText.available
    && source.fullText.documentId === "synthetic-document" && documents.has(source.fullText.fileVersionId)
    && sha256(documents.get(source.fullText.fileVersionId)) === source.fullText.contentSha256 ? [{
    evidenceSourceId: source.evidenceSourceId, documentId: source.fullText.documentId,
    fileVersionId: source.fullText.fileVersionId, contentSha256: source.fullText.contentSha256,
  }] : []);
  const result = core.verifyResearchEvidence({ ...snapshot, mission, verifiedDocuments });
  return { recordId: `synthetic-record-${++sequence}`, snapshot, result,
    preClaimStatus: core.assistedVerificationPreClaimStatus(mission, result),
    fingerprint: sha256(JSON.stringify(snapshot)),
    recordedByActorId: "synthetic-reviewer", createdAt: now };
}
let current = verification({ missionId: mission.missionId, sources: [] });
let fault = null;
const clientBundle = await build({ ...options, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  stdin: { contents: `import { createRoot } from "react-dom/client";
    import { LegalReviewerClient } from "./src/components/legal-research/LegalReviewerClient";
    createRoot(document.getElementById("root")).render(<LegalReviewerClient initialMissionId=${JSON.stringify(mission.missionId)} />);`,
  loader: "tsx", resolveDir: root } });
const script = clientBundle.outputFiles[0].text;
const cssPath = path.join(root, "src/app/globals.css");
const cssInput = (await readFile(cssPath, "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
const compiler = await compile(cssInput, { base: path.dirname(cssPath), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: root.replaceAll("\\", "/"), pattern: "src/components/{legal-research,ui}/**/*.{ts,tsx}", negated: false }] });
const css = compiler.build(scanner.scan());
await writeFile(path.join(output, "client.js"), script);
await writeFile(path.join(output, "style.css"), css);
await writeFile(path.join(output, "bundle-inputs.json"), JSON.stringify({ browser: clientBundle.metafile.inputs, contracts: coreBundle.metafile.inputs }, null, 2));
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
  <title>Collaudo sintetico revisore</title><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/client.js"></script></body></html>`;
const browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--disable-component-update",
  "--disable-domain-reliability", "--disable-sync", "--no-pings", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(8000);
await context.tracing.start({ screenshots: true, snapshots: true });
await context.routeWebSocket(/.*/, socket => socket.close());
await context.route("**/*", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    events.push({ type: "external-blocked", url: request.url() });
    await route.abort("blockedbyclient");
    return;
  }
  if (url.pathname === "/" && request.method() === "GET") return route.fulfill({ contentType: "text/html", body: html });
  if (url.pathname === "/client.js" && request.method() === "GET") return route.fulfill({ contentType: "application/javascript", body: script });
  if (url.pathname === "/style.css" && request.method() === "GET") return route.fulfill({ contentType: "text/css", body: css });
  if (url.pathname === apiPath && request.method() === "GET") {
    assert.equal(url.searchParams.get("missionId"), mission.missionId);
    events.push({ type: "api", method: "GET", recordId: current.recordId });
    return route.fulfill({ json: { verification: current }, headers: { "Cache-Control": "no-store" } });
  }
  if (url.pathname === apiPath && ["POST", "PUT"].includes(request.method())) {
    const body = request.postDataJSON();
    const event = { type: "api", method: request.method(), body };
    events.push(event);
    const respond = async (status, json) => {
      event.status = status;
      event.response = json;
      return route.fulfill({ status, json, headers: { "Cache-Control": "no-store" } });
    };
    assert.equal(body.missionId, mission.missionId);
    if (fault === "conflict") {
      current = { ...current, recordId: `synthetic-record-concurrent-${++sequence}` };
      fault = null;
    }
    if (body.recordId !== current.recordId) return respond(409, { error: "ASSISTED_VERIFICATION_CONFLICT" });
    if (fault === "network") {
      fault = null;
      event.status = "NETWORK_ABORT_BEFORE_SAVE";
      return route.abort("connectionfailed");
    }
    let next;
    if (request.method() === "PUT") {
      assert.deepEqual(Object.keys(body).sort(), ["missionId", "recordId", "sources"]);
      assert.equal(body.sources.length, 1);
      const draft = body.sources[0];
      assert.deepEqual(draft, sourceDraft(draft.fileVersionId.endsWith("v2") ? "v2" : "v1"));
      const source = {
        evidenceSourceId: draft.evidenceSourceId, authorityId: draft.authorityId, legalSourceId: draft.legalSourceId,
        legalExpressionVersionId: draft.legalExpressionVersionId, officialIdentifier: draft.officialIdentifier,
        sourceUrl: draft.sourceUrl, sourceFamily: draft.sourceFamily, courtOrBody: draft.courtOrBody, documentType: draft.documentType,
        providerId: "HUMAN_REVIEWED_OFFICIAL_SOURCE", accessStatus: "CONSULTABLE", identityVerificationStatus: "VERIFIED",
        reviewerAttestation: { reviewedByActorId: "synthetic-reviewer", reviewedAt: now, rationale: draft.verificationRationale },
        termsOfUse: { status: "PERMITTED", basis: draft.termsOfUseBasis, checkedAt: now },
        fullText: { available: true, contentSha256: draft.contentSha256, documentId: draft.documentId, fileVersionId: draft.fileVersionId },
      };
      next = verification({ ...current.snapshot, sources: [source], adverseSearchReview: undefined });
    } else if (body.action === "SAVE_ADVERSE_SEARCH") {
      assert.deepEqual(Object.keys(body).sort(), ["action", "missionId", "recordId", "search"]);
      const parsed = core.adverseSearchSchema.safeParse(body.search);
      if (!parsed.success || parsed.data.missionId !== mission.missionId) return respond(400, { error: "INVALID_REQUEST" });
      next = verification({ ...current.snapshot, adverseSearch: parsed.data, adverseSearchReview: undefined });
    } else {
      assert.equal(body.action, "REVIEW_ADVERSE_SEARCH");
      assert.deepEqual(Object.keys(body).sort(), ["action", "missionId", "recordId"]);
      if (!current.snapshot.adverseSearch) return respond(400, { error: "INVALID_REQUEST" });
      next = verification({ ...current.snapshot, adverseSearchReview: {
        reviewedByActorId: "synthetic-reviewer", reviewedAt: now,
        basisFingerprint: core.adverseSearchBasis(current.snapshot.adverseSearch, current.snapshot.sources),
      } });
      if (!next.result.adverseSearchCompleted) return respond(400, { error: "INVALID_REQUEST" });
    }
    current = next;
    if (fault === "response-lost") {
      fault = null;
      event.status = "NETWORK_ABORT_AFTER_SAVE";
      event.persistedRecordId = current.recordId;
      return route.abort("connectionfailed");
    }
    return respond(201, { outcome: "CREATED", verification: current });
  }
  events.push({ type: "unexpected-request", url: request.url(), method: request.method() });
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
page.on("pageerror", error => failures.push(error.message));
const form = page.getByRole("region", { name: "Ricerca di autorita' contrarie", exact: true });
const approve = () => form.getByRole("button", { name: "Approva ricerca nel perimetro", exact: true });
const save = () => form.getByRole("button", { name: "Salva resoconto", exact: true });
const requestCount = () => events.filter(event => event.type === "api" && event.method !== "GET").length;
const recorded = () => form.getByText("Revisore registrato", { exact: true });
async function screenshot(name, whole = false) {
  const filename = `${name}.png`;
  if (whole) await page.screenshot({ path: path.join(output, filename), fullPage: true });
  else await form.screenshot({ path: path.join(output, filename) });
  return filename;
}
async function scenario(name, run) {
  if (Number(name.slice(0, 2)) > through) return;
  try {
    const evidence = await run();
    results.push({ scenario: name, result: "PASS", evidence });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({ scenario: name, result: "FAIL", error: String(error) });
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  }
}
async function reload() {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === apiPath);
  await page.reload();
  await response;
  await expect(save()).toBeVisible();
}
async function mutate(button) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() !== "GET");
  await button.click();
  const received = await response;
  await expect(form.getByRole("group", { name: "Perimetro revisionato", exact: true })).toBeEnabled();
  return received.status();
}
async function documentForm(version) {
  const draft = sourceDraft(version);
  const fields = page.getByRole("group", { name: "Fonte che documenta il testo", exact: true });
  const labels = {
    evidenceSourceId: "ID fonte probatoria", authorityId: "ID autorit\u00e0", officialIdentifier: "Identificatore ufficiale",
    legalSourceId: "ID fonte legale", legalExpressionVersionId: "ID versione espressione", sourceUrl: "URL ufficiale HTTPS",
    courtOrBody: "Organo o autorit\u00e0", documentType: "Tipo di documento", contentSha256: "SHA-256 del testo integrale",
    documentId: "ID documento disponibile", fileVersionId: "ID versione del file", termsOfUseBasis: "Base dei diritti d\u2019uso",
    verificationRationale: "Attestazione motivata del revisore",
  };
  for (const [key, label] of Object.entries(labels)) await fields.getByLabel(label, { exact: true }).fill(draft[key]);
  await fields.getByRole("combobox", { name: "Famiglia della fonte", exact: true }).selectOption("CJEU");
  assert.equal(await mutate(page.getByRole("button", { name: "Registra nuova versione", exact: true })), 201);
}
async function fillActivityAndCandidate() {
  await form.getByRole("button", { name: "Aggiungi attivita'", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "Query o attivita' effettivamente svolta", exact: true })).toHaveValue("");
  await expect(form.getByRole("textbox", { name: "Motivazione della valutazione o esclusione", exact: true })).toHaveValue("");
  await form.getByLabel("Data dell'attivita' (UTC)", { exact: true }).fill("2026-09-26T09:00");
  await form.getByRole("textbox", { name: "Query o attivita' effettivamente svolta", exact: true }).fill("Attivita' sintetica di lettura del documento di prova. Nessuna ricerca reale eseguita.");
  await form.getByLabel("Pagina, paragrafo o passaggio", { exact: true }).fill("Paragrafo sintetico 1");
  await form.getByRole("combobox", { name: "Esito", exact: true }).selectOption("NOT_ADVERSE");
  await form.getByRole("textbox", { name: "Motivazione della valutazione o esclusione", exact: true }).fill("Valutazione sintetica non contraria per il solo collaudo; non costituisce giudizio umano reale.");
}
async function saveSearch() {
  assert.equal(await mutate(save()), 201);
  assert.equal(current.snapshot.adverseSearchReview, undefined);
  assert.equal(current.result.adverseSearchCompleted, false);
  await expect(recorded()).toHaveCount(0);
}
async function approveSearch() {
  assert.equal(await mutate(approve()), 201);
  assert.equal(current.result.adverseSearchCompleted, true);
  assert.equal(current.result.adverseAuthorityVerified, false);
  await expect(recorded()).toBeVisible();
  await expect(approve()).toBeDisabled();
}
try {
  await scenario("01-documentazione-incompleta", async () => {
    await page.goto(origin);
    await expect(page.getByText("Gate non soddisfatto", { exact: true })).toBeVisible();
    await expect(approve()).toBeDisabled();
    await expect(save()).toBeDisabled();
    await expect(form.getByRole("textbox", { name: "Motivazione della sufficienza del perimetro", exact: true })).toHaveValue("");
    return screenshot("01-incomplete", true);
  });
  await scenario("02-compilazione-e-salvataggio-senza-approvazione", async () => {
    await documentForm("v1");
    await form.getByLabel("Proposizione giuridica", { exact: true }).fill("synthetic-proposition");
    await form.getByLabel("Dal (UTC)", { exact: true }).fill("2020-01-01T00:00");
    await form.getByLabel("Fino al (UTC)", { exact: true }).fill("2026-09-26T00:00");
    await form.getByLabel("Data di riferimento della missione (UTC)", { exact: true }).fill("2026-09-26T00:00");
    await form.getByRole("checkbox", { name: "CJEU", exact: true }).check();
    await form.getByRole("checkbox", { name: /SYNTHETIC-CJEU-001/ }).check();
    await fillActivityAndCandidate();
    await form.getByRole("textbox", { name: "Limiti della ricerca", exact: true }).fill("Solo documento sintetico locale; nessuna consultazione di fonti o servizi reali.");
    await form.getByRole("textbox", { name: "Motivazione della sufficienza del perimetro", exact: true }).fill("Copertura sintetica del solo perimetro di prova, senza valore probatorio giuridico.");
    await form.getByRole("combobox", { name: "Esito della ricerca", exact: true }).selectOption("NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE");
    await expect(approve()).toBeDisabled();
    await saveSearch();
    await expect(approve()).toBeEnabled();
    const saved = structuredClone(current.snapshot.adverseSearch);
    await reload();
    await expect(form.getByRole("textbox", { name: "Limiti della ricerca", exact: true })).toHaveValue(saved.limitations);
    await expect(form.getByRole("textbox", { name: "Query o attivita' effettivamente svolta", exact: true })).toHaveValue(saved.researchSteps[0].queryOrActivity);
    await expect(recorded()).toHaveCount(0);
    return screenshot("02-saved-not-approved");
  });
  await scenario("03-approvazione-negativa-altri-requisiti-bloccati", async () => {
    await approveSearch();
    await expect(page.getByText("Nessuna autorita' contraria trovata nel perimetro revisionato", { exact: true })).toBeVisible();
    await expect(page.getByText("Nessuna autorita' contraria verificata", { exact: true })).toBeVisible();
    await expect(page.getByText("Gate non soddisfatto", { exact: true })).toBeVisible();
    assert(current.preClaimStatus.unmetRequirements.includes("CITATION_OBSERVATIONS_MISSING"));
    assert(current.preClaimStatus.unmetRequirements.includes("RESEARCH_SUGGESTIONS_MISSING"));
    assert.equal(current.snapshot.adverseReview, undefined);
    return screenshot("03-negative-approved-other-gaps", true);
  });
  await scenario("04-ricaricamento-revisione", async () => {
    const review = structuredClone(current.snapshot.adverseSearchReview);
    await reload();
    await expect(form.getByText(review.reviewedByActorId, { exact: true })).toBeVisible();
    await expect(form.getByText(review.reviewedAt, { exact: true })).toBeVisible();
    await expect(approve()).toBeDisabled();
    await expect(form.getByRole("combobox", { name: "Esito della ricerca", exact: true })).toHaveValue("NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE");
    return screenshot("04-reloaded-approval");
  });
  await scenario("05-modifica-perimetro-invalida-revisione", async () => {
    const before = requestCount();
    await form.getByLabel("Dal (UTC)", { exact: true }).fill("2019-01-01T00:00");
    await expect(approve()).toBeDisabled();
    assert.equal(requestCount(), before);
    await saveSearch();
    await expect(page.getByText("Non svolta o documentazione insufficiente", { exact: true })).toBeVisible();
    await reload();
    await expect(recorded()).toHaveCount(0);
    await expect(form.getByLabel("Dal (UTC)", { exact: true })).toHaveValue("2019-01-01T00:00");
    const evidence = await screenshot("05-scope-invalidated");
    await approveSearch();
    return evidence;
  });
  await scenario("06-modifica-documento-invalida-revisione", async () => {
    await documentForm("v2");
    assert.equal(current.snapshot.adverseSearchReview, undefined);
    assert.equal(current.result.adverseSearchCompleted, false);
    await expect(recorded()).toHaveCount(0);
    await expect(form.getByRole("checkbox", { name: /SYNTHETIC-CJEU-001/ })).not.toBeChecked();
    assert.equal(await mutate(approve()), 400);
    await expect(form.getByRole("alert")).toContainText("Ricerca non approvabile");
    await expect(recorded()).toHaveCount(0);
    return screenshot("06-document-invalidated");
  });
  await scenario("07-ricerca-inconcludente", async () => {
    await form.getByRole("checkbox", { name: /SYNTHETIC-CJEU-001/ }).check();
    await fillActivityAndCandidate();
    await form.getByRole("combobox", { name: "Esito della ricerca", exact: true }).selectOption("INCONCLUSIVE");
    await saveSearch();
    assert.equal(current.result.adverseSearchState, "INCONCLUSIVE");
    await expect(approve()).toBeDisabled();
    await expect(page.getByText("Gate non soddisfatto", { exact: true })).toBeVisible();
    await reload();
    await expect(approve()).toBeDisabled();
    return screenshot("07-inconclusive", true);
  });
  await scenario("08-lacune-e-perimetro-mancante", async () => {
    await form.getByRole("combobox", { name: "Esito della ricerca", exact: true }).selectOption("NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE");
    await form.getByRole("textbox", { name: "Lacune ancora aperte", exact: true }).fill("Lacuna sintetica ancora irrisolta.");
    await saveSearch();
    assert.equal(await mutate(approve()), 400);
    await expect(form.getByRole("alert")).toContainText("Ricerca non approvabile");
    await expect(recorded()).toHaveCount(0);
    await form.getByRole("checkbox", { name: "CJEU", exact: true }).uncheck();
    const recordId = current.recordId;
    assert.equal(await mutate(save()), 400);
    assert.equal(current.recordId, recordId);
    await expect(form.getByRole("alert")).toContainText("Ricerca non approvabile");
    const evidence = await screenshot("08-missing-scope-and-gaps");
    await form.getByRole("checkbox", { name: "CJEU", exact: true }).check();
    await form.getByRole("textbox", { name: "Lacune ancora aperte", exact: true }).fill("");
    await saveSearch();
    return evidence;
  });
  await page.clock.install();
  for (const action of ["SAVE_ADVERSE_SEARCH", "REVIEW_ADVERSE_SEARCH"]) {
    for (const failure of ["conflict", "network"]) {
      await scenario(`09-${action}-${failure}`, async () => {
        await reload();
        await expect(approve()).toBeEnabled();
        const before = requestCount();
        const fingerprint = current.fingerprint;
        fault = failure;
        await (action === "SAVE_ADVERSE_SEARCH" ? save() : approve()).click();
        await expect(form.getByRole("alert")).toContainText(failure === "conflict" ? "Ricaricare la missione" : "Esito del salvataggio non confermato");
        await expect(recorded()).toHaveCount(0);
        await expect(page.getByRole("status")).toHaveCount(0);
        await expect(page.getByText("Nessuna autorita' contraria trovata nel perimetro revisionato", { exact: true })).toHaveCount(0);
        await page.clock.fastForward(30000);
        assert.equal(requestCount(), before + 1, "No automatic retry within 30 seconds of browser time");
        assert.equal(current.fingerprint, fingerprint);
        assert.equal(current.result.adverseSearchCompleted, false);
        return screenshot(`09-${action}-${failure}`);
      });
    }
  }
  await scenario("10-risposta-persa-dopo-registrazione", async () => {
    await reload();
    fault = "response-lost";
    const before = requestCount();
    await approve().click();
    await expect(form.getByRole("alert")).toContainText("Esito del salvataggio non confermato");
    await expect(recorded()).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.clock.fastForward(30000);
    assert.equal(requestCount(), before + 1);
    assert.equal(current.result.adverseSearchCompleted, true);
    const evidence = await screenshot("10-response-lost-no-false-success");
    await reload();
    await expect(recorded()).toBeVisible();
    await expect(approve()).toBeDisabled();
    return evidence;
  });
  await scenario("11-mobile-salvataggio", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reload();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No horizontal page overflow");
    await form.getByRole("textbox", { name: "Limiti della ricerca", exact: true }).fill("Modifica sintetica da viewport mobile; nessuna ricerca giuridica reale.");
    await saveSearch();
    await expect(approve()).toBeEnabled();
    return screenshot("11-mobile", true);
  });
  await scenario("12-richieste-esterne-bloccate", async () => {
    const probe = await context.newPage();
    await assert.rejects(probe.goto("https://synthetic-external.invalid/blocked"), /ERR_BLOCKED_BY_CLIENT/);
    await probe.close();
    assert.equal(events.filter(event => event.type === "external-blocked").length, 1);
    return "browser-events.json";
  });
  assert.deepEqual(failures, []);
  assert.equal(events.some(event => event.type === "unexpected-request"), false);
  assert.equal(sha256(JSON.stringify(mission)), missionFingerprint);
} finally {
  await writeFile(path.join(output, "browser-events.json"), JSON.stringify({ events, failures }, null, 2));
  await writeFile(path.join(output, "run.log"), results.map(result => `${result.result}: ${result.scenario}${result.error ? `\n${result.error}` : ""}`).join("\n"));
  await writeFile(path.join(output, "results.json"), JSON.stringify({ results, mission, finalVerification: current,
    boundaries: "Real React components; intercepted API; pure production validators; synthetic bytes and actor; no real authentication, database, provider, claim, submit or mission execution.",
    retryObservation: "30 seconds of browser virtual time after each error" }, null, 2));
  await context.tracing.stop();
  await browser.close();
}