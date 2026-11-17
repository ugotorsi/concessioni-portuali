import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { observeLocalArtifact } from "@/server/legal-rules/artifact-observation";

const temporaryRoots: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function observe(
  packRoot: string,
  relativePath: string,
  bytes: Buffer,
  overrides: Partial<{ declaredSha256: string; declaredSizeBytes: number }> = {},
) {
  return observeLocalArtifact({
    packRoot,
    relativePath,
    declaredSha256: overrides.declaredSha256 ?? sha256(bytes),
    declaredSizeBytes: overrides.declaredSizeBytes ?? bytes.length,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("B2C9C2A2A pack-root artifact byte observation", () => {
  it.each([
    ["PDF", "document.pdf", Buffer.from("%PDF-1.7\nreal bytes")],
    ["JPEG", "image.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02])],
  ])("observes valid %s bytes without assigning trust", async (_label, fileName, bytes) => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await writeFile(path.join(packRoot, fileName), bytes);

    const result = await observe(packRoot, fileName, bytes);

    expect(result).toMatchObject({
      outcome: "OBSERVED_VALID",
      artifactLocator: fileName,
      declaredSha256: sha256(bytes),
      declaredSizeBytes: bytes.length,
      observedSha256: sha256(bytes),
      observedSizeBytes: bytes.length,
    });
    expect(JSON.stringify(result)).not.toMatch(/TRUSTED|APPROVED|LEGAL_GROUNDED|VERIFIED_LEGAL_SOURCE/);
  });

  it("computes observed values from original bytes and preserves distinct declarations", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("%PDF-byte-identity");
    await writeFile(path.join(packRoot, "identity.pdf"), bytes);

    const result = await observe(packRoot, "identity.pdf", bytes, {
      declaredSha256: "f".repeat(64),
      declaredSizeBytes: 999,
    });

    expect(result).toMatchObject({
      outcome: "INTEGRITY_MISMATCH",
      declaredSha256: "f".repeat(64),
      observedSha256: sha256(bytes),
      declaredSizeBytes: 999,
      observedSizeBytes: bytes.length,
    });
  });

  it("gives SHA mismatch precedence over a simultaneous size mismatch", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("%PDF-precedence");
    await writeFile(path.join(packRoot, "precedence.pdf"), bytes);

    await expect(observe(packRoot, "precedence.pdf", bytes, {
      declaredSha256: "0".repeat(64),
      declaredSizeBytes: bytes.length + 1,
    })).resolves.toMatchObject({ outcome: "INTEGRITY_MISMATCH" });
  });

  it("gives SHA mismatch precedence over unknown MIME", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("unknown bytes");
    await writeFile(path.join(packRoot, "unknown.pdf"), bytes);

    await expect(observe(packRoot, "unknown.pdf", bytes, {
      declaredSha256: "0".repeat(64),
    })).resolves.toMatchObject({ outcome: "INTEGRITY_MISMATCH" });
  });

  it("reports a declared size mismatch only after SHA matches", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("%PDF-size");
    await writeFile(path.join(packRoot, "size.pdf"), bytes);

    await expect(observe(packRoot, "size.pdf", bytes, {
      declaredSizeBytes: bytes.length + 1,
    })).resolves.toMatchObject({ outcome: "FAILED", failureCode: "DECLARED_SIZE_MISMATCH" });
  });

  it("gives size mismatch precedence over MIME mismatch when SHA matches", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await writeFile(path.join(packRoot, "wrong.pdf"), bytes);

    await expect(observe(packRoot, "wrong.pdf", bytes, {
      declaredSizeBytes: bytes.length + 1,
    })).resolves.toMatchObject({ outcome: "FAILED", failureCode: "DECLARED_SIZE_MISMATCH" });
  });

  it.each([
    ["document.pdf", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image.jpg", Buffer.from("%PDF-1.7")],
  ])("rejects byte and extension mismatch for %s", async (fileName, bytes) => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await writeFile(path.join(packRoot, fileName), bytes);

    await expect(observe(packRoot, fileName, bytes)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "MIME_MISMATCH",
    });
  });

  it("rejects unsupported magic bytes without accepting an octet-stream fallback", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("unknown bytes");
    await writeFile(path.join(packRoot, "unknown.pdf"), bytes);

    const result = await observe(packRoot, "unknown.pdf", bytes);
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "MIME_UNDETERMINED" });
    expect(result).not.toHaveProperty("observedMimeType");
  });

  it("returns MISSING only after validating a safe parent chain and invents no observations", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await mkdir(path.join(packRoot, "safe"));

    const result = await observe(packRoot, "safe/missing.pdf", Buffer.from("%PDF-declared"));

    expect(result).toMatchObject({ outcome: "MISSING", artifactLocator: "safe/missing.pdf" });
    expect(result).not.toHaveProperty("observedSha256");
    expect(result).not.toHaveProperty("observedSizeBytes");
    expect(result).not.toHaveProperty("observedMimeType");
  });

  it("distinguishes an ordinary open/read failure from a missing target", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await mkdir(path.join(packRoot, "directory.pdf"));

    await expect(observe(packRoot, "directory.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "ARTIFACT_READ_FAILED",
    });
  });

  it.each([
    "../outside.pdf",
    "C:\\outside.pdf",
    "C:/outside.pdf",
    "C:outside.pdf",
    "\\\\server\\share\\outside.pdf",
    "\\\\?\\C:\\outside.pdf",
    "\\\\.\\device\\outside.pdf",
    "\\rooted.pdf",
    "nested\\..\\..\\outside.pdf",
  ])("rejects unsafe locator %s before reading", async (relativePath) => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await expect(observe(packRoot, relativePath, Buffer.from("%PDF-declared"))).resolves.toEqual({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
      artifactLocator: null,
      declaredSha256: sha256(Buffer.from("%PDF-declared")),
      declaredSizeBytes: Buffer.byteLength("%PDF-declared"),
    });
  });

  it("rejects a blank artifact locator", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    await expect(observe(packRoot, "   ", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("rejects an absolute locator in the host path syntax", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const absolutePath = path.resolve(packRoot, "absolute.pdf");
    await expect(observe(packRoot, absolutePath, Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("rejects a nonexistent pack root as invalid configuration", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const result = await observe(path.join(parent, "missing-pack"), "missing.pdf", Buffer.from("%PDF-declared"));

    expect(result).toEqual({
      outcome: "FAILED",
      failureCode: "INVALID_PACK_ROOT",
      artifactLocator: null,
      declaredSha256: sha256(Buffer.from("%PDF-declared")),
      declaredSizeBytes: Buffer.byteLength("%PDF-declared"),
    });
    expect(result).not.toHaveProperty("observedSha256");
    expect(result).not.toHaveProperty("observedSizeBytes");
    expect(result).not.toHaveProperty("observedMimeType");
  });

  it("rejects a regular file used as the pack root", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const rootFile = path.join(parent, "pack-file");
    await writeFile(rootFile, "not a directory");

    await expect(observe(rootFile, "missing.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "INVALID_PACK_ROOT",
      artifactLocator: null,
    });
  });

  it("rejects a junction or symlink used as the pack root", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const target = path.join(parent, "target");
    const linkedRoot = path.join(parent, "linked-pack");
    await mkdir(target);
    await symlink(target, linkedRoot, process.platform === "win32" ? "junction" : "dir");

    await expect(observe(linkedRoot, "missing.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "INVALID_PACK_ROOT",
      artifactLocator: null,
    });
  });

  it("does not accept a sibling-prefix escape", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const packRoot = path.join(parent, "pack");
    const sibling = path.join(parent, "pack-escape");
    const bytes = Buffer.from("%PDF-outside");
    await mkdir(packRoot);
    await mkdir(sibling);
    await writeFile(path.join(sibling, "outside.pdf"), bytes);

    await expect(observe(packRoot, "../pack-escape/outside.pdf", bytes)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("rejects an existing artifact reached through an escaping junction or symlink", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const packRoot = path.join(parent, "pack");
    const outside = path.join(parent, "outside");
    const bytes = Buffer.from("%PDF-outside");
    await mkdir(packRoot);
    await mkdir(outside);
    await writeFile(path.join(outside, "outside.pdf"), bytes);
    await symlink(outside, path.join(packRoot, "external-link"), process.platform === "win32" ? "junction" : "dir");

    await expect(observe(packRoot, "external-link/outside.pdf", bytes)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("rejects an escaping junction used as the final target segment", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const packRoot = path.join(parent, "pack");
    const outside = path.join(parent, "outside");
    await mkdir(packRoot);
    await mkdir(outside);
    await symlink(outside, path.join(packRoot, "linked.pdf"), process.platform === "win32" ? "junction" : "dir");

    await expect(observe(packRoot, "linked.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("applies the strong policy by rejecting links even when they resolve inside the pack", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const target = path.join(packRoot, "target");
    await mkdir(target);
    await symlink(target, path.join(packRoot, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(observe(packRoot, "linked/missing.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("rejects a missing artifact below an existing escaping junction or symlink parent", async () => {
    const parent = await temporaryDirectory("artifact-parent-");
    const packRoot = path.join(parent, "pack");
    const outside = path.join(parent, "outside");
    await mkdir(packRoot);
    await mkdir(outside);
    await symlink(outside, path.join(packRoot, "external-link"), process.platform === "win32" ? "junction" : "dir");

    await expect(observe(packRoot, "external-link/missing.pdf", Buffer.from("%PDF-declared"))).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "UNSAFE_ARTIFACT_PATH",
    });
  });

  it("accepts a safe nested artifact and returns a normalized pack-relative locator", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("%PDF-nested");
    await mkdir(path.join(packRoot, "norme", "atti"), { recursive: true });
    await writeFile(path.join(packRoot, "norme", "atti", "atto.pdf"), bytes);

    await expect(observe(packRoot, "norme\\atti/./atto.pdf", bytes)).resolves.toMatchObject({
      outcome: "OBSERVED_VALID",
      artifactLocator: "norme/atti/atto.pdf",
    });
  });

  it("returns a lowercase observed digest while preserving an uppercase declaration", async () => {
    const packRoot = await temporaryDirectory("artifact-pack-");
    const bytes = Buffer.from("%PDF-uppercase-declaration");
    const digest = sha256(bytes);
    await writeFile(path.join(packRoot, "digest.pdf"), bytes);

    await expect(observe(packRoot, "digest.pdf", bytes, {
      declaredSha256: digest.toUpperCase(),
    })).resolves.toMatchObject({
      outcome: "OBSERVED_VALID",
      declaredSha256: digest.toUpperCase(),
      observedSha256: digest,
    });
  });

  it("has no database or persistence dependency", async () => {
    const sourcePath = path.resolve(process.cwd(), "src/server/legal-rules/artifact-observation.ts");
    const source = await readFile(sourcePath, "utf8");
    expect(source).not.toMatch(/@\/lib\/prisma|generated\/prisma|LegalSource|ImportRun|LegalRule/);
  });
});