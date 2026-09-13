/* One rule that matters more than all the style rules put together.

   `no-undef` catches a reference to something that does not exist in scope.
   Three bugs reached a running application this way, all of them from a
   scripted edit, all of them building cleanly:

     setChatUnread   called inside a component that never declared it
     busy, guideId   declarations swallowed by an over-eager replacement
     data            read inside a component that takes a ledger id

   None of the six hand-written checks could see any of them, because a
   build does not care about an identifier until the line runs. A linter does
   proper scope analysis, which is exactly the tool for this.

   Style rules are deliberately off. This is not here to have opinions about
   quotes. */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx}", "api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        __BUILD_ID__: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-undef": "error",
      /* A value used above its declaration.

         Valid JavaScript, and a crash the moment it runs: "Cannot access X
         before initialization". The hand-written ordering check missed it
         because it drops callback bodies, and a value read inside a callback
         that runs during render is exactly where this hides. */
      /* Reported, not fatal.

         Most instances are a handler referring to another handler defined
         further down, which is fine: by the time anything calls it, the whole
         component has been evaluated. The dangerous ones run during render,
         and check-tdz-render separates those and fails the build on them. */
      "no-use-before-define": ["warn", { functions: false, classes: false, variables: true }],
      // Unused is a warning: a half-finished edit is worth seeing, not worth
      // stopping a build for.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
