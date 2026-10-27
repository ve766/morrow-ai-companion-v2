import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * Identity for a real-model evaluation run.
 *
 * The real-provider report was written to one fixed filename, so every verified
 * run replaced the previous one. Five runs against the same model produced five
 * different replies to the same question; only the last survived on disk, while
 * two documents went on quoting the first. Nothing was fabricated, but the
 * quoted evidence had been destroyed, so a reader could not tell a superseded
 * observation from a current one.
 *
 * A run therefore carries an identifier a document can cite, and its file name
 * is derived from that identifier so a later run cannot land on top of it.
 */

/** Parameters that are not recorded anywhere else but decide the output. */
export interface RealRunReproduction {
  /** Unique per run; derived from the generation time and a content digest. */
  runId: string
  /** `git rev-parse HEAD`, or null when git is unavailable (packaged app). */
  codeCommit: string | null
  /** A commit id alone does not describe a dirty tree, so both are recorded. */
  codeState: 'clean' | 'dirty' | 'unknown'
  /**
   * The client deliberately sends no sampling parameters, so the server default
   * applies. That is why the same request can answer differently on two runs,
   * and it is stated here instead of being left for a reader to infer.
   */
  sampling: 'provider-default'
}

/** `2026-10-26T15:55:09.346Z` -> `20261026T155509Z`. */
export function deriveRunId(generatedAt: string): string {
  const parsed = new Date(generatedAt)
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_GENERATED_AT')
  return generatedAt.replace(/[-:]/gu, '').replace(/\.\d+/u, '')
}

/**
 * Timestamp plus a short digest of the evidence itself. The timestamp keeps
 * reports sortable by name; the digest keeps two runs inside the same second
 * from colliding, which a bare timestamp would allow.
 */
export function buildRunId(generatedAt: string, evidenceSeed: string): string {
  const digest = createHash('sha256').update(evidenceSeed).digest('hex').slice(0, 6)
  return `${deriveRunId(generatedAt)}-${digest}`
}

/** `x.json` + run id -> `x.20261026T155509Z-a1b2c3.json`. */
export function runScopedReportName(baseName: string, runId: string): string {
  if (!baseName.endsWith('.json')) throw new Error('INVALID_REPORT_NAME')
  return `${baseName.slice(0, -'.json'.length)}.${runId}.json`
}

function git(args: string[], cwd: string): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000
    })
    return output.trim()
  } catch {
    return null
  }
}

/**
 * Best-effort provenance. The evaluation runs on a developer machine and in CI,
 * both of which have git; a packaged build does not, and `unknown` is the honest
 * answer there rather than a fabricated commit.
 */
export function readCodeProvenance(cwd: string = process.cwd()): Pick<RealRunReproduction, 'codeCommit' | 'codeState'> {
  const commit = git(['rev-parse', 'HEAD'], cwd)
  if (commit === null || !/^[0-9a-f]{40}$/u.test(commit)) return { codeCommit: null, codeState: 'unknown' }
  // Untracked files count. A run whose code is not fully committed cannot be
  // rebuilt from the commit id, so calling that tree "clean" would make the
  // commit a label that does not describe what actually ran.
  const status = git(['status', '--porcelain'], cwd)
  if (status === null) return { codeCommit: commit, codeState: 'unknown' }
  return { codeCommit: commit, codeState: status.length === 0 ? 'clean' : 'dirty' }
}

export function buildReproduction(generatedAt: string, evidenceSeed: string, cwd?: string): RealRunReproduction {
  return {
    runId: buildRunId(generatedAt, evidenceSeed),
    ...readCodeProvenance(cwd),
    sampling: 'provider-default'
  }
}
