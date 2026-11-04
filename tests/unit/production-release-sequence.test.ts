import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));

import {
  PRODUCTION_RELEASE,
  REQUIRED_PRODUCTION_ENV,
  type VercelDeploymentSnapshot,
} from "../../scripts/deploy/production-release-policy";
import { releaseProduction } from "../../scripts/deploy/release-production";

const oldCommit = "a".repeat(40);
const newCommit = "b".repeat(40);
const oldDeployment: VercelDeploymentSnapshot = {
  id: "dpl_old",
  projectId: PRODUCTION_RELEASE.projectId,
  target: "production",
  readyState: "READY",
  meta: { gitCommitSha: oldCommit },
};
const newDeployment: VercelDeploymentSnapshot = {
  id: "dpl_new",
  projectId: PRODUCTION_RELEASE.projectId,
  target: "production",
  readyState: "READY",
  meta: { gitCommitSha: newCommit },
};

function mockRelease(options: {
  staged?: VercelDeploymentSnapshot;
  stagedStatus?: number;
  changeAliasBeforePromotion?: boolean;
  alreadyPromoted?: boolean;
} = {}) {
  const commands: string[] = [];
  let promoted = options.alreadyPromoted ?? false;
  let aliasReads = 0;
  const staged = options.staged ?? newDeployment;
  mocks.spawnSync.mockImplementation((command: unknown, args: unknown) => {
    if (typeof command !== "string") throw new Error("Unexpected command");
    const invocation = Array.isArray(args) ? `${command} ${args.join(" ")}` : command;
    commands.push(invocation);
    let stdout: string;
    if (invocation.startsWith("git status")) stdout = "";
    else if (invocation.startsWith("git rev-parse")) stdout = newCommit;
    else if (invocation.startsWith("git fetch")) stdout = "";
    else if (invocation.startsWith("git branch")) stdout = "origin/fix/release";
    else if (invocation.includes("/domains/app.noetra.it")) {
      stdout = JSON.stringify({ name: PRODUCTION_RELEASE.productionDomain, gitBranch: null });
    } else if (invocation.includes(`/projects/${PRODUCTION_RELEASE.projectId}/env`)) {
      stdout = JSON.stringify({ envs: REQUIRED_PRODUCTION_ENV.map((key) => ({ key, target: ["production"] })) });
    } else if (invocation.includes("/v13/deployments/app.noetra.it")) {
      aliasReads += 1;
      const current = options.changeAliasBeforePromotion && aliasReads >= 3 && !promoted
        ? { ...oldDeployment, id: "dpl_other" }
        : promoted ? newDeployment : oldDeployment;
      stdout = JSON.stringify(current);
    } else if (invocation.includes("/v13/deployments/noetra-staged-test.vercel.app")
      || invocation.includes("/v13/deployments/dpl_new")) {
      stdout = JSON.stringify(staged);
    } else if (invocation.startsWith("vercel deploy")) {
      stdout = "https://noetra-staged-test.vercel.app";
    } else if (invocation.startsWith("vercel curl")) {
      stdout = `HTTP/1.1 ${options.stagedStatus ?? 200} response\r\n\r\n`;
    } else if (invocation.startsWith("vercel promote")) {
      promoted = true;
      stdout = "";
    } else {
      throw new Error(`Unexpected command: ${invocation}`);
    }
    return { status: 0, stdout, stderr: "" };
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  return commands;
}

afterEach(() => {
  mocks.spawnSync.mockReset();
  vi.unstubAllGlobals();
});

describe("protected production release sequence", () => {
  it("verifies the isolated production deployment before promoting it", async () => {
    const commands = mockRelease();
    await releaseProduction(["--expected-commit", newCommit]);

    const deploy = commands.findIndex((command) => command.startsWith("vercel deploy"));
    const probe = commands.findIndex((command) => command.startsWith("vercel curl"));
    const promote = commands.findIndex((command) => command.startsWith("vercel promote"));
    expect(deploy).toBeGreaterThan(-1);
    expect(commands[deploy]).toContain("--prod");
    expect(commands[deploy]).toContain("--skip-domain");
    expect(commands[deploy]).toContain(`--project=${PRODUCTION_RELEASE.projectId}`);
    expect(probe).toBeGreaterThan(deploy);
    expect(promote).toBeGreaterThan(probe);
    expect(commands.filter((command) => command.includes("/domains/app.noetra.it"))).toHaveLength(2);
    expect(commands.filter((command) => command.includes("/v13/deployments/app.noetra.it"))).toHaveLength(4);
    expect(commands.some((command) => command.startsWith("vercel alias set"))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["preview", { ...newDeployment, target: "preview" }, "DEPLOYMENT_NOT_PRODUCTION_TARGET"],
    ["wrong commit", { ...newDeployment, meta: { gitCommitSha: oldCommit } }, "DEPLOYMENT_COMMIT_MISMATCH"],
    ["missing project", { ...newDeployment, projectId: undefined }, "DEPLOYMENT_PROJECT_MISMATCH"],
  ] as const)("never promotes a staged deployment with %s", async (_label, staged, code) => {
    const commands = mockRelease({ staged });
    await expect(releaseProduction(["--expected-commit", newCommit])).rejects.toMatchObject({ code });
    expect(commands.some((command) => command.startsWith("vercel promote"))).toBe(false);
  });

  it("blocks promotion if the staged health check fails or the live alias changes", async () => {
    let commands = mockRelease({ stagedStatus: 503 });
    await expect(releaseProduction(["--expected-commit", newCommit]))
      .rejects.toMatchObject({ code: "HEALTHCHECK_FAILED" });
    expect(commands.some((command) => command.startsWith("vercel promote"))).toBe(false);

    commands = mockRelease({ changeAliasBeforePromotion: true });
    await expect(releaseProduction(["--expected-commit", newCommit]))
      .rejects.toMatchObject({ code: "ALIAS_MISMATCH" });
    expect(commands.some((command) => command.startsWith("vercel promote"))).toBe(false);
  });

  it("resumes a verified deployment without building another one", async () => {
    const commands = mockRelease();
    await releaseProduction(["--expected-commit", newCommit, "--resume-deployment", "dpl_new"]);
    expect(commands.some((command) => command.startsWith("vercel deploy"))).toBe(false);
    expect(commands.some((command) => command.startsWith("vercel promote dpl_new"))).toBe(true);
  });

  it("does not promote again when the resumed deployment is already live", async () => {
    const commands = mockRelease({ alreadyPromoted: true });
    await releaseProduction(["--expected-commit", newCommit, "--resume-deployment", "dpl_new"]);
    expect(commands.some((command) => command.startsWith("vercel deploy"))).toBe(false);
    expect(commands.some((command) => command.startsWith("vercel promote"))).toBe(false);
  });

  it("keeps verify-only free of deployment and promotion commands", async () => {
    const commands = mockRelease();
    await releaseProduction(["--expected-commit", oldCommit, "--verify-only"]);
    expect(commands.some((command) => command.startsWith("vercel deploy"))).toBe(false);
    expect(commands.some((command) => command.startsWith("vercel promote"))).toBe(false);
  });
});
