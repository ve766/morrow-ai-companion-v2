import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Prints the full decision path for one benchmark case.
//
//   node scripts/diagnose-retrieval-case.mjs --dataset <fixture.json> --case <caseId> [--no-encoder]
//
// The bundle is written inside the repository so the optional embedding runtime
// can resolve from ./node_modules at runtime.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workDirectory = join(root, '.evaluation-tmp')
const bundlePath = join(workDirectory, 'run-diagnostic.mjs')

try {
  await mkdir(workDirectory, { recursive: true })
  await build({
    entryPoints: [resolve(root, 'src/evaluation/retrieval-diagnostic-cli.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'bundle',
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
  process.stderr.write(`Diagnostic could not complete: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
