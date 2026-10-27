import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { atomicWriteReport, resolveReportPath } from './report-path'
import type { ContextMemoryRealReport } from './context-memory-real'
import type { RealVerdict } from './verdict'

/**
 * Human review is a second record, never a correction of the first.
 *
 * The automatic verdict and the human verdict answer different questions:
 * "did a mechanical rule pass" and "was the behaviour right". Merging them
 * would let a reviewer silently raise a score, and would let a rerun silently
 * discard a reviewer. So a review lives in its own file, is written once, and
 * is joined only when someone asks for the combined view.
 */

export interface HumanCaseReview {
  caseId: string
  verdict: RealVerdict
  /** What the reviewer saw in the reply that the rule could not see. */
  note: string
}

export interface HumanReviewFile {
  schemaVersion: 1
  kind: 'human_review'
  /** Must equal the report's run id; a review of a different run is not a review. */
  runId: string
  reviewedAt: string
  reviewer: { kind: 'human' | 'agent'; name: string }
  cases: HumanCaseReview[]
}

export class HumanReviewError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'HumanReviewError'
  }
}

const reviewVerdicts: readonly RealVerdict[] = ['pass', 'fail', 'uncertain', 'needs_review']

export function reviewFileName(runId: string): string {
  if (!/^[A-Za-z0-9-]{8,64}$/u.test(runId)) throw new HumanReviewError('INVALID_RUN_ID')
  // Deliberately different from the report name so no run can overwrite a review.
  return `${runId}.review.json`
}

export function parseHumanReview(value: unknown): HumanReviewFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HumanReviewError('INVALID_REVIEW')
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1 || candidate.kind !== 'human_review') throw new HumanReviewError('INVALID_REVIEW')
  if (typeof candidate.runId !== 'string') throw new HumanReviewError('INVALID_REVIEW')
  if (typeof candidate.reviewedAt !== 'string' || !Number.isFinite(Date.parse(candidate.reviewedAt))) throw new HumanReviewError('INVALID_REVIEW')
  const reviewer = candidate.reviewer
  if (typeof reviewer !== 'object' || reviewer === null) throw new HumanReviewError('INVALID_REVIEW')
  const { kind, name } = reviewer as Record<string, unknown>
  if (kind !== 'human' && kind !== 'agent') throw new HumanReviewError('INVALID_REVIEW')
  if (typeof name !== 'string' || name.length === 0) throw new HumanReviewError('INVALID_REVIEW')
  if (!Array.isArray(candidate.cases)) throw new HumanReviewError('INVALID_REVIEW')
  const seen = new Set<string>()
  const cases = candidate.cases.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new HumanReviewError('INVALID_REVIEW')
    const { caseId, verdict, note } = entry as Record<string, unknown>
    if (typeof caseId !== 'string' || caseId.length === 0) throw new HumanReviewError('INVALID_REVIEW')
    if (seen.has(caseId)) throw new HumanReviewError('DUPLICATE_CASE_REVIEW')
    seen.add(caseId)
    if (typeof verdict !== 'string' || !reviewVerdicts.includes(verdict as RealVerdict)) throw new HumanReviewError('INVALID_REVIEW')
    if (typeof note !== 'string' || note.length === 0) throw new HumanReviewError('INVALID_REVIEW')
    return { caseId, verdict: verdict as RealVerdict, note }
  })
  return {
    schemaVersion: 1,
    kind: 'human_review',
    runId: candidate.runId,
    reviewedAt: candidate.reviewedAt,
    reviewer: { kind, name },
    cases
  }
}

export function loadHumanReview(directory: string, runId: string): HumanReviewFile | null {
  const path = resolveReportPath(directory, reviewFileName(runId))
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const review = parseHumanReview(JSON.parse(raw))
  if (review.runId !== runId) throw new HumanReviewError('REVIEW_RUN_MISMATCH')
  return review
}

export function writeHumanReview(directory: string, review: HumanReviewFile): string {
  const parsed = parseHumanReview(review)
  // overwrite: false - a second review of the same run is a new run, not an edit.
  return atomicWriteReport(directory, reviewFileName(parsed.runId), `${JSON.stringify(parsed, null, 2)}\n`, { overwrite: false })
}

export interface ReviewRow {
  caseId: string
  capability: string
  auto: RealVerdict
  human: RealVerdict | null
  /** True when the automatic verdict and the reviewer disagree on pass/fail. */
  disagrees: boolean
  autoRationale: string
  humanNote: string | null
}

export interface ReviewSummary {
  runId: string
  reviewer: string | null
  auto: Record<RealVerdict, number>
  human: Record<RealVerdict, number>
  /** Cases a rule called a pass that a reviewer did not. The false-positive count. */
  autoPassRejected: number
  /** Cases a rule called a fail that a reviewer did not. The false-negative count. */
  autoFailRejected: number
  unreviewed: number
  rows: ReviewRow[]
}

function emptyCounts(): Record<RealVerdict, number> {
  return { pass: 0, fail: 0, uncertain: 0, needs_review: 0 }
}

/**
 * Joins a report and its review without changing either input. A case the
 * reviewer did not cover keeps `human: null` and is counted as unreviewed
 * rather than being assumed to agree.
 */
export function joinReview(report: ContextMemoryRealReport, review: HumanReviewFile | null): ReviewSummary {
  if (review && review.runId !== report.reproduction.runId) throw new HumanReviewError('REVIEW_RUN_MISMATCH')
  const byCase = new Map((review?.cases ?? []).map((entry) => [entry.caseId, entry]))
  const auto = emptyCounts()
  const human = emptyCounts()
  const rows: ReviewRow[] = []
  let autoPassRejected = 0
  let autoFailRejected = 0
  for (const item of report.cases) {
    const verdict = item.verdict
    auto[verdict] += 1
    const reviewed = byCase.get(item.id) ?? null
    if (reviewed) human[reviewed.verdict] += 1
    if (reviewed && reviewed.verdict !== verdict) {
      if (verdict === 'pass' && reviewed.verdict !== 'pass') autoPassRejected += 1
      if (verdict === 'fail' && reviewed.verdict !== 'fail') autoFailRejected += 1
    }
    rows.push({
      caseId: item.id,
      capability: item.capability,
      auto: verdict,
      human: reviewed?.verdict ?? null,
      disagrees: reviewed !== null && reviewed.verdict !== verdict,
      autoRationale: item.verdictRationale,
      humanNote: reviewed?.note ?? null
    })
  }
  const covered = new Set(rows.filter((row) => row.human !== null).map((row) => row.caseId)).size
  return {
    runId: report.reproduction.runId,
    reviewer: review ? `${review.reviewer.name} (${review.reviewer.kind})` : null,
    auto,
    human,
    autoPassRejected,
    autoFailRejected,
    unreviewed: rows.length - covered,
    rows
  }
}

export function reviewDirectory(root: string): string {
  return resolve(root, 'evaluation', 'reviews')
}
