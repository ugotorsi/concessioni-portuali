import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const getActiveDocumentStorageBackendMock = vi.hoisted(() => vi.fn());
const getDocumentStorageAdapterMock = vi.hoisted(() => vi.fn());
const getS3StorageConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

vi.mock("@/server/documents/storage", () => ({
  getActiveDocumentStorageBackend: getActiveDocumentStorageBackendMock,
  getDocumentStorageAdapter: getDocumentStorageAdapterMock,
}));

vi.mock("@/server/documents/storage/config", () => ({
  getS3StorageConfig: getS3StorageConfigMock,
}));

import { POST } from "@/app/api/admin/preview-storage-probe/route";

const EXPECTED_ENDPOINT =
  "https://4ac24bca26aa795c991ef8d9d6459922.r2.cloudflarestorage.com";
const EXPECTED_BODY = Buffer.from("NOETRA R2 E2E runtime persistence probe v1\n", "utf8");

function request(body: unknown): Request {
  return new Request("https://example.test/api/admin/preview-storage-probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function storedObject(storageKey: string) {
  return {
    storageProvider: "s3" as const,
    storageKey,
    fileName: storageKey.split("/").pop()!,
    bucket: "concessioni-portuali-e2e-20261009",
    sizeBytes: EXPECTED_BODY.length,
    sha256: "unused-by-route",
    mimeType: "text/plain",
    originalName: "runtime-persistence-probe.txt",
  };
}

describe("POST /api/admin/preview-storage-probe", () => {
  const storage = {
    exists: vi.fn(),
    createIfAbsent: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "e2e-unified-fascicolo-20261009");
    getActiveDocumentStorageBackendMock.mockReturnValue("s3");
    getS3StorageConfigMock.mockReturnValue({
      endpoint: EXPECTED_ENDPOINT,
      region: "auto",
      bucket: "concessioni-portuali-e2e-20261009",
      accessKeyId: "not-observed",
      secretAccessKey: "not-observed",
      forcePathStyle: true,
    });
    getAuthSessionMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    getDocumentStorageAdapterMock.mockReturnValue(storage);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["VERCEL_ENV", "production"],
    ["VERCEL_GIT_COMMIT_REF", "staging-operativo"],
  ])("returns 404 outside the exact branch scope when %s differs", async (name, value) => {
    vi.stubEnv(name, value);

    const response = await POST(request({ action: "create" }));

    expect(response.status).toBe(404);
    expect(getAuthSessionMock).not.toHaveBeenCalled();
    expect(getDocumentStorageAdapterMock).not.toHaveBeenCalled();
  });

  it.each([
    { backend: "local" },
    { bucket: "concessioni-portuali-staging-c1-bdeaa8dd" },
    { endpoint: "https://example.invalid" },
    { region: "eu" },
    { forcePathStyle: false },
  ])("fails closed before storage access for invalid configuration: %j", async (override) => {
    if (override.backend) {
      getActiveDocumentStorageBackendMock.mockReturnValueOnce(override.backend);
    } else {
      getS3StorageConfigMock.mockReturnValueOnce({
        endpoint: EXPECTED_ENDPOINT,
        region: "auto",
        bucket: "concessioni-portuali-e2e-20261009",
        accessKeyId: "not-observed",
        secretAccessKey: "not-observed",
        forcePathStyle: true,
        ...override,
      });
    }

    const response = await POST(request({ action: "create" }));

    expect(response.status).toBe(503);
    expect(getDocumentStorageAdapterMock).not.toHaveBeenCalled();
  });

  it("requires an authenticated ADMIN session", async () => {
    getAuthSessionMock.mockResolvedValueOnce({ user: { id: "user-1", role: "TECNICO" } });

    const response = await POST(request({ action: "create" }));

    expect(response.status).toBe(401);
    expect(getDocumentStorageAdapterMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { action: "create", storageKey: "e2e-storage-probe/client-controlled" },
    { action: "create", bucket: "other-bucket" },
    { action: "unknown" },
  ])("rejects client-controlled or invalid probe inputs: %j", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(getDocumentStorageAdapterMock).not.toHaveBeenCalled();
  });

  it("creates the server-defined object and verifies HEAD, GET, content, and SHA-256", async () => {
    storage.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    storage.createIfAbsent.mockImplementationOnce(async (input) => ({
      disposition: "CREATED",
      object: storedObject(input.storageKey),
      ownedByAttempt: true,
    }));
    storage.get.mockResolvedValueOnce({ body: EXPECTED_BODY });

    const response = await POST(request({ action: "create" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "CREATED",
      headVerified: true,
      sha256Verified: true,
      absentAfterDelete: false,
    });
    expect(storage.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: expect.stringMatching(/^e2e-storage-probe\/[0-9a-f-]{36}$/),
      body: EXPECTED_BODY,
    }));
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("verifies the persisted server-defined object without rewriting it", async () => {
    storage.exists.mockResolvedValueOnce(true);
    storage.get.mockResolvedValueOnce({ body: EXPECTED_BODY });

    const response = await POST(request({ action: "verify" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "VERIFIED",
      headVerified: true,
      sha256Verified: true,
    });
    expect(storage.createIfAbsent).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("deletes only the server-defined object after verifying its content", async () => {
    storage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    storage.get.mockResolvedValueOnce({ body: EXPECTED_BODY });
    storage.delete.mockResolvedValueOnce(undefined);

    const response = await POST(request({ action: "delete" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "DELETED",
      absentAfterDelete: true,
    });
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^e2e-storage-probe\/[0-9a-f-]{36}$/),
    );
  });

  it("fails closed and removes the probe after a content mismatch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    storage.get.mockResolvedValueOnce({ body: Buffer.from("unexpected") });
    storage.delete.mockResolvedValueOnce(undefined);

    const response = await POST(request({ action: "verify" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Storage diagnostic failed.",
      cleanupVerified: true,
    });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({
      event: "preview_storage_probe_failed",
      action: "verify",
      cleanupVerified: true,
    }));
    consoleError.mockRestore();
  });
});
