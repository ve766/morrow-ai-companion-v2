/**
 * Code provenance for an evaluation run (Phase 2.2, work package E).
 *
 * A report that says "this is what commit X did" is only true if the working
 * tree matched that commit while the run was executing. The previous benchmark
 * recorded `git rev-parse HEAD`, which silently ignored uncommitted changes and
 * could be overridden by an environment variable.
 *
 * The provenance record therefore captures:
 *   - the commit, and whether it came from git or from an override
 *   - whether the tree was dirty, with a fingerprint of the differences
 *   - whether the same state held before and after the run
 * and marks the run `reproducible: false` when any of that is unknown.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'

export interface CodeProvenance {
  baseSha: string
  headSha: string
  /** The commit the run should be attributed to. */
  codeSha: string
  codeShaSource: 'git' | 'env' | 'unknown'
  workingTreeDirty: boolean
  /** SHA-256 over the status list and the tracked diff, null when clean. */
  workingTreeDiffHash: string | null
  workingTreeFiles: string[]
  reproducible: boolean
  /** Why the run is not reproducible, when it is not. */
  reproducibleReason: string | null
  capturedAt: string
}

export interface ProvenanceOptions {
  cwd?: string
  /** Injected for tests. */
  run?: (command: string, cwd: string) => string
  env?: Record<string, string | undefined>
  now?: () => string
  /**
   * Paths the run itself writes. They are still listed in the record, but they
   * do not make the *source* snapshot unverifiable.
   */
  ignorePaths?: readonly string[]
}

const DEFAULT_IGNORED_PATHS = ['evaluation/reports/'] as const

function defaultRun(command: string, cwd: string): string {
  // trimEnd, not trim: trimming the leading space of the first porcelain line
  // shifts every path by one character.
  return execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+$/u, '')
}

function git(run: (command: string, cwd: string) => string, cwd: string, command: string): string | null {
  try {
    return run(command, cwd)
  } catch {
    return null
  }
}

export function captureProvenance(options: ProvenanceOptions = {}): CodeProvenance {
  const cwd = options.cwd ?? process.cwd()
  const run = options.run ?? defaultRun
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date().toISOString())

  const headSha = git(run, cwd, 'git rev-parse HEAD') ?? 'unknown'
  const status = git(run, cwd, 'git status --porcelain') ?? ''
  const diff = git(run, cwd, 'git diff HEAD') ?? ''
  const ignore = options.ignorePaths ?? DEFAULT_IGNORED_PATHS
  // Porcelain v1 is "XY <path>": trimming the line would shift the offset, so
  // the two status characters and the space are stripped explicitly.
  const entries = status.split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line) => line.length > 3)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }))
  const allFiles = entries.map((entry) => `${entry.status} ${entry.path}`)
  const files = entries
    .filter((entry) => !ignore.some((prefix) => entry.path.startsWith(prefix)))
    .map((entry) => `${entry.status} ${entry.path}`)
    .slice(0, 50)
  const dirty = files.length > 0

  const override = env.MORROW_CODE_SHA
  const codeShaSource: CodeProvenance['codeShaSource'] = override ? 'env' : headSha === 'unknown' ? 'unknown' : 'git'
  const codeSha = override ?? headSha

  const baseSha = env.MORROW_BASE_SHA ?? headSha
  // Only the non-generated files contribute to the fingerprint.
  const sourceStatus = entries
    .filter((entry) => !ignore.some((prefix) => entry.path.startsWith(prefix)))
    .map((entry) => `${entry.status} ${entry.path}`)
    .join('\n')
  const diffHash = dirty ? createHash('sha256').update(`${sourceStatus}\n${diff}`, 'utf8').digest('hex') : null

  const reasons: string[] = []
  if (dirty) reasons.push('working_tree_dirty')
  if (codeShaSource === 'env') reasons.push('code_sha_overridden')
  if (codeShaSource === 'unknown') reasons.push('code_sha_unknown')

  return {
    baseSha,
    headSha,
    codeSha,
    codeShaSource,
    workingTreeDirty: dirty,
    workingTreeDiffHash: diffHash,
    workingTreeFiles: files,
    reproducible: reasons.length === 0,
    reproducibleReason: reasons.length === 0 ? null : reasons.join(','),
    capturedAt: now()
  }
}

/**
 * The state must be identical before and after the run; otherwise the report
 * cannot say which code produced the replies.
 */
export function reconcileProvenance(start: CodeProvenance, end: CodeProvenance, now: string): CodeProvenance {
  const drifted = start.codeSha !== end.codeSha ||
    start.workingTreeDiffHash !== end.workingTreeDiffHash ||
    start.workingTreeDirty !== end.workingTreeDirty
  if (!drifted) return { ...start, capturedAt: now }
  return {
    ...start,
    codeSha: end.codeSha,
    codeShaSource: end.codeShaSource,
    workingTreeDirty: end.workingTreeDirty,
    workingTreeDiffHash: end.workingTreeDiffHash,
    workingTreeFiles: end.workingTreeFiles,
    reproducible: false,
    reproducibleReason: [start.reproducibleReason, 'code_changed_during_run'].filter(Boolean).join(','),
    capturedAt: now
  }
}
