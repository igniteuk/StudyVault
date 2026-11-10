import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'coverage/**', 'quality/.work/**', 'playwright-report/**', 'test-results/**', '.npm-cache/**', '.wrangler/**'] },
  { ...js.configs.recommended, files: ['**/*.js', '**/*.mjs'] },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', setTimeout: 'readonly' } } },
  ...tseslint.configs.recommended,
]
