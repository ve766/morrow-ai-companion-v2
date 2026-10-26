import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'morrow-real-provider-'))

try {
  const bundlePath = join(temporaryDirectory, 'run-real-provider.mjs')
  await build({
    entryPoints: [resolve(root, 'src/evaluation/real-provider-cli.ts')],
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
} catch {
  process.stderr.write('Real-provider verification could not run; nothing was verified.\n')
  process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
