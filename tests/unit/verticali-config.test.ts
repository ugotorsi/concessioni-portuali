import { describe, expect, it } from "vitest";

import { CONCESSION_VERTICAL_VALUES } from "@/lib/concession-vertical";
import { getVerticaleBySlug, VERTICALI_CONFIG } from "@/lib/verticali-config";

describe("verticali config semantics", () => {
  it("covers every concession vertical enum value", () => {
    const configValues = VERTICALI_CONFIG.map((item) => item.value).sort();
    const enumValues = [...CONCESSION_VERTICAL_VALUES].sort();

    expect(configValues).toEqual(enumValues);
  });

  it("does not use static Operativa status labels", () => {
    for (const item of VERTICALI_CONFIG) {
      expect(item.coverageLabel).not.toBe("Operativa");
      expect(item.coverageLabel.length).toBeGreaterThan(0);
    }
  });

  it("keeps stable slug lookup", () => {
    const item = getVerticaleBySlug("portuale-adsp");
    expect(item?.label).toBe("Portuale / AdSP");
  });
});
