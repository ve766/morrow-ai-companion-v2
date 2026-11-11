import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Runs the retrieval benchmark against the production retrieval strategies.
// Bundled with esbuild for the same reason the other offline runners are: the
// project is ESM TypeScript with no runtime transpiler on the Node side.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'morrow-retrieval-benchmark-'))

try {
  const bundlePath = join(temporaryDirectory, 'run-benchmark.mjs')
  await build({
    entryPoints: [resolve(root, 'src/evaluation/retrieval-benchmark-cli.ts')],
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
  process.stderr.write(`Retrieval benchmark could not complete: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
