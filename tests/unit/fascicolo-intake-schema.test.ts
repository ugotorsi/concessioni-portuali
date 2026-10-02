import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261002_fascicolo_intake_senza_concessione/migration.sql",
  "utf8",
);

describe("FascicoloIntake schema", () => {
  it("mantiene obbligatoria la concessione del Procedimento legacy", () => {
    const procedimento = schema.slice(schema.indexOf("model Procedimento {"), schema.indexOf("model FascicoloIntake {"));
    expect(procedimento).toMatch(/concessioneId\s+String\r?\n/);
    expect(procedimento).toMatch(/concessione\s+Concessione\s+@relation/);
    expect(migration).not.toContain('ALTER TABLE "Procedimento"');
  });

  it("crea un fascicolo tenant-scoped con concessione opzionale e documenti", () => {
    expect(schema).toContain("model FascicoloIntake {");
    expect(schema).toMatch(/model FascicoloIntake \{[\s\S]*?enteId\s+String\r?\n/);
    expect(schema).toMatch(/model FascicoloIntake \{[\s\S]*?concessioneId\s+String\?/);
    expect(schema).toMatch(/fascicoloIntakeId\s+String\?/);
    expect(migration).toContain('CREATE TABLE "FascicoloIntake"');
    expect(migration).toContain('ALTER TABLE "Documento" ADD COLUMN "fascicoloIntakeId" TEXT');
    expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
  });
});
