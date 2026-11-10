import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/*.test.{ts,mjs}'],
    reporters: ['default', 'json'],
    outputFile: { json: 'quality/.work/unit.json' },
    coverage: { include: ['src/**/*.{ts,tsx}'], reporter: ['text-summary', 'json-summary'] },
  },
})
