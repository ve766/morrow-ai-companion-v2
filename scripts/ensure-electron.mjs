import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const electronDirectory = join(root, 'node_modules', 'electron')
const installScript = join(electronDirectory, 'install.js')
const pathFile = join(electronDirectory, 'path.txt')
const binary = process.platform === 'win32'
  ? join(electronDirectory, 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? join(electronDirectory, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : join(electronDirectory, 'dist', 'electron')

if (existsSync(pathFile) && existsSync(binary)) process.exit(0)

if (!existsSync(installScript)) {
  console.error('Electron is not installed; cannot prepare its runtime binary.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [installScript], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
