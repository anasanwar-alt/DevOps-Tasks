// ESLint 9 flat config for the frontend — same format as the backend's, with
// two React-specific additions.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/", "node_modules/"] },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      // Browser globals: document, fetch, window. Without this, `no-undef`
      // flags every one of them. (The backend uses globals.node instead.)
      globals: { ...globals.browser },
      parserOptions: {
        // ESLint's default parser understands JSX once this is switched on —
        // no extra parser package needed.
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Scope analysis does not count JSX usage as a reference, so without this
      // rule `import App from "./App.jsx"` looks unused to `no-unused-vars`
      // even though <App /> is right there.
      "react/jsx-uses-vars": "error",

      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
