import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = process.cwd()
const moves = [
  ['src/main/index.ts', 'src/app/index.ts'],
  ['src/main/register-ipc.ts', 'src/app/register-ipc.ts'],
  ['src/main/ipc.ts', 'src/app/ipc.ts'],
  ['src/main/ipc.test.ts', 'src/app/ipc.test.ts'],
  ['src/main/companion-service.ts', 'src/app/companion-service.ts'],
  ['src/main/companion-service.test.ts', 'src/app/companion-service.test.ts'],
  ['src/main/provider-manual-chat.integration.test.ts', 'src/app/provider-manual-chat.integration.test.ts'],
  ['src/main/backup-ipc.test.ts', 'src/app/backup-ipc.test.ts'],
  ['src/main/conversation-service.ts', 'src/conversation/conversation-service.ts'],
  ['src/main/memory-service.ts', 'src/memory/memory-service.ts'],
  ['src/main/memory-service.test.ts', 'src/memory/memory-service.test.ts'],
  ['src/main/memory-context-assembler.ts', 'src/memory/memory-context-assembler.ts'],
  ['src/main/memory-context-assembler.test.ts', 'src/memory/memory-context-assembler.test.ts'],
  ['src/main/errors.ts', 'src/shared/errors.ts'],
  ['src/main/cognitive-turn-analyzer.ts', 'src/cognition/cognitive-turn-analyzer.ts'],
  ['src/main/cognitive-turn-analyzer.test.ts', 'src/cognition/cognitive-turn-analyzer.test.ts'],
  ['src/main/cognitive-settings.ts', 'src/cognition/cognitive-settings.ts'],
  ['src/main/cognitive-feeling-engine.ts', 'src/affective-state/cognitive-feeling-engine.ts'],
  ['src/main/cognitive-feeling-engine.test.ts', 'src/affective-state/cognitive-feeling-engine.test.ts'],
  ['src/main/cognitive-feeling-service.ts', 'src/affective-state/cognitive-feeling-service.ts'],
  ['src/main/cognitive-feeling-service.test.ts', 'src/affective-state/cognitive-feeling-service.test.ts'],
  ['src/main/goal-service.ts', 'src/motivation/goal-service.ts'],
  ['src/main/goal-service.test.ts', 'src/motivation/goal-service.test.ts'],
  ['src/main/goal-store.ts', 'src/motivation/goal-store.ts'],
  ['src/main/reminder-service.ts', 'src/motivation/reminder-service.ts'],
  ['src/main/reminder-service.test.ts', 'src/motivation/reminder-service.test.ts'],
  ['src/main/reminder-store.ts', 'src/motivation/reminder-store.ts'],
  ['src/main/reminder-notification.ts', 'src/motivation/reminder-notification.ts'],
  ['src/main/tool-registry.ts', 'src/motivation/tool-registry.ts'],
  ['src/main/providers/openai-compatible.ts', 'src/providers/openai-compatible.ts'],
  ['src/main/providers/openai-compatible.test.ts', 'src/providers/openai-compatible.test.ts'],
  ['src/main/providers/provider-policy.ts', 'src/providers/provider-policy.ts'],
  ['src/main/providers/provider-policy.test.ts', 'src/providers/provider-policy.test.ts'],
  ['src/main/secrets.ts', 'src/security/secrets.ts'],
  ['src/main/secrets.test.ts', 'src/security/secrets.test.ts'],
  ['src/main/secrets-storage.test.ts', 'src/security/secrets-storage.test.ts'],
  ['src/main/secret-store-error.ts', 'src/security/secret-store-error.ts'],
  ['src/main/provider-secret-errors.ts', 'src/security/provider-secret-errors.ts'],
  ['src/main/security.ts', 'src/security/security.ts'],
  ['src/main/security.test.ts', 'src/security/security.test.ts'],
  ['src/main/backup-service.ts', 'src/persistence/backup-service.ts'],
  ['src/main/backup-service.test.ts', 'src/persistence/backup-service.test.ts'],
  ['src/shared/feeling.ts', 'src/affective-state/feeling.ts'],
  ['src/shared/cognition.ts', 'src/cognition/cognition.ts'],
  ['src/shared/memory-domain.ts', 'src/memory/memory-domain.ts'],
  ['src/shared/memory-domain.test.ts', 'src/memory/memory-domain.test.ts'],
  ['src/shared/memory-timeline.ts', 'src/memory/memory-timeline.ts'],
  ['src/shared/memory-timeline.test.ts', 'src/memory/memory-timeline.test.ts'],
  ['src/shared/goals.ts', 'src/motivation/goals.ts'],
  ['src/shared/goal-evidence.ts', 'src/motivation/goal-evidence.ts'],
  ['src/shared/goal-evidence.test.ts', 'src/motivation/goal-evidence.test.ts'],
  ['src/shared/reminders.ts', 'src/motivation/reminders.ts'],
  ['src/shared/reminders.test.ts', 'src/motivation/reminders.test.ts'],
  ['src/shared/reminder-policy.ts', 'src/motivation/reminder-policy.ts'],
  ['src/shared/request-guard.ts', 'src/security/request-guard.ts'],
  ['src/shared/request-guard.test.ts', 'src/security/request-guard.test.ts']
]
for (let v = 1; v <= 11; v += 1) {} // persistence files collected below

