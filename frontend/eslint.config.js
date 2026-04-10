import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

const sharedGlobals = {
  console: "readonly",
  window: "readonly",
  document: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  fetch: "readonly",
  FormData: "readonly",
  HTMLElement: "readonly",
  HTMLInputElement: "readonly",
  HTMLTextAreaElement: "readonly",
  HTMLSpanElement: "readonly",
  MouseEvent: "readonly",
  KeyboardEvent: "readonly",
  WheelEvent: "readonly",
  Event: "readonly",
  HTMLDivElement: "readonly",
  DragEvent: "readonly",
  ClipboardEvent: "readonly",
  Node: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FileList: "readonly",
  navigator: "readonly",
  performance: "readonly",
  crypto: "readonly",
  AbortController: "readonly",
  WebSocket: "readonly",
  MessageEvent: "readonly",
  CloseEvent: "readonly",
  SVGPathElement: "readonly",
  Range: "readonly",
  URL: "readonly",
  structuredClone: "readonly",
  Blob: "readonly",
  ArrayBuffer: "readonly",
  ReadableStream: "readonly",
};

export default [
  eslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: sharedGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        parser: tsparser,
        extraFileExtensions: [".vue"],
      },
      globals: sharedGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "tests/", ".vite/", "public/"],
  },
];
