import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Electron shell holds the most security-sensitive code in the repo and was
  // previously excluded from lint entirely (and from typecheck, via allowJs: false).
  // It is CommonJS running in Node, so it needs its own language options.
  {
    files: ["desktop/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      // Electron main and preload must be CommonJS; require() is correct here.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**", "release/**", "dist/**", "coverage/**"]),
]);
