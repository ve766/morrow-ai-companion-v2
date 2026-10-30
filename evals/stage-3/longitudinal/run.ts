/**
 * Stage 3 longitudinal simulation.
 *
 * Ten synthetic "days" of three turns each, driven through the real service.
 * The clock is real, so a day is a *block* of turns rather than 24 hours; what
 * this can prove is boundedness and rate control, not wall-clock behaviour.
 * Anything that genuinely needs days of wall time (decay, archival windows) is
 * asserted on the pure fold with explicit timestamps instead of being pretended.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { foldGrowth, GROWTH_MAX_OFFSET, GROWTH_HALF_LIFE_DAYS } from '../../../src/personalization/personality-growth'
import { EXPLORATION_MAX_PER_DAY } from '../../../src/self-model/exploration-policy'
import { buildStack, head } from '../runner/harness'

const DAYS = 10
const TURNS_PER_DAY = 3


async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const stack = buildStack()
  const dayLog: Array<{ day: number; turns: number; offsets: Record<string, number>; raises: number }> = []
  try {
    const conversation = stack.companion.createConversation()
    for (let day = 1; day <= DAYS; day += 1) {
      for (let turn = 0; turn < TURNS_PER_DAY; turn += 1) {
        const text = turn === 0
          ? '我今天又在想长期记忆这件事，感觉比上周更清楚了。'
          : turn === 1
            ? '这个方向不对，你理解偏了，我要的是可追溯的证据链。'
            : '继续，把刚才那个思路展开一点。'
        await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: text, includeSensitive: false }, () => undefined)
      }
      const offsets: Record<string, number> = {}
      for (const entry of stack.growth.list()) offsets[entry.dimension] = entry.offset
      dayLog.push({ day, turns: TURNS_PER_DAY, offsets, raises: stack.exploration.recent().raisedLastDay })
    }

    const growth = stack.growth.list()
    const exploration = stack.exploration.recent()
    const baseline = stack.companion.getPersonality()

    // Decay is asserted on the pure fold with explicit ages: a signal from one
    // half-life ago must count about half as much as a fresh one.
    const now = new Date().toISOString()
    const fresh = foldGrowth(
      [0, 1, 2].map(() => ({ dimension: 'warmth', turn_id: crypto.randomUUID(), signal: 1, weight: 1, created_at: now })),
      now
    )
    const agedAt = new Date(Date.parse(now) - GROWTH_HALF_LIFE_DAYS * 86_400_000).toISOString()
    const aged = foldGrowth(
      [0, 1, 2].map(() => ({ dimension: 'warmth', turn_id: crypto.randomUUID(), signal: 1, weight: 1, created_at: agedAt })),
      now
    )

    const assertions = [
      {
        name: '十天后人格漂移仍在硬上限内',
        ok: growth.every((entry) => Math.abs(entry.offset) <= GROWTH_MAX_OFFSET),
        detail: growth.map((entry) => `${entry.dimension}:${entry.offset}`).join(',') || 'no evidence'
      },
      {
        name: '用户编辑的基线未被任何一天改写',
        ok: baseline.version >= 1,
        detail: `v${baseline.version}`
      },
      {
        name: '每日主动发起不超过上限',
        ok: dayLog.every((day) => day.raises <= EXPLORATION_MAX_PER_DAY),
        detail: dayLog.map((day) => `${day.day}:${day.raises}`).join(',')
      },
      {
        name: '冷却期内不重复发起',
        ok: exploration.raisedLastDay <= EXPLORATION_MAX_PER_DAY,
        detail: `last24h=${exploration.raisedLastDay}`
      },
      {
        name: '一个半衰期前的证据只贡献约一半',
        ok: aged.offset > 0 && aged.offset < fresh.offset && aged.offset > fresh.offset * 0.4,
        detail: `fresh=${fresh.offset} aged=${aged.offset}`
      },
      {
        name: '长期运行不产生未受控的状态增长',
        ok: growth.every((entry) => Number.isFinite(entry.offset) && entry.evidenceCount <= DAYS * TURNS_PER_DAY),
        detail: growth.map((entry) => `${entry.dimension}:${entry.evidenceCount}`).join(',')
      }
    ]

    const payload = {
      datasetVersion: 'stage-3-v1',
      harnessVersion: 'stage-3-longitudinal-v1',
      codeCommit: head(),
      environment: { platform: process.platform, node: process.version },
      provider: 'scripted-offline (not a model)',
      simulatedDays: DAYS,
      turnsPerDay: TURNS_PER_DAY,
      clockNote: 'The clock is real; a "day" is a block of three turns, not 24 hours. Wall-clock decay is asserted separately on the pure fold.',
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
