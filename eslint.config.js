import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // `.worktrees/` holds detached checkouts of other branches. Linting them
  // reports another branch's code as this one's errors, which is how
  // `eslint .` came to have 14 failures that belong to nobody. (Open question 2
  // of PRE_R34_TOWN_3D_CONSOLIDATION.md; answered here because the playtest
  // gate needs `npm run lint` to mean something.)
  { ignores: ['dist/', 'node_modules/', 'legacy/', 'supabase/', 'services/', '.worktrees/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      // R08 — Close HTML injection paths.
      // v-html and innerHTML render untrusted strings as DOM; use {{ }} instead.
      'vue/no-v-html': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Do not assign innerHTML — use textContent or Vue template interpolation (R08).',
        },
      ],
    },
  },
  {
    // R21 — Tester isolation.
    // console.* is banned in frontend src/ — use devLog/devWarn from shared/utils/devTools.ts,
    // which are stripped to no-ops in production builds (import.meta.env.DEV guard).
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Build-time tooling (R32.1 battle catalog pipeline) runs in Node, not in a
    // browser: it may use `process`, `Buffer` and stdout.
    files: ['scripts/**/*.{mjs,js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
