/**
 * Topic-identity development-set report (Stage 2 B5 fix).
 *
 *   npm run eval:topic-identity
 *
 * Prints every labelled pair with its score and decision, then the confusion
 * matrix, precision/recall and the false positives / false negatives by name.
 * The thresholds are NOT fitted here: the module owns them, and this script
 * only reports what they do on the labelled set. That keeps the report honest —
 * a script that re-picks thresholds until everything passes reports nothing.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchTopicTexts, TOPIC_AMBIGUOUS_THRESHOLD, TOPIC_IDENTITY_VERSION, TOPIC_SAME_THRESHOLD } from '../../src/self-model/topic-identity'

interface DevPair {
  id: string
  kind: string
  left: string
  right: string
  label: 'same' | 'different'
  note: string
}

interface DevSet {
  version: string
  pairs: DevPair[]
}

const path = resolve(process.cwd(), 'evals/stage-2/topic-identity-devset.json')
const devSet = JSON.parse(readFileSync(path, 'utf8')) as DevSet

let truePositive = 0
let falsePositive = 0
let trueNegative = 0
let falseNegative = 0
let ambiguous = 0
const failures: Array<{ id: string; kind: string; expected: string; got: string; score: number; reason: string }> = []

// The gate is precision, not recall, and that is a deliberate product choice:
// a false merge writes a wrong interest into long-term memory permanently,
// while a missed merge only delays promotion. Recall is reported and tracked
// but does not fail the run, otherwise the known miss below would make the
// script permanently red and the signal would be ignored.
const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()

const rows = devSet.pairs.map((pair) => {
  const match = matchTopicTexts(pair.left, pair.right)
  // Ambiguous counts as "not merged": that is the behaviour the service uses,
  // so it must be scored as a negative decision, not hidden as a skip.
  const predicted = match.decision === 'same' ? 'same' : 'different'
  if (match.decision === 'ambiguous') ambiguous += 1
  if (predicted === 'same' && pair.label === 'same') truePositive += 1
  else if (predicted === 'same' && pair.label === 'different') falsePositive += 1
  else if (predicted === 'different' && pair.label === 'different') trueNegative += 1
  else falseNegative += 1
  if (predicted !== pair.label) {
    failures.push({ id: pair.id, kind: pair.kind, expected: pair.label, got: match.decision, score: match.score, reason: match.reason })
  }
  return {
    id: pair.id,
    kind: pair.kind,
    label: pair.label,
    decision: match.decision,
    score: match.score,
    reason: match.reason,
    signals: match.signals
  }
})

const precision = truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive)
const recall = truePositive + falseNegative === 0 ? null : truePositive / (truePositive + falseNegative)

console.log(`topic-identity: ${TOPIC_IDENTITY_VERSION}  devset: ${devSet.version}  pairs: ${devSet.pairs.length}`)
console.log(`thresholds: same >= ${TOPIC_SAME_THRESHOLD}  ambiguous >= ${TOPIC_AMBIGUOUS_THRESHOLD}`)
console.log('')
console.log('id    kind                          label      decision    score   reason')
for (const row of rows) {
  console.log(`${row.id.padEnd(5)} ${row.kind.padEnd(29)} ${row.label.padEnd(10)} ${row.decision.padEnd(11)} ${row.score.toFixed(4)}  ${row.reason}`)
}
console.log('')
console.log('confusion matrix (rows = labelled, columns = predicted)')
console.log(`  same->same ${truePositive}   same->different ${falseNegative}`)
console.log(`  diff->same ${falsePositive}   diff->different ${trueNegative}`)
console.log(`ambiguous decisions: ${ambiguous}`)
console.log(`precision ${precision === null ? 'n/a' : precision.toFixed(3)}  recall ${recall === null ? 'n/a' : recall.toFixed(3)}`)
console.log(`gate: falsePositive must be 0 (actual ${falsePositive}); recall misses are reported, not gated (actual ${falseNegative})`)
if (failures.length > 0) {
  console.log('')
  console.log('misclassified:')
  for (const failure of failures) {
    console.log(`  ${failure.id} (${failure.kind}) expected=${failure.expected} got=${failure.got} score=${failure.score} reason=${failure.reason}`)
  }
}

const report = {
  // Bound to the exact commit the numbers came from. Without it a report cannot
  // be matched to code, which is how a stale result ends up quoted as current.
  headSha,
  generatedAt: new Date().toISOString(),
  algorithmVersion: TOPIC_IDENTITY_VERSION,
  devSetVersion: devSet.version,
  thresholds: { same: TOPIC_SAME_THRESHOLD, ambiguous: TOPIC_AMBIGUOUS_THRESHOLD },
  totals: { pairs: devSet.pairs.length, truePositive, falsePositive, trueNegative, falseNegative, ambiguous },
  confusion: {
    'same->same': truePositive,
    'same->different': falseNegative,
    'different->same': falsePositive,
    'different->different': trueNegative
  },
  metrics: { precision, recall },
  failures,
  rows,
  note: 'Development-set result on a hand-labelled sample; not a calibrated population estimate.'
}
const resultsDirectory = resolve(process.cwd(), 'evals/stage-2/results')
mkdirSync(resultsDirectory, { recursive: true })
const target = resolve(resultsDirectory, 'topic-identity-devset-report.json')
writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log('')
console.log(`report written: ${target}  headSha: ${headSha}`)
process.exitCode = falsePositive === 0 ? 0 : 1
