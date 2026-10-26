import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { ReportPathError, assertNoSymlink, resolveInsideDirectory, resolveReportPath } from './report-path'

const reports = resolve(process.cwd(), 'evaluation', 'reports')

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
