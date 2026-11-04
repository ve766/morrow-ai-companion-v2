/**
 * Git identity for evaluation evidence (AUD45-P2-05).
 *
 * The commit is the code identity; the branch is auxiliary. Earlier generators
 * hard-coded the branch of the stage they were written for, so a result produced
 * on the Stage 4 branch could claim it came from the Stage 5 branch. This module
 * reads the actual checkout and reports an explicit reason when it cannot:
 *
 *   - a named branch        → branch: <name>,  reason: ok
 *   - detached HEAD / HEAD  → branch: null,    reason: detached
 *   - git missing           → branch: null,    reason: git_unavailable
 *   - any other failure     → branch: null,    reason: command_failed
 *
 * `commit` and `workingTree` are collected independently so a failure to read
 * the branch does not erase the code identity.
 */
import { execFileSync } from 'node:child_process'

export type BranchReason = 'ok' | 'detached' | 'git_unavailable' | 'command_failed'
export type WorkingTreeState = 'clean' | 'dirty' | 'unknown'

export interface GitMetadata {
  branch: string | null
  branchReason: BranchReason
  commit: string
  workingTree: WorkingTreeState
}

export type GitRunner = (args: string[]) => string

function defaultRunner(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

export function classifyBranch(value: string): { branch: string | null; branchReason: BranchReason } {
  const name = value.trim()
  if (name.length === 0 || name === 'HEAD') return { branch: null, branchReason: 'detached' }
  return { branch: name, branchReason: 'ok' }
}

export function readGitMetadata(run: GitRunner = defaultRunner): GitMetadata {
  let branch: string | null = null
  let branchReason: BranchReason = 'command_failed'
  try {
    const classified = classifyBranch(run(['rev-parse', '--abbrev-ref', 'HEAD']))
    branch = classified.branch
    branchReason = classified.branchReason
  } catch (error) {
    branchReason = (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
      ? 'git_unavailable'
      : 'command_failed'
  }

  let commit = process.env.MORROW_EVAL_SHA ?? 'unknown'
  if (!process.env.MORROW_EVAL_SHA) {
    try {
      const resolved = run(['rev-parse', 'HEAD']).trim()
      if (resolved.length > 0) commit = resolved
    } catch {
      commit = 'unknown'
    }
  }

  let workingTree: WorkingTreeState = 'unknown'
  try {
    workingTree = run(['status', '--porcelain']).trim().length > 0 ? 'dirty' : 'clean'
  } catch {
    workingTree = 'unknown'
  }

  return { branch, branchReason, commit, workingTree }
}
