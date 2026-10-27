import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildReproduction, buildRunId, deriveRunId, readCodeProvenance, runScopedReportName } from './run-identity'

const scratch: string[] = []

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-run-id-'))
  scratch.push(directory)
  return directory
}

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true })
})

describe('run ids', () => {
  it('turns a generation timestamp into a sortable file-safe stamp', () => {
    expect(deriveRunId('2026-10-26T15:55:09.346Z')).toBe('20261026T155509Z')
  })

  it('refuses a timestamp that is not a date instead of inventing one', () => {
    expect(() => deriveRunId('not-a-date')).toThrow('INVALID_GENERATED_AT')
  })

  it('keeps two runs of the same second apart', () => {
    const at = '2026-10-26T15:55:09.346Z'
    const first = buildRunId(at, 'turn-4:我住在杭州')
    const second = buildRunId(at, 'turn-4:我会忘记')
    expect(first).not.toBe(second)
    expect(first.startsWith('20261026T155509Z-')).toBe(true)
  })

  it('is stable for the same evidence, so a rerun of identical evidence is recognisably identical', () => {
    const at = '2026-10-26T15:55:09.346Z'
    expect(buildRunId(at, 'same')).toBe(buildRunId(at, 'same'))
  })
})

describe('run-scoped report names', () => {
  it('inserts the run id before the extension, so runs cannot replace each other', () => {
    expect(runScopedReportName('real-provider-conversation-report.json', '20261026T155509Z-a1b2c3'))
      .toBe('real-provider-conversation-report.20261026T155509Z-a1b2c3.json')
  })

  it('rejects a name that is not a json report', () => {
    expect(() => runScopedReportName('report.txt', 'run')).toThrow('INVALID_REPORT_NAME')
  })
})

describe('code provenance', () => {
  it('says unknown rather than guessing when the directory is not a repository', () => {
    expect(readCodeProvenance(scratchDirectory())).toEqual({ codeCommit: null, codeState: 'unknown' })
  })

  it('distinguishes a committed tree from one with uncommitted edits', () => {
    const directory = scratchDirectory()
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: directory, stdio: 'ignore' })
    }
    git(['init', '-q'])
    git(['config', 'user.email', 'evaluation@example.invalid'])
    git(['config', 'user.name', 'evaluation'])
    writeFileSync(join(directory, 'file.txt'), 'first\n', 'utf8')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'first'])

    expect(readCodeProvenance(directory).codeState).toBe('clean')
    writeFileSync(join(directory, 'file.txt'), 'changed\n', 'utf8')
    expect(readCodeProvenance(directory).codeState).toBe('dirty')
  })
})

describe('reproduction block', () => {
  it('records the run id, the code state and the fact that sampling is the provider default', () => {
    const reproduction = buildReproduction('2026-10-26T15:55:09.346Z', 'seed', scratchDirectory())
    expect(reproduction.runId.startsWith('20261026T155509Z-')).toBe(true)
    expect(reproduction.codeCommit).toBeNull()
    expect(reproduction.codeState).toBe('unknown')
    expect(reproduction.sampling).toBe('provider-default')
  })
})
