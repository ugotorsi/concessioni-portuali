import { describe, expect, it } from "vitest";

import { buildServiceCenterSnapshot } from "@/server/runtime/serviceCenter";

const health = {
  status: "HEALTHY" as const,
  databaseConnected: true,
  queueDepth: 0,
  runningJobs: 0,
  failedJobs: 0,
  staleLeases: 0,
  oldestPendingAgeSeconds: null,
  activeWorkers: 0,
  lastSuccessfulJobAt: null,
  migrationState: "COMPATIBLE" as const,
};

const databaseIdentity = {
  available: true,
  outcome: "MATCH" as const,
  databaseConnected: true,
  endpointId: "ep-preview",
  neonProjectId: "project-preview",
  neonBranchId: "branch-preview",
  databaseName: "neondb",
};

describe("runtime service center", () => {
  it("reports only verifiable costs and explicitly marks unavailable provider billing data", () => {
    const snapshot = buildServiceCenterSnapshot({
      environment: {
        AI_OPENAI_API_KEY: "configured",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_ID: "project",
        DOCUMENT_STORAGE_BACKEND: "s3",
        S3_ENDPOINT: "https://storage.test",
        S3_REGION: "auto",
        S3_BUCKET: "documents",
        S3_ACCESS_KEY_ID: "configured",
        S3_SECRET_ACCESS_KEY: "configured",
      },
      health,
      databaseIdentity,
      costs: {
        actualLast30DaysEur: 1.25,
        actualLast7DaysEur: 0.7,
        reservedEur: 0.2,
      },
      now: new Date("2026-10-29T00:00:00Z"),
    });

    const ai = snapshot.services.find((service) => service.id === "ai");
    expect(ai?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Costo effettivo 30 giorni" }),
      expect.objectContaining({ label: "Proiezione a 30 giorni" }),
    ]));
    expect(ai?.alerts.join(" ")).toContain("non sono esposti");
  });

  it("raises blocking alerts for missing required infrastructure configuration", () => {
    const snapshot = buildServiceCenterSnapshot({
      environment: {},
      health: { ...health, queueDepth: 2 },
      databaseIdentity: { ...databaseIdentity, outcome: "NON_VERIFICABILE" },
      costs: { actualLast30DaysEur: 0, actualLast7DaysEur: 0, reservedEur: 0 },
    });

    expect(snapshot.blockingCount).toBeGreaterThan(0);
    expect(snapshot.services.find((service) => service.id === "render")).toMatchObject({
      status: "NOT_CONFIGURED",
      severity: "BLOCKING",
      controllable: false,
    });
  });
});
