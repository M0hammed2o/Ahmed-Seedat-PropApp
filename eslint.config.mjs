// Flat ESLint config shared across the whole monorepo (root-level, no per-package duplication).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/build/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    settings: {
      // eslint-plugin-import's cycle detection otherwise opens Flow-syntax RN source files
      // under node_modules while building its dependency graph, producing harmless-but-noisy
      // parse warnings (RN itself is JS/Flow, not TS — nothing this project lints directly).
      'import/ignore': ['node_modules'],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'import/no-cycle': ['error', { ignoreExternal: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Service workers run in their own global scope (self/caches/fetch/Response/URL), distinct
    // from both the Node-oriented default the rest of this config assumes and a regular
    // window-scoped browser script -- no `env`/`globals` block existed anywhere in this config
    // before Stage 5's public/sw.js (commercial-launch execution plan) needed one.
    files: ['**/public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    // One-off Node CLI dev scripts (e.g. scripts/make-icons.mjs, Stage 7 rebrand) -- plain
    // console output is the entire point, not something to flag under the app-wide
    // no-console/warn+error-only rule.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
);
