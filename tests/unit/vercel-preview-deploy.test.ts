import { describe, expect, it } from "vitest";

import {
  createVercelPreviewDeploySpec,
  parseVercelPreviewDeployArgs,
  VERCEL_PREVIEW_DEPLOYMENT,
  VercelPreviewDeployError,
} from "../../scripts/deploy/vercel-preview";

const COMMIT = "b".repeat(40);

describe("Vercel Preview deployment guard", () => {
  it("pins the project, organization, and Preview target", () => {
    const parsed = parseVercelPreviewDeployArgs([
      "--expected-commit",
      COMMIT,
      "--force",
    ]);
    const spec = createVercelPreviewDeploySpec(parsed, { NODE_ENV: "test" }, "linux");

    expect(spec).toMatchObject({
      executable: "vercel",
      args: [
        "deploy",
        "--target=preview",
        `--scope=${VERCEL_PREVIEW_DEPLOYMENT.scope}`,
        "--yes",
        "--force",
      ],
      environment: {
        VERCEL_PROJECT_ID: VERCEL_PREVIEW_DEPLOYMENT.projectId,
        VERCEL_ORG_ID: VERCEL_PREVIEW_DEPLOYMENT.organizationId,
      },
    });
  });

  it("launches the Vercel command through cmd.exe on Windows", () => {
    const parsed = parseVercelPreviewDeployArgs([
      "--expected-commit",
      COMMIT,
      "--force",
    ]);
    const spec = createVercelPreviewDeploySpec(parsed, {
      NODE_ENV: "test",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    }, "win32");

    expect(spec).toMatchObject({
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "vercel.cmd",
        "deploy",
        "--target=preview",
        `--scope=${VERCEL_PREVIEW_DEPLOYMENT.scope}`,
        "--yes",
        "--force",
      ],
    });
  });

  it.each([
    ["--prod"],
    ["--target=production"],
    ["--target", "production"],
    ["--environment=production"],
  ])("rejects a Production target: %j", (...arguments_) => {
    expect(() => parseVercelPreviewDeployArgs([
      "--expected-commit",
      COMMIT,
      ...arguments_,
    ])).toThrow(new VercelPreviewDeployError("PRODUCTION_TARGET_FORBIDDEN"));
  });

  it.each([
    ["--target=preview"],
    ["--environment", "preview"],
  ])("rejects any target override: %j", (...arguments_) => {
    expect(() => parseVercelPreviewDeployArgs([
      "--expected-commit",
      COMMIT,
      ...arguments_,
    ])).toThrow(new VercelPreviewDeployError("TARGET_OVERRIDE_FORBIDDEN"));
  });

  it.each([
    ["--project", "other-project"],
    ["--scope=other-team"],
  ])("rejects any project identity override: %j", (...arguments_) => {
    expect(() => parseVercelPreviewDeployArgs([
      "--expected-commit",
      COMMIT,
      ...arguments_,
    ])).toThrow(new VercelPreviewDeployError("PROJECT_OVERRIDE_FORBIDDEN"));
  });

  it("requires a full expected commit SHA", () => {
    expect(() => parseVercelPreviewDeployArgs([]))
      .toThrow(new VercelPreviewDeployError("EXPECTED_COMMIT_REQUIRED"));
    expect(() => parseVercelPreviewDeployArgs(["--expected-commit", "bbbfa42"]))
      .toThrow(new VercelPreviewDeployError("EXPECTED_COMMIT_INVALID"));
  });

  it("fails closed when inherited Vercel identity differs", () => {
    const parsed = parseVercelPreviewDeployArgs(["--expected-commit", COMMIT]);
    expect(() => createVercelPreviewDeploySpec(parsed, {
      NODE_ENV: "test",
      VERCEL_PROJECT_ID: "prj_other",
    }, "linux")).toThrow(new VercelPreviewDeployError("VERCEL_IDENTITY_MISMATCH"));
  });
});
