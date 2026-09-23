import { defineConfig } from 'vitest/config'

// The harness packages these tests touch are ordinary devDependencies, so
// ordinary Node resolution finds them: the suite runs from a clean checkout
// with nothing but `pnpm install`.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
