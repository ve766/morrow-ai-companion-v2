/**
 * AUD45-P3-12: the pending panel must render the decision result, not treat
 * every `ok:true` response as success. The bridge is the real preload shape;
 * the DOM is a tiny stub because this suite runs in node.
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
  empty: FakeElement
  feedback: FakeElement
  refresh: FakeElement
}

function installedDom(): Dom {
  const list = new FakeElement()
  const empty = new FakeElement()
  const feedback = new FakeElement()
  feedback.hidden = true
  const refresh = new FakeElement()
  const byId: Record<string, FakeElement> = {
    'pending-list': list,
    'pending-empty': empty,
    'pending-feedback': feedback,
    'refresh-pending': refresh
  }
  ;(globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => byId[id] ?? null,
    createElement: () => new FakeElement()
  }
  return { list, empty, feedback, refresh }
}

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'open_question',
  summary: '反思留下一个未解决的问题，等待后续对话澄清。',
  status: 'open',
  createdAt: '2026-11-01T08:00:00.000Z'
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document
  delete (globalThis as unknown as { window?: unknown }).window
  vi.restoreAllMocks()
})

function bridge(decision: unknown, list = [item]): { decide: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> } {
  const decide = vi.fn(async () => decision)
  const listItems = vi.fn(async () => ({ ok: true as const, data: list }))
  ;(globalThis as unknown as { window: unknown }).window = {
    morrow: {
      continuity: {
        listPendingItems: listItems,
        decidePendingItem: decide
      }
    }
  }
  return { decide, list: listItems }
}

async function load(): Promise<Dom> {
  const dom = installedDom()
  const { initializePendingPanel } = await import('../src/renderer/src/pending-ui')
  initializePendingPanel()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return dom
}

function buttons(dom: Dom): FakeElement[] {
  return dom.list.children[0]!.children[1]!.children
}

describe('pending decision panel results', () => {
  it('shows the accepted result and refreshes the list', async () => {
    const { decide, list } = bridge({ ok: true, data: { status: 'decided', decision: 'accepted', itemStatus: 'done' } })
    const dom = await load()
    await buttons(dom)[0]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(decide).toHaveBeenCalledWith({ itemId: item.id, decision: 'accepted' })
    expect(dom.feedback.textContent).toContain('已接受')
    expect(dom.feedback.dataset.kind).toBe('success')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows a conflict, refreshes, and re-enables the buttons', async () => {
    const { list } = bridge({ ok: true, data: { status: 'conflict', current: 'rejected' } })
    const dom = await load()
    await buttons(dom)[1]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.feedback.textContent).toContain('已拒绝')
    expect(dom.feedback.dataset.kind).toBe('error')
    expect(list).toHaveBeenCalledTimes(2)
    expect(buttons(dom).every((button) => button.disabled === false)).toBe(true)
  })

  it('shows not_found and does not pretend success', async () => {
    const { list } = bridge({ ok: true, data: { status: 'not_found' } })
    const dom = await load()
    await buttons(dom)[2]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.feedback.textContent).toContain('已不存在')
    expect(dom.feedback.dataset.kind).toBe('error')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('surfaces an IPC failure and leaves the item retryable', async () => {
    const { list } = bridge({ ok: false, error: { code: 'STORAGE_ERROR', message: '本地数据暂不可用，请重试。' } })
    const dom = await load()
    await buttons(dom)[0]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.feedback.textContent).toContain('本地数据暂不可用')
    expect(dom.feedback.dataset.kind).toBe('error')
    expect(list).toHaveBeenCalledTimes(1)
    expect(buttons(dom).every((button) => button.disabled === false)).toBe(true)
  })

  it('shows an unchanged replay as already handled', async () => {
    bridge({ ok: true, data: { status: 'unchanged', decision: 'accepted' } })
    const dom = await load()
    await buttons(dom)[0]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.feedback.textContent).toContain('已经处理过')
    expect(dom.feedback.dataset.kind).toBe('success')
  })
})
