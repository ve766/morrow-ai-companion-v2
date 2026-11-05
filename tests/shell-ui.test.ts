import { describe, expect, it } from 'vitest'
import { applyView, initializeShell, type ViewName } from '../src/renderer/src/shell-ui'

class FakeClassList {
  private readonly values = new Set<string>()
  toggle(name: string, force?: boolean): void {
    if (force === true) this.values.add(name)
    else if (force === false) this.values.delete(name)
    else if (this.values.has(name)) this.values.delete(name)
    else this.values.add(name)
  }
  contains(name: string): boolean { return this.values.has(name) }
}

class FakeElement {
  hidden = false
  readonly classList = new FakeClassList()
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  listeners: Array<() => void> = []
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  addEventListener(_name: string, listener: () => void): void { this.listeners.push(listener) }
}

function buildDocument(): { document: Document; views: Record<ViewName, FakeElement>; nav: Record<ViewName, FakeElement> } {
  const names: ViewName[] = ['chat', 'memory', 'goals', 'settings']
  const views = Object.fromEntries(names.map((name) => [name, new FakeElement()])) as Record<ViewName, FakeElement>
  const nav = Object.fromEntries(names.map((name) => [name, new FakeElement()])) as Record<ViewName, FakeElement>
  for (const name of names) {
    views[name]!.dataset.view = name
    nav[name]!.dataset.view = name
  }
  const document = {
    querySelector(selector: string) {
      const view = /\.view\[data-view="([^"]+)"\]/u.exec(selector)
      if (view) return views[view[1] as ViewName] ?? null
      const button = /\.nav-item\[data-view="([^"]+)"\]/u.exec(selector)
      if (button) return nav[button[1] as ViewName] ?? null
      return null
    },
    querySelectorAll(selector: string) {
      return selector === '.nav-item[data-view]' ? Object.values(nav) : []
    }
  } as unknown as Document
  return { document, views, nav }
}

describe('shell navigation', () => {
  it('starts on chat and toggles the mounted views without rebuilding them', () => {
    const { document, views, nav } = buildDocument()
    initializeShell(document)
    expect(views.chat.hidden).toBe(false)
    expect(views.memory.hidden).toBe(true)
    expect(nav.chat.attributes.get('aria-current')).toBe('page')
    expect(nav.memory.attributes.has('aria-current')).toBe(false)

    nav.memory.listeners[0]!()
    expect(views.memory.hidden).toBe(false)
    expect(views.chat.hidden).toBe(true)
    expect(nav.memory.attributes.get('aria-current')).toBe('page')
    expect(nav.chat.attributes.has('aria-current')).toBe(false)
  })

  it('applies a view directly and rejects an unknown view name at the type boundary', () => {
    const { document, views } = buildDocument()
    applyView(document, 'settings')
    expect(views.settings.hidden).toBe(false)
    expect(views.chat.hidden).toBe(true)
  })
})
