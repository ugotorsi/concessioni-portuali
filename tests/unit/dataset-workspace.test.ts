import { describe, expect, it } from "vitest";

import {
  createDatasetWorkspaceToken,
  DATASET_WORKSPACE_TTL_SECONDS,
  verifyDatasetWorkspaceToken,
} from "@/lib/dataset-workspace";
import { parseDatasetWorkspaceSelectionNotice } from "@/lib/dataset-workspace-browser";

const secret = "dataset-workspace-test-secret-value-with-32-bytes";
const now = new Date("2026-11-23T18:00:00.000Z");

describe("dataset workspace token", () => {
  it("binds the selected scope to the authenticated administrator", () => {
    const token = createDatasetWorkspaceToken({
      userId: "admin-1",
      scope: "SYNTHETIC",
      secret,
      now,
    });

    expect(verifyDatasetWorkspaceToken({
      token,
      userId: "admin-1",
      secret,
      now: new Date(now.getTime() + 1_000),
    })).toBe("SYNTHETIC");
    expect(verifyDatasetWorkspaceToken({
      token,
      userId: "admin-2",
      secret,
      now: new Date(now.getTime() + 1_000),
    })).toBeNull();
  });

  it("rejects tampered and expired selections", () => {
    const token = createDatasetWorkspaceToken({
      userId: "admin-1",
      scope: "PROFESSIONAL",
      secret,
      now,
    });
    const [payload, signature] = token.split(".");

    expect(verifyDatasetWorkspaceToken({
      token: `${payload}x.${signature}`,
      userId: "admin-1",
      secret,
      now,
    })).toBeNull();
    expect(verifyDatasetWorkspaceToken({
      token,
      userId: "admin-1",
      secret,
      now: new Date(now.getTime() + DATASET_WORKSPACE_TTL_SECONDS * 1_000),
    })).toBeNull();
  });

  it("accepts only current professional or synthetic browser notices", () => {
    const expiresAt = now.getTime() + 60_000;

    expect(parseDatasetWorkspaceSelectionNotice(
      JSON.stringify({ scope: "SYNTHETIC", expiresAt }),
      now.getTime(),
    )).toEqual({ scope: "SYNTHETIC", expiresAt });
    expect(parseDatasetWorkspaceSelectionNotice(
      JSON.stringify({ scope: "ALL", expiresAt }),
      now.getTime(),
    )).toBeNull();
    expect(parseDatasetWorkspaceSelectionNotice(
      JSON.stringify({ scope: "PROFESSIONAL", expiresAt: now.getTime() }),
      now.getTime(),
    )).toBeNull();
    expect(parseDatasetWorkspaceSelectionNotice("not-json", now.getTime())).toBeNull();
  });
});
