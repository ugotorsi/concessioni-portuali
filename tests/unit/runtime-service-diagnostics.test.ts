import { describe, expect, it, vi } from "vitest";

import { getRuntimeServiceDiagnostics } from "@/server/runtime/serviceDiagnostics";

describe("runtime service diagnostics", () => {
  it("does not call external services when optional capabilities are disabled", async () => {
    const fetchImpl = vi.fn();
    const diagnostics = await getRuntimeServiceDiagnostics({}, {
      fetch: fetchImpl,
      probeR2: vi.fn(),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(diagnostics.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ai", status: "NOT_CONFIGURED" }),
      expect.objectContaining({ id: "connectors", status: "DISABLED" }),
      expect.objectContaining({ id: "r2", status: "NOT_CONFIGURED" }),
    ]));
  });

  it("verifies configured AI, Render, R2, and connector capabilities without exposing credentials", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("api.openai.com")) {
        return new Response("{}", { status: 200 });
      }
      return Response.json({
        id: "srv-worker",
        name: "worker",
        type: "background_worker",
        suspended: "not_suspended",
      });
    }) as unknown as typeof fetch;
    const probeR2 = vi.fn().mockResolvedValue(undefined);
    const verifyResearchConnectors = vi.fn().mockResolvedValue({
      ready: true,
      legalDataHunter: "READY",
      moonlit: "READY",
      simpliciter: "READY",
    });
    const diagnostics = await getRuntimeServiceDiagnostics({
      AI_OPENAI_API_KEY: "secret",
      RENDER_WORKER_API_KEY: "secret",
      RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-app",
      RENDER_DOCUMENT_OCR_WORKER_SERVICE_ID: "srv-ocr",
      DOCUMENT_STORAGE_BACKEND: "s3",
      S3_ENDPOINT: "https://r2.example.test",
      S3_REGION: "auto",
      S3_BUCKET: "documents",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
      AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "true",
      LEGAL_DATA_HUNTER_API_KEY: "secret",
      MOONLIT_OAUTH_STORAGE_PATH: "C:\\tokens\\moonlit.json",
      SIMPLICITER_OAUTH_STORAGE_PATH: "C:\\tokens\\simpliciter.json",
    }, {
      fetch: fetchImpl,
      probeR2,
      verifyResearchConnectors,
    });

    expect(diagnostics.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ai", status: "READY" }),
      expect.objectContaining({ id: "render-application", status: "READY" }),
      expect.objectContaining({ id: "render-ocr", status: "READY" }),
      expect.objectContaining({ id: "r2", status: "READY" }),
      expect.objectContaining({ id: "connectors", status: "READY" }),
    ]));
    expect(probeR2).toHaveBeenCalledOnce();
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });

  it("reports rejected credentials and unreachable storage explicitly", async () => {
    const diagnostics = await getRuntimeServiceDiagnostics({
      AI_OPENAI_API_KEY: "invalid",
      RENDER_WORKER_API_KEY: "invalid",
      RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-app",
      DOCUMENT_STORAGE_BACKEND: "s3",
      S3_ENDPOINT: "https://r2.example.test",
      S3_REGION: "auto",
      S3_BUCKET: "documents",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
    }, {
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) as unknown as typeof fetch,
      probeR2: vi.fn().mockRejectedValue(new Error("denied")),
    });

    expect(diagnostics.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ai", status: "ATTENTION", code: "AI_PROVIDER_HTTP_401" }),
      expect.objectContaining({ id: "render-application", status: "ATTENTION", code: "RENDER_HTTP_401" }),
      expect.objectContaining({ id: "r2", status: "UNREACHABLE", code: "R2_BUCKET_UNREACHABLE" }),
    ]));
  });
});
