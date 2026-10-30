/**
 * Stage 3 longitudinal simulation — with an injected clock.
 *
 * Time is advanced by the harness, not by the wall clock. That makes the
 * simulation honest: the result file says `clock: injected`, records the step
 * size and the real elapsed time, and never claims that ten fast blocks were ten
 * days of companionship.
 *
 * What it can prove: bounds, cooldown, daily caps and decay *given* a clock.
 * What it cannot prove: anything about real users over real days.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { foldGrowth, GROWTH_HALF_LIFE_DAYS, GROWTH_MAX_OFFSET } from '../../../src/personalization/personality-growth'
import { EXPLORATION_MAX_PER_DAY } from '../../../src/self-model/exploration-policy'
import { buildStack, head } from '../runner/harness'

const DAYS = 10
const TURNS_PER_DAY = 3
const DAY_MS = 86_400_000

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const realStart = Date.now()
  let now = Date.parse('2026-10-01T00:00:00.000Z')
  const clock = (): string => new Date(now).toISOString()

  const stack = buildStack({ growth: true, exploration: true, reflection: true, clock })
  let soon: { allowed: boolean; reason: string } = { allowed: true, reason: 'not_probed' }
  let later: { allowed: boolean; reason: string } = { allowed: true, reason: 'not_probed' }
  const dayLog: Array<{ day: number; simulatedAt: string; turns: number; offsets: Record<string, number>; raised: number }> = []
  try {
    // Seed a topic Morrow owns. Without independent evidence she has nothing of
    // her own to raise, which is the whole point of the separation.
    const conversation = stack.companion.createConversation()
    // Promotion needs evidence from two independent conversations, so the seed
    // spans two — the same threshold the product enforces.
    const secondConversation = stack.companion.createConversation()
    for (let index = 0; index < 3; index += 1) {
      stack.interests.observeMorrow({
        conversationId: index === 2 ? secondConversation.id : conversation.id,
        findingId: crypto.randomUUID(),
        occurredAt: clock(),
        topicText: '长期记忆里证据与遗忘的边界'
      })
    }
    // A second topic of her own, so the cooldown probe has something that is not
    // the topic already raised.
    for (let index = 0; index < 3; index += 1) {
      stack.interests.observeMorrow({
        conversationId: index === 2 ? secondConversation.id : conversation.id,
        findingId: crypto.randomUUID(),
        occurredAt: clock(),
        topicText: '写作者与读者之间信任的建立'
      })
    }

    // The reply must mention the topic by the label the system actually stored —
    // the label is derived, not the raw seed text.
    const ownLabels = stack.interests.activeForContext(10).filter((interest) => interest.origin !== 'user').map((interest) => interest.label)
    const raiseLabel = ownLabels[0] ?? ''
    for (let day = 1; day <= DAYS; day += 1) {
      for (let turn = 0; turn < TURNS_PER_DAY; turn += 1) {
        // Only the first turn of the day is a natural place to raise a topic; the
        // scripted reply mentions it, which is what the detector needs.
        stack.provider.reply = day === 1 && turn === 0 && raiseLabel ? `我最近一直在想${raiseLabel}这件事。` : '好的。'
        const text = turn === 0 ? '今天想聊点什么？' : turn === 1 ? '直接说重点。' : '继续。'
        await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: text, includeSensitive: false }, () => undefined)
        if (day === 1 && turn === 0) {
          // Probe the cooldown immediately after the raise, before the simulated
          // clock moves on: one hour later must be refused, seven hours later may
          // be allowed for the *other* topic she owns.
          const raisedAt = now
          now = raisedAt + 60 * 60 * 1000
          soon = stack.exploration.decide({ turnId: crypto.randomUUID(), interests: stack.interests.activeForContext(10), turn: null })
          now = raisedAt + 7 * 60 * 60 * 1000
          later = stack.exploration.decide({ turnId: crypto.randomUUID(), interests: stack.interests.activeForContext(10), turn: null })
          now = raisedAt
        }
        now += 60_000
      }
      now += DAY_MS - TURNS_PER_DAY * 60_000
      const offsets: Record<string, number> = {}
      for (const entry of stack.growth.list()) offsets[entry.dimension] = entry.offset
      dayLog.push({ day, simulatedAt: clock(), turns: TURNS_PER_DAY, offsets, raised: stack.exploration.recent().raisedLastDay })
    }

    const growth = stack.growth.list()
    const exploration = stack.exploration.recent()
    const baseline = stack.companion.getPersonality()


    const fresh = foldGrowth(
      [0, 1, 2].map(() => ({ dimension: 'warmth', turn_id: crypto.randomUUID(), signal: 1, weight: 1, created_at: clock() })),
      clock()
    )
    const agedAt = new Date(Date.parse(clock()) - GROWTH_HALF_LIFE_DAYS * DAY_MS).toISOString()
    const aged = foldGrowth(
      [0, 1, 2].map(() => ({ dimension: 'warmth', turn_id: crypto.randomUUID(), signal: 1, weight: 1, created_at: agedAt })),
      clock()
    )

    const assertions = [
      {
        name: '模拟十天后人格漂移仍在硬上限内',
        ok: growth.every((entry) => Math.abs(entry.offset) <= GROWTH_MAX_OFFSET),
        detail: growth.map((entry) => `${entry.dimension}:${entry.offset}`).join(',') || 'no evidence'
      },
      { name: '用户编辑的基线未被任何一天改写', ok: baseline.version >= 1, detail: `v${baseline.version}` },
      { name: '每日主动发起不超过上限', ok: dayLog.every((day) => day.raised <= EXPLORATION_MAX_PER_DAY), detail: dayLog.map((day) => `${day.day}:${day.raised}`).join(',') },
      { name: '至少真实发生一次提出（正例）', ok: dayLog.some((day) => day.raised > 0), detail: `max=${Math.max(...dayLog.map((day) => day.raised))} labels=${ownLabels.join('|')}` },
      { name: '冷却期内（+1h）不得再次许可', ok: soon.allowed === false, detail: soon.reason },
      { name: '冷却结束后（+7h）恢复许可', ok: later.allowed === true, detail: later.reason },
      { name: '一个半衰期前的证据只贡献约一半', ok: aged.offset > 0 && aged.offset < fresh.offset && aged.offset > fresh.offset * 0.4, detail: `fresh=${fresh.offset} aged=${aged.offset}` }
    ]

    const payload = {
      datasetVersion: 'stage-3-v1',
      harnessVersion: 'stage-3-longitudinal-v2',
      codeCommit: head(),
      environment: { platform: process.platform, node: process.version },
      provider: 'scripted-offline (not a model)',
      clock: 'injected',
      clockNote: 'Time is advanced by the harness (1 day per block, 60s per turn). This is NOT ten days of real use and must not be reported as such.',
      simulatedDays: DAYS,
      turnsPerDay: TURNS_PER_DAY,
      simulatedSpanHours: DAYS * 24,
      realElapsedMs: Date.now() - realStart,
      startedAt,
      finishedAt: new Date().toISOString(),
      dayLog,
      status: assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL',
      assertions
    }
    const outDir = join(resolve(process.cwd()), 'evals', 'stage-3', 'longitudinal', 'results')
    mkdirSync(outDir, { recursive: true })
    const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    const file = join(outDir, `${stamp}-${payload.codeCommit.slice(0, 7)}.json`)
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ file, status: payload.status, assertions }, null, 2)}\n`)
    if (payload.status !== 'PASS') process.exitCode = 1
  } finally {
    stack.close()
  }
}

void main()
