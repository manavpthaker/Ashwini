import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // Next resolves `server-only` to a no-op under the react-server condition.
      // Vitest runs in plain Node, where the real module throws on import.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests need a live Postgres; they opt in via ASHWINI_TEST_DATABASE_URL.
    // See tests/integration/README.md.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["domain/**/*.ts", "server/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.test.ts", "lib/demo-data.ts", "lib/learning.ts"],
      thresholds: {
        // The domain layer is pure and safety-critical, so full coverage is both
        // achievable and meaningful. Everything else is held to a lower bar on
        // purpose — a single global number would push effort into testing glue.
        "domain/**/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
