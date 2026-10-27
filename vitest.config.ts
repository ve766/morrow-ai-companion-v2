import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // The default 5000ms is too tight for the persistence suites. A single
    // migration test costs 320-410ms in isolation, but each one really does
    // open SQLite, run a full v1..v15 upgrade and fsync on Windows. When a few
    // such files share the pool the same test can cross 5s without anything
    // being wrong, which showed up as intermittent migrations.test.ts timeouts
    // on windows-latest. 20s keeps a hard ceiling on genuine hangs while
    // giving the I/O-bound suites room. No assertion, timeout-skip or
    // concurrency setting is changed.
    testTimeout: 20_000,
    coverage: {
      enabled: false
    }
  }
})
