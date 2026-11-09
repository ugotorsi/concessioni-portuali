import {
  assertIsolatedPreviewEnvironment,
  databaseIdentityFingerprint,
} from "../../src/server/release/previewIsolation";

function main(): void {
  assertIsolatedPreviewEnvironment(process.env);
  if (process.env.NOETRA_REQUIRE_ISOLATED_PREVIEW !== "true") {
    throw new Error("ISOLATED_PREVIEW_GUARD_NOT_ENABLED");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("ISOLATED_PREVIEW_DATABASE_URL_REQUIRED");
  console.info(`NOETRA_ISOLATED_PREVIEW_DATABASE_FINGERPRINT=${databaseIdentityFingerprint(databaseUrl)}`);
  console.info("NOETRA_ISOLATED_PREVIEW=READY");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "ISOLATED_PREVIEW_VERIFICATION_FAILED");
  process.exitCode = 1;
}
