import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Each persistence test opens a real SQLite file and applies the full
    // migration set (38 versions and counting). With the default 5s budget the
    // slowest ones time out under parallel load — a machine-speed verdict, not a
    // behaviour one.
    //
    // 60s is a ceiling, not an expectation. It was raised from 20s after two
    // suites were run concurrently: every failure in that run was
    // "Test timed out in 20000ms", none was an assertion, and the same tests pass
    // alone in a few seconds. The number is chosen to absorb ~3x contention on
    // this machine, not to hide slow tests: the serial run remains the
    // authoritative signal, and a genuinely hung test still fails.
    testTimeout: 60_000,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      enabled: false
    }
  }
})
