import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyAutomaticResearchConnectorReadiness } from "@/server/legal-research/automatic-research-readiness";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("automatic research connector readiness", () => {
  it("fails closed without persistent token paths or the LDH credential", async () => {
    await expect(verifyAutomaticResearchConnectorReadiness({})).resolves.toEqual({
      ready: false,
      legalDataHunter: "CREDENTIAL_MISSING",
      moonlit: "PATH_MISSING",
      simpliciter: "PATH_MISSING",
    });
  });

  it("rejects relative and invalid OAuth storage without exposing values", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "connector-readiness-"));
    temporaryDirectories.push(directory);
    const invalid = path.join(directory, "invalid.json");
    await writeFile(invalid, JSON.stringify({ tokens: {} }), "utf8");

    await expect(verifyAutomaticResearchConnectorReadiness({
      LEGAL_DATA_HUNTER_API_KEY: "configured",
      MOONLIT_OAUTH_STORAGE_PATH: "relative/oauth.json",
      SIMPLICITER_OAUTH_STORAGE_PATH: invalid,
    })).resolves.toMatchObject({
      ready: false,
      legalDataHunter: "READY",
      moonlit: "PATH_NOT_ABSOLUTE",
      simpliciter: "TOKEN_FILE_INVALID",
    });
  });

  it("reports ready only when both token files and the LDH credential exist", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "connector-readiness-"));
    temporaryDirectories.push(directory);
    const moonlit = path.join(directory, "moonlit.json");
    const simpliciter = path.join(directory, "simpliciter.json");
    await Promise.all([
      writeFile(moonlit, JSON.stringify({ tokens: { access_token: "test-token" } }), "utf8"),
      writeFile(simpliciter, JSON.stringify({ tokens: { access_token: "test-token" } }), "utf8"),
    ]);

    await expect(verifyAutomaticResearchConnectorReadiness({
      LEGAL_DATA_HUNTER_API_KEY: "configured",
      MOONLIT_OAUTH_STORAGE_PATH: moonlit,
      SIMPLICITER_OAUTH_STORAGE_PATH: simpliciter,
    })).resolves.toEqual({
      ready: true,
      legalDataHunter: "READY",
      moonlit: "READY",
      simpliciter: "READY",
    });
  });
});
