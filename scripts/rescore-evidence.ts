/**
 * Re-score an evidence experiment with the current evaluator (Phase 2.3).
 *
 * The replies are fixed; only the assessment is recomputed. This exists because
 * the cloud run surfaced three evaluator defects (full-width punctuation read as
 * negation, "我没有保存" not recognised as an admission, source phrasing read as
 * a time shift). Re-running the model to fix the scorer would change the sample
 * and hide the fact that the *answers* did not change.
 *
 *   node /tmp/rescore.cjs evaluation/reports/phase23-spark-A-....json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { evaluateAnswerEvidence } from '../src/cognition/answer-evidence-evaluation'
import { EVIDENCE_SCENARIOS } from '../src/evaluation/evidence-scenarios'
import { captureProvenance } from '../src/evaluation/code-provenance'

interface StoredRun {
  runId: string
  scenarioId: string
  reply: string
  callSucceeded: boolean
  auto: { outcome: string | null; scored: boolean }
}

interface StoredReport {
  condition: { id: string; presentation: string; variant: string }
  runs: StoredRun[]
  counts: Record<string, number>
  provenance: { codeSha: string }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Pass one or more phase23 experiment JSON files.')
  process.exit(2)
}

function referenceCheck(scenarioId: string, reply: string): { matched: boolean; forbiddenHit: string | null } {
  const scenario = EVIDENCE_SCENARIOS.find((item) => item.id === scenarioId)
  if (!scenario) return { matched: false, forbiddenHit: null }
  const normalized = reply.normalize('NFKC')
  return {
    matched: scenario.referenceTerms.some((term) => normalized.includes(term)),
    forbiddenHit: scenario.forbiddenTerms.find((term) => normalized.includes(term)) ?? null
  }
}

const summaries: unknown[] = []
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8')) as StoredReport
  const rescored = report.runs.map((run) => {
    const scenario = EVIDENCE_SCENARIOS.find((item) => item.id === run.scenarioId)
    if (!scenario) throw new Error(`unknown scenario ${run.scenarioId}`)
    const ids = scenario.memories.map((_, index) => `${run.runId}-m${index}`)
    const assessment = evaluateAnswerEvidence({
      reply: run.reply,
      callSucceeded: run.callSucceeded,
      memories: scenario.memories.map((memory, index) => ({
        id: ids[index]!,
        content: memory.text,
        ...(scenario.conflicting ? { status: 'unresolved' as const, conflictWith: ids.filter((id) => id !== ids[index]) } : {})
      })),
      question: scenario.question
    })
    return {
      runId: run.runId,
      scenarioId: run.scenarioId,
      callSucceeded: run.callSucceeded,
      replyCharacters: run.reply.length,
      before: run.auto.outcome,
      after: assessment.outcome,
      scored: assessment.scored,
      detail: assessment.detail,
      dimensions: assessment.dimensions,
      conflict: assessment.conflict.outcome,
      reference: referenceCheck(run.scenarioId, run.reply)
    }
  })

  const byScenario = Object.fromEntries(EVIDENCE_SCENARIOS.map((scenario) => {
    const items = rescored.filter((item) => item.scenarioId === scenario.id)
    return [scenario.id, {
      runs: items.length,
      referenceMatched: items.filter((item) => item.reference.matched).length,
      forbiddenHit: items.filter((item) => item.reference.forbiddenHit !== null).length,
      scored: items.filter((item) => item.scored).length,
      usedCorrectly: items.filter((item) => item.after === 'used_correctly').length,
      reasonableUnknown: items.filter((item) => item.after === 'reasonable_unknown').length,
      unsupported: items.filter((item) => item.after === 'unsupported_answer').length,
      conflictPass: items.filter((item) => item.conflict === 'pass').length,
      contradictions: items.filter((item) => item.after === 'contradicts_evidence').length,
      notScorable: items.filter((item) => item.after === 'not_scorable').length,
      changed: items.filter((item) => item.after !== item.before).length
    }]
  }))

  const output = {
    schemaVersion: 1,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    source: basename(file),
    condition: report.condition,
    codeSha: report.provenance.codeSha,
    evaluator: 'answer-evidence-evaluation@schema3 (re-scored offline)',
    scorer: captureProvenance(),
    note: 'Replies are unchanged; only the assessment was recomputed with the corrected evaluator.',
    totals: {
      runs: rescored.length,
      scored: rescored.filter((item) => item.scored).length,
      usedCorrectly: rescored.filter((item) => item.after === 'used_correctly').length,
      reasonableUnknown: rescored.filter((item) => item.after === 'reasonable_unknown').length,
      unsupported: rescored.filter((item) => item.after === 'unsupported_answer').length,
      conflictPass: rescored.filter((item) => item.conflict === 'pass').length,
      contradictions: rescored.filter((item) => item.after === 'contradicts_evidence').length,
      notScorable: rescored.filter((item) => item.after === 'not_scorable').length,
      changed: rescored.filter((item) => item.after !== item.before).length
    },
    byScenario,
    runs: rescored
  }
  const outputPath = join('evaluation', 'reports', `phase23-rescored-${report.condition.id}.${output.runId}.json`)
  mkdirSync(join('evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8')
  summaries.push({ condition: report.condition.id, totals: output.totals, byScenario, report: outputPath })
}

console.log(JSON.stringify(summaries))
