import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Flat config (ESLint 9). Mirrors the rule set from the previous .eslintrc.cjs:
// recommended JS + TS rules, console allowed (this is a CLI), and `any` left on
// for now — tightening it is tracked separately as a typing pass.
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.config.*', 'jest.config.cjs'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `cond ? a() : b()` and `cond && a()` are used as control flow in the
      // spawn close handlers — allow them; still flag genuinely dead expressions.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  }
);
