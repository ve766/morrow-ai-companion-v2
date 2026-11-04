/**
 * Renderer bridge test: the goal-candidate panel must load from and decide
 * through the real preload bridge functions, not a local array. A tiny DOM
 * stub is used because the renderer test environment is node (no jsdom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeElement {
  className = ''
  textContent = ''
  type = ''
  disabled = false
  hidden = false
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  listeners: Array<() => unknown> = []
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes]
  }
  addEventListener(_event: string, listener: () => unknown): void {
    this.listeners.push(listener)
  }
  setAttribute(): void {}
}

interface Dom {
  list: FakeElement
  formal: FakeElement
  feedback: FakeElement
  empty: FakeElement
}

function installedDom(): Dom {
  const list = new FakeElement()
  const formal = new FakeElement()
  const formalEmpty = new FakeElement()
  const feedback = new FakeElement()
  feedback.hidden = true
  const refresh = new FakeElement()
  const empty = new FakeElement()
  const byId: Record<string, FakeElement> = {
    '#goal-candidate-list': list,
    '#companion-goal-list': formal,
    '#companion-goal-empty': formalEmpty,
    '#goal-candidate-feedback': feedback,
    '#refresh-goal-candidates': refresh,
    '#goal-candidate-empty': empty
  }
  ;(globalThis as unknown as { document: unknown }).document = {
    querySelector: (selector: string) => byId[selector] ?? null,
    createElement: () => new FakeElement()
  }
  return { list, formal, feedback, empty }
}

const candidate = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '完成 Morrow 的第一阶段',
  conversationId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-11-01T08:00:00.000Z',
  dueAt: null,
  dueExpression: '以后',
  owner: 'user' as const,
  sourceState: 'live'
}

const goal = {
  id: '33333333-3333-4333-8333-333333333333',
  title: candidate.title,
  detail: '',
  owner: 'user' as const,
  status: 'active' as const,
  priority: 50,
  dueAt: null,
  sourceMessageId: null,
  createdAt: candidate.createdAt,
  updatedAt: candidate.createdAt,
  revision: 1
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document
  delete (globalThis as unknown as { window?: unknown }).window
  vi.restoreAllMocks()
})

describe('goal candidate renderer bridge', () => {
  it('loads real pending candidates and confirms through the preload bridge', async () => {
    const dom = installedDom()
    let accepted = false
    const accept = vi.fn(async () => {
      accepted = true
      return { ok: true as const, data: { status: 'accepted' as const, goal, replayed: false } }
    })
    const reject = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
      morrow: {
        companionGoals: {
          listGoals: vi.fn(async () => ({ ok: true as const, data: accepted ? [goal] : [] })),
          listCandidates: vi.fn(async () => ({ ok: true as const, data: accepted ? [] : [candidate] })),
          acceptCandidate: accept,
          rejectCandidate: reject
        }
      }
    }
    const { initializeGoalCandidates } = await import('../src/renderer/src/goal-candidates-ui')
    initializeGoalCandidates()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.list.children).toHaveLength(1)
    expect(dom.empty.hidden).toBe(true)
    const card = dom.list.children[0]!
    const actions = card.children[1]!
    const confirm = actions.children[0]!
    expect(confirm.textContent).toBe('确认成为目标')
    await confirm.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(accept).toHaveBeenCalledWith({ candidateId: candidate.id })
    expect(dom.feedback.textContent).toContain('已确认成为长期目标')
    // The accepted goal is visible in the formal companion-goal list.
    expect(dom.formal.children).toHaveLength(1)
  })

  it('rejects through the bridge, not by hiding the card locally', async () => {
    const dom = installedDom()
    const accept = vi.fn()
    const reject = vi.fn(async () => ({ ok: true as const, data: { status: 'rejected' as const, candidateId: candidate.id, replayed: false } }))
    ;(globalThis as unknown as { window: unknown }).window = {
      morrow: {
        companionGoals: {
          listGoals: vi.fn(async () => ({ ok: true as const, data: [] })),
          listCandidates: vi.fn(async () => ({ ok: true as const, data: [candidate] })),
          acceptCandidate: accept,
          rejectCandidate: reject
        }
      }
    }
    const { initializeGoalCandidates } = await import('../src/renderer/src/goal-candidates-ui')
    initializeGoalCandidates()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const actions = dom.list.children[0]!.children[1]!
    await actions.children[1]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reject).toHaveBeenCalledWith({ candidateId: candidate.id })
    expect(dom.feedback.textContent).toContain('已忽略')
  })
})
