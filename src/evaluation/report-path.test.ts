import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ReportPathError, assertNoSymlink, atomicWriteReport, resolveInsideDirectory, resolveReportPath } from './report-path'

const reports = resolve(process.cwd(), 'evaluation', 'reports')
const scratch: string[] = []

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-report-path-'))
  scratch.push(directory)
  return directory
}

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true })
})

describe('report paths stay inside the reports directory', () => {
  it('accepts a plain json filename', () => {
    expect(resolveReportPath(reports, 'result.json')).toBe(resolve(reports, 'result.json'))
  })

  it('rejects traversal, nesting and absolute paths', () => {
    const rejected = [
      '../secrets.json',
      '..\\secrets.json',
      'nested/result.json',
      'nested\\result.json',
      resolve(reports, 'result.json'),
      '/etc/passwd.json',
      '..',
      '.',
      ''
    ]
    for (const filename of rejected) {
      expect(() => resolveReportPath(reports, filename), filename).toThrow(ReportPathError)
    }
  })

  it('rejects anything that is not a json report', () => {
    for (const filename of ['result.txt', 'result.json.exe', '.json', 'result']) {
      expect(() => resolveReportPath(reports, filename), filename).toThrow(ReportPathError)
    }
  })

  it('lets a dataset fixture live in a subdirectory but never escape it', () => {
    expect(resolveInsideDirectory(reports, 'nested/result.json')).toBe(resolve(reports, 'nested', 'result.json'))
    for (const value of ['../result.json', resolve(reports, 'result.json'), '']) {
      expect(() => resolveInsideDirectory(reports, value), value).toThrow(ReportPathError)
    }
  })

  it('does not follow a symlink under the reports directory', () => {
    // A name that is not on disk has nothing to traverse, so this is the
    // negative control: the guard only fires on a real symlink.
    expect(() => assertNoSymlink(reports, resolve(reports, 'not-created-yet.json'))).not.toThrow()
  })
})

describe('a run record is never replaced', () => {
  it('writes the first report and refuses to replace it, leaving the original bytes intact', () => {
    const directory = scratchDirectory()
    const first = atomicWriteReport(directory, 'run.json', '{"evidence":"first"}\n', { overwrite: false })
    expect(readFileSync(first, 'utf8')).toBe('{"evidence":"first"}\n')

    expect(() => atomicWriteReport(directory, 'run.json', '{"evidence":"second"}\n', { overwrite: false }))
      .toThrow(ReportPathError)
    // The refusal must not have damaged the evidence it protected.
    expect(readFileSync(first, 'utf8')).toBe('{"evidence":"first"}\n')
    // Nor may it leave the temporary file behind.
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('still replaces when the caller opts in, because a stable "latest" report has its uses', () => {
    const directory = scratchDirectory()
    atomicWriteReport(directory, 'latest.json', '{"generation":1}\n', { overwrite: false })
    const path = atomicWriteReport(directory, 'latest.json', '{"generation":2}\n')
    expect(readFileSync(path, 'utf8')).toBe('{"generation":2}\n')
  })
})