const persistenceFiles = []
function collect(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collect(full)
    else persistenceFiles.push(full)
  }
}
collect(join(root, 'src/main/persistence'))
for (const file of persistenceFiles) {
  const rel = relative(join(root, 'src/main/persistence'), file).split(sep).join('/')
  moves.push([`src/main/persistence/${rel}`, `src/persistence/${rel}`])
}

const moveMap = new Map(moves.map(([from, to]) => [resolve(root, from), resolve(root, to)]))
const oldToNewRel = new Map(moves)
let performed = 0
for (const [from, to] of moves) {
  const fromAbs = resolve(root, from)
  const toAbs = resolve(root, to)
  if (!existsSync(fromAbs)) {
    if (!existsSync(toAbs)) { console.error(`MISSING SOURCE AND TARGET: ${from}`); process.exit(1) }
    continue
  }
  mkdirSync(dirname(toAbs), { recursive: true })
  renameSync(fromAbs, toAbs)
  performed += 1
}
// remove now-empty dirs
for (const dir of ['src/main/persistence', 'src/main/providers', 'src/main', 'src/shared']) {
  try { readdirSync(resolve(root, dir)) } catch { continue }
  const remaining = readdirSync(resolve(root, dir))
  if (remaining.length === 0) { try { statSync(resolve(root, dir)) } catch { continue } }
}

function resolveModule(fromFileOldAbs, spec) {
  const base = resolve(dirname(fromFileOldAbs), spec)
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (moveMap.has(candidate)) return candidate
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function newSpecifier(containingOldAbs, containingNewAbs, spec) {
  if (!spec.startsWith('.')) return null
  const oldAbs = resolveModule(containingOldAbs, spec)
  if (!oldAbs) return null
  const moved = moveMap.get(oldAbs)
  const targetAbs = moved ?? oldAbs
  let rel = relative(dirname(containingNewAbs), targetAbs).split(sep).join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel === spec ? null : rel
}

function processFile(fileAbs, oldFileAbs) {
  const source = readFileSync(fileAbs, 'utf8')
  const specRegex = /(from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\2/g
  let changed = 0
  const output = source.replace(specRegex, (match, prefix, quote, spec) => {
    const next = newSpecifier(oldFileAbs, fileAbs, spec)
    if (next === null) return match
    changed += 1
    return `${prefix}${quote}${next}${quote}`
  })
  if (changed > 0) writeFileSync(fileAbs, output)
  return changed
}

const sourceFiles = []
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|mts)$/.test(entry)) sourceFiles.push(full)
  }
}
walk(join(root, 'src'))
walk(join(root, 'scripts'))

const reverseMoves = new Map(moves.map(([from, to]) => [resolve(root, to), resolve(root, from)]))
let total = 0
for (const fileAbs of sourceFiles) {
  const oldAbs = reverseMoves.get(fileAbs) ?? fileAbs
  total += processFile(fileAbs, oldAbs)
}
console.log(`moves: ${moves.length}, rewritten imports: ${total}`)
