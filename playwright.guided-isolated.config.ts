import path from "node:path";

import { defineConfig } from "playwright/test";

const databaseUrl = process.env.DATABASE_URL;
const storageRoot = process.env.DOCUMENT_STORAGE_ROOT;
const runId = process.env.NOETRA_GUIDED_E2E_RUN_ID;
if (!databaseUrl || !storageRoot || !runId || process.env.NOETRA_GUIDED_E2E !== "1") {
  throw new Error("Guided workflow E2E requires explicit disposable database and storage settings.");
}
const database = new URL(databaseUrl);
if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "55432"
  || database.username !== "noetra_test" || database.pathname !== "/noetra_test_workflow"
  || !path.isAbsolute(storageRoot) || path.basename(path.resolve(storageRoot)) !== "browser-test-storage"
  || !/^[a-z0-9-]{1,24}$/.test(runId)) {
  throw new Error("Refusing to run guided workflow E2E outside the dedicated local environment.");
}

export default defineConfig({
  testDir: "tests/guided-isolated",
  timeout: 240_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3119",
    browserName: "chromium",
    headless: true,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3119",
    url: "http://localhost:3119",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: "http://localhost:3119",
      NEXTAUTH_SECRET: "isolated-only-test-secret-not-for-deployment",
      NODE_ENV: "development",
      VERCEL_ENV: "test",
      DOCUMENT_STORAGE_BACKEND: "local",
      DOCUMENT_STORAGE_ROOT: storageRoot,
      AI_REAL_DATA_ENABLED: "false",
      ASYNC_PROVIDER_EXECUTION_ENABLED: "false",
      AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
      DOCUMENT_WORKER_ACTIVATION_MODE: "DISABLED",
      RATE_LIMIT_BACKEND: "memory",
    },
  },
});
