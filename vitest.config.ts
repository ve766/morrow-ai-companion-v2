import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Several suites are heavy (backup/restore, Electron-free app flows) and the
    // optional ONNX model adds ~2 s per case when it is installed locally. The
    // default 5 s budget produced intermittent timeouts under parallel workers,
    // which is a measurement artefact rather than a hang.
    testTimeout: 20_000,
    coverage: {
      enabled: false
    }
  }
})
