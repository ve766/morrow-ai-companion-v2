import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Runs the semantic-retrieval comparison against the production strategies.
//
// The bundle is written INSIDE the repository rather than into the OS temp
// directory: the optional embedding runtime is marked external so that a plain
// dynamic import can resolve it from ./node_modules at runtime, which only works
// if the importing file lives under the project root.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workDirectory = join(root, '.evaluation-tmp')
const bundlePath = join(workDirectory, 'run-semantic-comparison.mjs')

try {
  await mkdir(workDirectory, { recursive: true })
  await build({
    entryPoints: [resolve(root, 'src/evaluation/semantic-retrieval-cli.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'bundle',
    // Native / heavy optional runtime: resolved at runtime, never bundled.
    external: ['@huggingface/transformers', 'onnxruntime-node', 'onnxruntime-web', 'sharp'],
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
  process.stderr.write(`Semantic comparison could not complete: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
