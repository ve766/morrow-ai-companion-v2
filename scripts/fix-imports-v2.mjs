import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = process.cwd()
const byBasename = new Map([
  ['database.ts', 'src/persistence/database.ts'],
  ['migrations.ts', 'src/persistence/migrations.ts'],
  ['conversation-repository.ts', 'src/persistence/conversation-repository.ts'],
  ['memory-repository.ts', 'src/persistence/memory-repository.ts'],
  ['goal-repository.ts', 'src/persistence/goal-repository.ts'],
  ['reminder-repository.ts', 'src/persistence/reminder-repository.ts'],
  ['deletion-journal.ts', 'src/persistence/deletion-journal.ts'],
  ['feeling.ts', 'src/affective-state/feeling.ts'],
  ['cognition.ts', 'src/cognition/cognition.ts'],
  ['memory-domain.ts', 'src/memory/memory-domain.ts'],
  ['memory-timeline.ts', 'src/memory/memory-timeline.ts'],
  ['goals.ts', 'src/motivation/goals.ts'],
  ['goal-evidence.ts', 'src/motivation/goal-evidence.ts'],
  ['reminders.ts', 'src/motivation/reminders.ts'],
  ['reminder-policy.ts', 'src/motivation/reminder-policy.ts'],
  ['request-guard.ts', 'src/security/request-guard.ts'],
  ['errors.ts', 'src/shared/errors.ts'],
  ['openai-compatible.ts', 'src/providers/openai-compatible.ts'],
  ['provider-policy.ts', 'src/providers/provider-policy.ts'],
  ['secrets.ts', 'src/security/secrets.ts'],
  ['secret-store-error.ts', 'src/security/secret-store-error.ts'],
  ['provider-secret-errors.ts', 'src/security/provider-secret-errors.ts'],
  ['security.ts', 'src/security/security.ts'],
  ['backup-service.ts', 'src/persistence/backup-service.ts'],
  ['conversation-service.ts', 'src/conversation/conversation-service.ts'],
  ['memory-service.ts', 'src/memory/memory-service.ts'],
  ['memory-context-assembler.ts', 'src/memory/memory-context-assembler.ts'],
  ['cognitive-turn-analyzer.ts', 'src/cognition/cognitive-turn-analyzer.ts'],
  ['cognitive-settings.ts', 'src/cognition/cognitive-settings.ts'],
  ['cognitive-feeling-engine.ts', 'src/affective-state/cognitive-feeling-engine.ts'],
  ['cognitive-feeling-service.ts', 'src/affective-state/cognitive-feeling-service.ts'],
  ['goal-service.ts', 'src/motivation/goal-service.ts'],
  ['goal-store.ts', 'src/motivation/goal-store.ts'],
  ['reminder-service.ts', 'src/motivation/reminder-service.ts'],
  ['reminder-store.ts', 'src/motivation/reminder-store.ts'],
  ['reminder-notification.ts', 'src/motivation/reminder-notification.ts'],
  ['tool-registry.ts', 'src/motivation/tool-registry.ts']
])

const sourceFiles = []
function walk(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.ts$/.test(entry)) sourceFiles.push(full)
  }
}
walk(join(root, 'src'))
walk(join(root, 'scripts'))

let total = 0
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8')
  const specRegex = /(from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\2/g
  let changed = 0
  const output = source.replace(specRegex, (match, prefix, quote, spec) => {
    const base = resolve(dirname(file), spec)
    for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return match
    }
    const specifierBase = spec.split('/').pop() ?? ''
    const mapped = byBasename.get(specifierBase) ?? byBasename.get(`${specifierBase}.ts`)
    if (!mapped) return match
    let rel = relative(dirname(file), resolve(root, mapped)).split(sep).join('/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    if (rel === spec) return match
    changed += 1
    return `${prefix}${quote}${rel}${quote}`
  })
  if (changed > 0) { writeFileSync(file, output); total += changed }
}
console.log(`fixed: ${total}`)
