import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Real-model context/memory run. Requires a reachable loopback provider
 * (default: Ollama at 127.0.0.1:11434). Exit code 3 means blocked, which is
 * not a pass and not a failure.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'morrow-context-real-'))

try {
  const bundlePath = join(temporaryDirectory, 'run-review-summary.mjs')
  await build({
    entryPoints: [resolve(root, 'src/evaluation/review-cli.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'bundle',
    logLevel: 'silent'
  })
  const result = spawnSync(process.execPath, [bundlePath, ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, MORROW_EVALUATION_ROOT: root },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  process.stderr.write('Review summary could not be produced; no report was produced.\n')
  process.stderr.write(`cause: ${reason}\n`)
  process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
