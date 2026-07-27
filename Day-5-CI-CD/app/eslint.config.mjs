// ESLint 9 "flat config". The old .eslintrc.json format is gone in v9; the
// config is now a plain JS array of config objects, applied in order, with
// later entries overriding earlier ones.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output is generated code — linting it produces only noise.
  { ignores: ["dist/", "dist-test/", "node_modules/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      // Tells ESLint that `process`, `console`, `setTimeout` etc. legitimately
      // exist. Without this, `no-undef` flags every Node global as an error.
      globals: { ...globals.node },
    },
    rules: {
      // A server's stdout IS its log transport in a container, so console is fine.
      "no-console": "off",
      // Allow deliberately-unused args when prefixed with _ (e.g. `_req`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
);