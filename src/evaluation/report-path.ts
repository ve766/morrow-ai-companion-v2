import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Shared report-path handling for the evaluation CLIs.
 *
 * Both entry points used to resolve their output path directly, which meant a
 * mistyped or hostile value could write evidence outside the repository or over
 * an unrelated file. The rules are deliberately narrow: a bare `*.json` name
 * inside one fixed reports directory, no symlink anywhere on the way, and an
 * atomic rename so a crashed run cannot leave a half-written report that looks
 * like a result.
 */

export class ReportPathError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ReportPathError'
  }
}

export function resolveInsideDirectory(directory: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new ReportPathError('PATH_OUTSIDE_DIRECTORY')
  }
  const base = resolve(directory)
  const path = resolve(base, relativePath)
  const rel = relative(base, path)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new ReportPathError('PATH_OUTSIDE_DIRECTORY')
  }
  return path
}

export function resolveReportPath(directory: string, filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) throw new ReportPathError('INVALID_REPORT_NAME')
  if (!filename.endsWith('.json') || filename.includes('/') || filename.includes('\\')) throw new ReportPathError('INVALID_REPORT_NAME')
  // Rejects '.', '..' and a bare '.json': a report needs a real base name.
  if (filename.startsWith('.') || filename === '..') throw new ReportPathError('INVALID_REPORT_NAME')
  return resolveInsideDirectory(directory, filename)
}

export function assertNoSymlink(base: string, path: string): void {
  let current = resolve(base)
  for (const part of relative(resolve(base), path).split(/[\\/]/u)) {
    if (part.length === 0) continue
    current = resolve(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new ReportPathError('SYMLINK_PATH_NOT_ALLOWED')
  }
}

export function atomicWriteReport(
  directory: string,
  filename: string,
  value: string,
  options: { overwrite?: boolean } = {}
): string {
  const path = resolveReportPath(directory, filename)
  mkdirSync(directory, { recursive: true })
  assertNoSymlink(resolve(directory, '..'), directory)
  assertNoSymlink(directory, path)
  const temporary = resolve(directory, `.morrow-report-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx' })
  if (options.overwrite === false) {
    // Evidence for a single run must never replace another run's evidence. The
    // copy uses COPYFILE_EXCL so the check and the write are one operation; a
    // pre-flight existsSync would be a race that silently wins on a collision.
    try {
      copyFileSync(temporary, path, constants.COPYFILE_EXCL)
    } catch (error) {
      rmSync(temporary, { force: true })
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new ReportPathError('REPORT_ALREADY_EXISTS')
      throw error
    }
    rmSync(temporary, { force: true })
    return path
  }
  renameSync(temporary, path)
  return path
}
