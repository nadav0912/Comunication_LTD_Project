'use strict';

// Minimal ESLint 9 flat config (SPEC.md §2; §17 Q3 marks lint optional). No plugins, no extra deps.
// Two environments: server/scripts/tests are CommonJS Node; public/js is browser <script> (plan A7).

const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  __dirname: 'readonly', __filename: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', URL: 'readonly', AbortSignal: 'readonly',
};

const browserGlobals = {
  window: 'readonly', document: 'readonly', fetch: 'readonly',
  setTimeout: 'readonly', console: 'readonly', encodeURIComponent: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browserGlobals },
  },
];
