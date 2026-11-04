import { afterEach, describe, expect, it } from 'vitest'
import { classifyBranch, readGitMetadata, type GitRunner } from './git-metadata'

const original = process.env.MORROW_EVAL_SHA
afterEach(() => {
  if (original === undefined) delete process.env.MORROW_EVAL_SHA
  else process.env.MORROW_EVAL_SHA = original
})

function runner(responses: Record<string, string | Error>): GitRunner {
  return (args) => {
    const key = args.join(' ')
    const value = responses[key]
    if (value instanceof Error) throw value
    if (value === undefined) throw new Error(`unexpected git args: ${key}`)
    return value
  }
}

describe('git evaluation metadata', () => {
  it('reads the actual branch, commit and clean state', () => {
    const metadata = readGitMetadata(runner({
      'rev-parse --abbrev-ref HEAD': 'fix/pr-40-audit-findings\n',
      'rev-parse HEAD': 'abc123\n',
      'status --porcelain': ''
    }))
    expect(metadata).toEqual({
      branch: 'fix/pr-40-audit-findings',
      branchReason: 'ok',
      commit: 'abc123',
      workingTree: 'clean'
    })
  })

  it('reports detached HEAD as null instead of inventing a branch', () => {
    const metadata = readGitMetadata(runner({
      'rev-parse --abbrev-ref HEAD': 'HEAD\n',
      'rev-parse HEAD': 'abc123\n',
      'status --porcelain': ' M file\n'
    }))
    expect(metadata).toMatchObject({ branch: null, branchReason: 'detached', workingTree: 'dirty' })
  })

  it('distinguishes missing git from a failed command', () => {
    const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    const metadata = readGitMetadata(runner({
      'rev-parse --abbrev-ref HEAD': missing,
      'rev-parse HEAD': missing,
      'status --porcelain': missing
    }))
    expect(metadata).toMatchObject({ branch: null, branchReason: 'git_unavailable', commit: 'unknown', workingTree: 'unknown' })

    const failed = readGitMetadata(runner({
      'rev-parse --abbrev-ref HEAD': new Error('not a repository'),
      'rev-parse HEAD': new Error('not a repository'),
      'status --porcelain': new Error('not a repository')
    }))
    expect(failed).toMatchObject({ branch: null, branchReason: 'command_failed', commit: 'unknown', workingTree: 'unknown' })
  })

  it('keeps an explicit commit override while still reading the branch', () => {
    process.env.MORROW_EVAL_SHA = 'override-sha'
    const metadata = readGitMetadata(runner({
      'rev-parse --abbrev-ref HEAD': 'audit/pr-40-repair-independent-review\n',
      'status --porcelain': ''
    }))
    expect(metadata).toMatchObject({ branch: 'audit/pr-40-repair-independent-review', commit: 'override-sha', workingTree: 'clean' })
  })

  it('classifies an empty branch name as detached', () => {
    expect(classifyBranch('  ')).toEqual({ branch: null, branchReason: 'detached' })
    expect(classifyBranch('main')).toEqual({ branch: 'main', branchReason: 'ok' })
  })
})
