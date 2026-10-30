import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Each persistence test opens a real SQLite file and applies the full
    // migration set (25 versions and counting). With the default 5s budget the
    // slowest ones time out under parallel load — a machine-speed verdict, not a
    // behaviour one. 20s is a ceiling, not an expectation: the suite still runs
    // in seconds per file.
    testTimeout: 20_000,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      enabled: false
    }
  }
})
