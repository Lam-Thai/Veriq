import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Unit-test runner for the pure lib layer (lib/income-calculators.ts et al.). Deliberately scoped
// to *.test.ts(x) so it never picks up the Playwright *.spec.ts files under e2e/ (those use
// @playwright/test's own runner via `npm run test:e2e`). The `@/` alias mirrors tsconfig's paths so
// tests import modules exactly as app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
