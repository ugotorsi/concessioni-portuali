import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "build/**",
    "coverage/**",
    "dist/**",
    "next-env.d.ts",
    "out/**",
    "playwright-report/**",
    "src/generated/**",
    "staging-preparation/**",
    "test-results/**",
  ]),
]);
