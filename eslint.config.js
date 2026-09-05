import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['node_modules/**', '.output/**', '.wxt/**', 'tests/fixtures/**', '*.config.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        chrome: 'readonly',
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        globalThis: 'readonly',
        crypto: 'readonly',
        Node: 'readonly',
        Element: 'readonly',
        HTMLElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        SVGSVGElement: 'readonly',
        ShadowRoot: 'readonly',
        MutationObserver: 'readonly',
        MutationRecord: 'readonly',
        ResizeObserver: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        DOMRect: 'readonly',
        URL: 'readonly',
        NodeFilter: 'readonly',
        FrameRequestCallback: 'readonly',
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        preact: 'readonly',
        process: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Handled by tsc with a far better understanding of types.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The project rule: never `any`; narrow from `unknown` instead.
      '@typescript-eslint/no-explicit-any': 'error',
      // Production code must not log directly; use createLogger.
      'no-console': 'error',
      // Preact's runtime ships a dangerouslySetInnerHTML branch, so a
      // string -> DOM sink exists in the bundle whether we use it or not. This
      // rule is what keeps it unreachable: build DOM with document.create*
      // (see src/ui/shared/icons.ts) rather than assigning markup.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned: it would make Preact\'s string -> DOM branch reachable. Build nodes with document.createElement / createElementNS instead.',
        },
      ],
    },
  },
  {
    // The logger is the one place allowed to reach console.
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { 'no-console': 'off' },
  },
];
