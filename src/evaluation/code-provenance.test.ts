import { describe, expect, it } from 'vitest'
import { captureProvenance, reconcileProvenance } from './code-provenance'

/**
 * Phase 2.2 E: a run may only be called reproducible when the recorded commit
 * is the code that actually ran and the tree did not change under it.
 */

function fakeGit(outputs: Record<string, string | Error>) {
  return (command: string): string => {
    const value = outputs[command]
    if (value === undefined) throw new Error(`unexpected command ${command}`)
    if (value instanceof Error) throw value
    return value
  }
}

describe('phase 2.2 E: code provenance', () => {
  it('records a clean tree as reproducible and attributes the commit from git', () => {
    const provenance = captureProvenance({
      env: {},
      now: () => '2026-10-28T00:00:00.000Z',
      run: fakeGit({ 'git rev-parse HEAD': 'abc123', 'git status --porcelain': '', 'git diff HEAD': '' })
    })
    expect(provenance).toMatchObject({
      headSha: 'abc123',
      codeSha: 'abc123',
      codeShaSource: 'git',
      workingTreeDirty: false,
      workingTreeDiffHash: null,
      reproducible: true,
      reproducibleReason: null
    })
  })

  it('marks a dirty tree, keeps the files and fingerprints the diff', () => {
    const provenance = captureProvenance({
      env: {},
      run: fakeGit({
        'git rev-parse HEAD': 'abc123',
        'git status --porcelain': ' M src/cognition/answer-evidence-evaluation.ts\n?? scripts/new.ts',
        'git diff HEAD': 'diff --git a/src/... b/src/...'
      })
    })
    expect(provenance.workingTreeDirty).toBe(true)
    expect(provenance.workingTreeFiles).toEqual(['M src/cognition/answer-evidence-evaluation.ts', '?? scripts/new.ts'])
    expect(provenance.workingTreeDiffHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(provenance.reproducible).toBe(false)
    expect(provenance.reproducibleReason).toContain('working_tree_dirty')
  })

  it('does not count the run\'s own report files as a dirty source tree', () => {
    const provenance = captureProvenance({
      env: {},
      run: fakeGit({
        'git rev-parse HEAD': 'abc123',
        'git status --porcelain': '?? evaluation/reports/phase22-A-1.json',
        'git diff HEAD': ''
      })
    })
    expect(provenance.workingTreeDirty).toBe(false)
    expect(provenance.reproducible).toBe(true)
  })

  it('still counts a source edit next to a generated report', () => {
    const provenance = captureProvenance({
      env: {},
      run: fakeGit({
        'git rev-parse HEAD': 'abc123',
        'git status --porcelain': '?? evaluation/reports/phase22-A-1.json\n M src/app/companion-service.ts',
        'git diff HEAD': 'diff'
      })
    })
    expect(provenance.workingTreeDirty).toBe(true)
    expect(provenance.workingTreeFiles).toEqual(['M src/app/companion-service.ts'])
  })

  it('does not trust an environment override', () => {
    const provenance = captureProvenance({
      env: { MORROW_CODE_SHA: 'deadbeef' },
      run: fakeGit({ 'git rev-parse HEAD': 'abc123', 'git status --porcelain': '', 'git diff HEAD': '' })
    })
    expect(provenance.codeSha).toBe('deadbeef')
    expect(provenance.codeShaSource).toBe('env')
    expect(provenance.reproducible).toBe(false)
    expect(provenance.reproducibleReason).toContain('code_sha_overridden')
  })

  it('does not claim reproducibility when git is unavailable', () => {
    const provenance = captureProvenance({
      env: {},
      run: fakeGit({ 'git rev-parse HEAD': new Error('not a git repository') })
    })
    expect(provenance.codeShaSource).toBe('unknown')
    expect(provenance.codeSha).toBe('unknown')
    expect(provenance.reproducible).toBe(false)
  })

  it('rejects a run whose tree changed while it was executing', () => {
    const start = captureProvenance({
      env: {},
      run: fakeGit({ 'git rev-parse HEAD': 'abc123', 'git status --porcelain': '', 'git diff HEAD': '' })
    })
    const end = captureProvenance({
      env: {},
      run: fakeGit({ 'git rev-parse HEAD': 'abc123', 'git status --porcelain': ' M src/app/companion-service.ts', 'git diff HEAD': 'diff' })
    })
    const merged = reconcileProvenance(start, end, '2026-10-28T00:10:00.000Z')
    expect(merged.reproducible).toBe(false)
    expect(merged.reproducibleReason).toContain('code_changed_during_run')
    expect(merged.workingTreeDirty).toBe(true)
  })

  it('keeps a stable run reproducible after reconciliation', () => {
    const start = captureProvenance({
      env: {},
      run: fakeGit({ 'git rev-parse HEAD': 'abc123', 'git status --porcelain': '', 'git diff HEAD': '' })
    })
    const merged = reconcileProvenance(start, start, '2026-10-28T00:10:00.000Z')
    expect(merged.reproducible).toBe(true)
    expect(merged.capturedAt).toBe('2026-10-28T00:10:00.000Z')
  })
})
