/**
 * Self-model and interest review. These records already exist behind the
 * bridge; the UI keeps them read-mostly: a statement can be corrected or
 * retracted, and an interest can be paused or restored. No inferred value is
 * presented as a fact.
 */
import type { IpcResult } from '../../shared/contracts'
import type { InterestRecord, SelfModelEntry } from '../../self-model/self-model-domain'

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Interface element unavailable: ${selector}`)
  return found
}

function feedback(message: string, isError = false): void {
  const target = element<HTMLParagraphElement>('#self-model-feedback')
  target.textContent = message
  target.dataset.kind = isError ? 'error' : 'success'
  target.hidden = false
}

function kindLabel(kind: SelfModelEntry['kind']): string {
  if (kind === 'fact') return '事实'
  if (kind === 'inference') return '推断'
  if (kind === 'correction') return '更正'
  return '未知'
}

function statusLabel(status: SelfModelEntry['status']): string {
  if (status === 'active') return '有效'
  if (status === 'retracted') return '已撤回'
  if (status === 'superseded') return '已被替换'
  return status
}

function renderEntries(entries: SelfModelEntry[]): void {
  const list = element<HTMLDivElement>('#self-model-list')
  if (entries.length === 0) {
    list.replaceChildren(Object.assign(document.createElement('p'), { className: 'feedback', textContent: '还没有可展示的自我模型条目。' }))
    return
  }
  list.replaceChildren(...entries.map((entry) => {
    const card = document.createElement('article')
    card.className = 'memory-card'
    const top = document.createElement('div')
    top.className = 'memory-topline'
    const kind = document.createElement('span')
    kind.className = 'status-pill'
    kind.textContent = kindLabel(entry.kind)
    const status = document.createElement('span')
    status.className = 'meta-item'
    status.textContent = statusLabel(entry.status)
    top.append(kind, status)
    const statement = document.createElement('p')
    statement.className = 'memory-content'
    statement.textContent = entry.statement
    const meta = document.createElement('p')
    meta.className = 'memory-meta'
    meta.textContent = `置信度 ${entry.confidence} · ${entry.updatedAt}`
    const actions = document.createElement('div')
    actions.className = 'memory-actions'
    if (entry.status === 'active') {
      const correct = document.createElement('button')
      correct.type = 'button'
      correct.className = 'button button-secondary button-small'
      correct.textContent = '更正'
      correct.addEventListener('click', () => {
        const next = window.prompt('更正这条自我模型描述', entry.statement)
        if (!next || next.trim() === '' || next.trim() === entry.statement) return
        void window.morrow.selfModel.correctEntry({ entryId: entry.id, statement: next.trim() })
          .then((result) => {
            unwrap(result)
            feedback('自我模型条目已更正。')
            return load()
          })
          .catch((error: unknown) => feedback(error instanceof Error ? error.message : '更正失败。', true))
      })
      const retract = document.createElement('button')
      retract.type = 'button'
      retract.className = 'button button-danger button-small'
      retract.textContent = '撤回'
      retract.addEventListener('click', () => {
        if (!window.confirm('撤回这条自我模型描述？它不会删除对话或记忆，但不再参与后续上下文。')) return
        void window.morrow.selfModel.retractEntry({ entryId: entry.id })
          .then((result) => {
            unwrap(result)
            feedback('自我模型条目已撤回。')
            return load()
          })
          .catch((error: unknown) => feedback(error instanceof Error ? error.message : '撤回失败。', true))
      })
      actions.append(correct, retract)
    }
    card.append(top, statement, meta, actions)
    return card
  }))
}

function renderInterests(interests: InterestRecord[]): void {
  const list = element<HTMLDivElement>('#interest-list')
  if (interests.length === 0) {
    list.replaceChildren(Object.assign(document.createElement('p'), { className: 'feedback', textContent: '还没有形成兴趣记录。' }))
    return
  }
  list.replaceChildren(...interests.map((interest) => {
    const card = document.createElement('article')
    card.className = 'memory-card'
    const top = document.createElement('div')
    top.className = 'memory-topline'
    const label = document.createElement('strong')
    label.textContent = interest.label
    const status = document.createElement('span')
    status.className = 'status-pill'
    status.textContent = interest.status === 'active' ? '活跃' : interest.status === 'candidate' ? '候选' : interest.status === 'archived' ? '归档' : '已放弃'
    top.append(label, status)
    const meta = document.createElement('p')
    meta.className = 'memory-meta'
    meta.textContent = `强度 ${interest.strength} · 置信度 ${interest.confidence} · 证据 ${interest.evidenceCount}`
    const actions = document.createElement('div')
    actions.className = 'memory-actions'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'button button-quiet button-small'
    toggle.textContent = interest.status === 'active' ? '暂停' : '恢复'
    toggle.addEventListener('click', () => {
      const next = interest.status === 'active' ? 'archived' : 'active'
      void window.morrow.selfModel.setInterestStatus({ interestId: interest.id, status: next })
        .then((result) => {
          unwrap(result)
          feedback(next === 'active' ? '兴趣已恢复。' : '兴趣已暂停。')
          return load()
        })
        .catch((error: unknown) => feedback(error instanceof Error ? error.message : '兴趣状态更新失败。', true))
    })
    actions.append(toggle)
    card.append(top, meta, actions)
    return card
  }))
}

async function load(): Promise<void> {
  try {
    const [entries, interests] = await Promise.all([
      window.morrow.selfModel.listEntries({}),
      window.morrow.selfModel.listInterests()
    ])
    renderEntries(unwrap(entries))
    renderInterests(unwrap(interests))
  } catch (error) {
    feedback(error instanceof Error ? error.message : '自我模型读取失败。', true)
  }
}

function buildPanel(): void {
  const memoryView = document.querySelector<HTMLElement>('.view[data-view="memory"]')
  if (!memoryView || memoryView.querySelector('#self-model-panel')) return
  const panel = document.createElement('section')
  panel.id = 'self-model-panel'
  panel.className = 'pending-section panel'
  panel.setAttribute('aria-labelledby', 'self-model-heading')
  panel.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">SELF-MODEL &amp; INTERESTS</p>
        <h2 id="self-model-heading">Morrow 对自己的描述</h2>
      </div>
      <button id="refresh-self-model" class="button button-quiet button-small" type="button">刷新</button>
    </div>
    <p class="feedback">这些条目来自可检查的本机记录，不是模型自行写入的隐藏人格。推断会明确标注；你可以更正、撤回或暂停兴趣。</p>
    <p id="self-model-feedback" class="feedback" role="status" aria-live="polite" hidden></p>
    <div class="self-model-grid">
      <div><h3 class="goal-candidate-subheading">自我模型</h3><div id="self-model-list" class="memory-list" aria-live="polite"></div></div>
      <div><h3 class="goal-candidate-subheading">兴趣</h3><div id="interest-list" class="memory-list" aria-live="polite"></div></div>
    </div>`
  memoryView.append(panel)
  element<HTMLButtonElement>('#refresh-self-model').addEventListener('click', () => void load())
  void load()
}

export function initializeSelfModel(): void {
  buildPanel()
}
