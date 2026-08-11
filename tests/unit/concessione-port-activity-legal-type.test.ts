import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { canManageConcessioneLegalClassification } from "@/lib/auth";
import {
  getPortActivityLegalTypeLabel,
  PORT_ACTIVITY_LEGAL_TYPE_VALUES,
} from "@/lib/port-activity-legal-type";

describe("concessione port activity legal type", () => {
  it("keeps the legal values distinct and explicitly labelled", () => {
    expect(PORT_ACTIVITY_LEGAL_TYPE_VALUES).toEqual([
      "OPERAZIONI_PORTUALI",
      "SERVIZI_PORTUALI",
      "PASSEGGERI",
      "ALTRO",
    ]);
    expect(getPortActivityLegalTypeLabel(null)).toBe("Non classificata");
    expect(getPortActivityLegalTypeLabel("OPERAZIONI_PORTUALI")).toBe("Operazioni portuali");
    expect(getPortActivityLegalTypeLabel("SERVIZI_PORTUALI")).toBe("Servizi portuali");
    expect(getPortActivityLegalTypeLabel("PASSEGGERI")).toBe("Attività relative ai passeggeri");
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"] as const)("allows role %s", (role) => {
    expect(canManageConcessioneLegalClassification(role)).toBe(true);
  });

  it.each(["RESPONSABILE_AREA", "TECNICO", "ECONOMICO", "SEGRETERIA", "AUTORITA_GIUDIZIARIA"] as const)(
    "rejects role %s",
    (role) => expect(canManageConcessioneLegalClassification(role)).toBe(false),
  );

  it("uses a nullable additive migration with no default, update, or backfill", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260811_p1c0_port_activity_legal_type/migration.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TYPE "PortActivityLegalType" AS ENUM');
    expect(migration).toContain('ADD COLUMN "portActivityLegalType" "PortActivityLegalType";');
    expect(migration).not.toMatch(/NOT NULL|DEFAULT|UPDATE|INSERT|DELETE/i);
  });

  it("does not infer the legal type from the operational activity taxonomy", () => {
    const helper = readFileSync(resolve("src/lib/port-activity-legal-type.ts"), "utf8");
    expect(helper).not.toContain("AttivitaConcessione");
    expect(helper).not.toContain("PORTUALE_ADSP");
  });
});