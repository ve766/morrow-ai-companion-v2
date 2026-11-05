import './style.css'
import './companion.css'
import type { IpcResult } from '../../shared/contracts'
import type { MemoryRecord, MemoryRevisionRecord } from '../../memory/memory-domain'
import { initializeBackup } from './backup-ui'
import { initializePendingPanel } from './pending-ui'
import { initializeShell } from './shell-ui'
import { initializePresence } from './presence-ui'
import { buildMemoryTimeline } from '../../memory/memory-timeline'
import { createRequestGuard } from '../../security/request-guard'
import { initializeGoals } from './goals-ui'
import { initializeGoalCandidates } from './goal-candidates-ui'
import { initializeReminders } from './reminders-ui'
import { initializeCompanion } from './companion-ui'
import { initializeProviderProfiles } from './provider-profiles-ui'
import { initializeSelfModel } from './self-model-ui'

class UiError extends Error {}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error('Interface element unavailable.')
  return found
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new UiError(result.error.message)
  return result.data
}

function showFeedback(message: string, isError = false): void {
  const feedback = element<HTMLParagraphElement>('#feedback')
  feedback.textContent = message
  feedback.dataset.kind = isError ? 'error' : 'success'
  feedback.hidden = false
}

function clearFeedback(): void {
  const feedback = element<HTMLParagraphElement>('#feedback')
  feedback.textContent = ''
  feedback.hidden = true
  delete feedback.dataset.kind
}

function showError(error: unknown): void {
  const message = error instanceof UiError ? error.message : '操作失败，请检查本地数据后重试。'
  showFeedback(message, true)
}

function button(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = className
  control.textContent = label
  control.addEventListener('click', () => void action())
  return control
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

function formatTime(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return '时间不可用'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function changeLabel(value: MemoryRevisionRecord['changeType']): string {
  const labels: Record<MemoryRevisionRecord['changeType'], string> = {
    created: '创建',
    corrected: '更正',
    retracted: '撤销',
    restored: '恢复',
    confirmed: '再次确认'
  }
  return labels[value]
}

function statusLabel(value: MemoryRecord['status']): string {
  return value === 'active' ? '有效' : '已撤销'
}

let currentQuery = ''
const memoryListGuard = createRequestGuard()

async function loadMemories(): Promise<void> {
  const request = memoryListGuard.begin()
  const list = element<HTMLDivElement>('#memory-list')
  list.setAttribute('aria-busy', 'true')
  try {
    const records = currentQuery
      ? unwrap(await window.morrow.memories.search({ query: currentQuery }))
      : unwrap(await window.morrow.memories.list())
    if (!memoryListGuard.isCurrent(request)) return
    renderMemories(records, Boolean(currentQuery))
  } catch (error) {
    if (memoryListGuard.isCurrent(request)) showError(error)
  } finally {
    if (memoryListGuard.isCurrent(request)) list.setAttribute('aria-busy', 'false')
  }
}

function renderHistory(container: HTMLElement, revisions: MemoryRevisionRecord[]): void {
  const timeline = buildMemoryTimeline(revisions)
  if (timeline.length === 0) {
    container.replaceChildren(textElement('p', 'revision-empty', '该记忆当前没有可展示的修订记录。'))
    return
  }
  const history = document.createElement('ol')
  history.className = 'revision-list'
  for (const entry of timeline) {
    const item = document.createElement('li')
    const heading = textElement('div', 'revision-heading', `第 ${entry.revision} 版 · ${changeLabel(entry.changeType)} · ${statusLabel(entry.status)}`)
    const time = textElement('time', 'revision-time', entry.recordedAtValid ? formatTime(entry.recordedAt) : '时间戳无效，无法显示时间')
    if (entry.recordedAtValid) time.dateTime = entry.recordedAt
    const content = textElement('p', 'revision-content', entry.content)
    // The domain model has exactly one source category (user explicit input);
    // nothing here is model-inferred, so the label states the provenance as-is.
    const source = textElement('span', 'revision-source', entry.sourceCategory === 'user_explicit_input' ? '来源：用户明确输入' : `来源：${entry.sourceCategory}`)
    item.append(heading, time, content, source)
    history.append(item)
  }
  container.replaceChildren(history)
}

function addEditor(card: HTMLElement, record: MemoryRecord): void {
  if (card.querySelector('.correction-form')) return
  const form = document.createElement('form')
  form.className = 'correction-form'
  const label = textElement('label', 'field-label', '更正后的内容')
  const textarea = document.createElement('textarea')
  textarea.maxLength = 4000
  textarea.required = true
  textarea.rows = 4
  textarea.value = record.currentText
  label.htmlFor = `edit-${record.id}`
  textarea.id = `edit-${record.id}`
  const controls = document.createElement('div')
  controls.className = 'inline-controls'
  const save = document.createElement('button')
  save.type = 'submit'
  save.className = 'button button-primary button-small'
  save.textContent = '保存更正'
  const cancel = button('取消', 'button button-quiet button-small', () => form.remove())
  controls.append(save, cancel)
  form.append(label, textarea, controls)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    save.disabled = true
    try {
      unwrap(await window.morrow.memories.correct({ id: record.id, content: textarea.value }))
      showFeedback('更正已保存，旧版本仍保留在修订谱系中。')
      await loadMemories()
    } catch (error) {
      showError(error)
    } finally {
      save.disabled = false
    }
  })
  card.append(form)
  textarea.focus()
}

function createMemoryCard(record: MemoryRecord, isSearchResult: boolean): HTMLElement {
  const card = document.createElement('article')
  card.className = 'memory-card'
  card.dataset.status = record.status

  const top = document.createElement('div')
  top.className = 'memory-topline'
  const sensitivityLabel: Record<MemoryRecord['sensitivity'], string> = {
    normal: '普通',
    personal: '个人信息',
    sensitive: '敏感'
  }
  top.append(
    textElement('span', `status-pill status-${record.status}`, statusLabel(record.status)),
    textElement('span', 'source-pill source-small', '用户明确输入'),
    textElement('span', 'source-pill source-small', `敏感度：${sensitivityLabel[record.sensitivity]}`)
  )

  const content = textElement('p', 'memory-content', record.currentText)
  const meta = document.createElement('div')
  meta.className = 'memory-meta'
  meta.append(
    textElement('span', 'meta-item', `创建 ${formatTime(record.createdAt)}`),
    textElement('span', 'meta-item', `更新 ${formatTime(record.updatedAt)}`),
    textElement('span', 'meta-item', `修订 ${record.revision} 次`)
  )

  const actions = document.createElement('div')
  actions.className = 'memory-actions'
  const historyButton = button('查看修订谱系', 'button button-quiet button-small', async () => {
    const existing = card.querySelector<HTMLElement>('.history-panel')
    if (existing) {
      existing.remove()
      return
    }
    try {
      const revisions = unwrap(await window.morrow.memories.history({ id: record.id }))
      const historyPanel = document.createElement('section')
      historyPanel.className = 'history-panel'
      historyPanel.setAttribute('aria-label', '修订谱系')
      historyPanel.append(textElement('h3', 'history-title', `来源与修订 · ${revisions.length} 个版本`))
      renderHistory(historyPanel, revisions)
      const original = textElement('p', 'original-note', `原始提交：${record.originalText}`)
      historyPanel.append(original)
      card.append(historyPanel)
    } catch (error) {
      showError(error)
    }
  })
  actions.append(historyButton)

  if (record.status === 'active' && !isSearchResult) {
    actions.append(button('更正', 'button button-secondary button-small', () => addEditor(card, record)))
    actions.append(button('撤销', 'button button-secondary button-small', async () => {
      if (!window.confirm('撤销后，这条记忆将不再出现在有效记忆搜索中。继续吗？')) return
      try {
        unwrap(await window.morrow.memories.revoke({ id: record.id }))
        showFeedback('记忆已撤销；它仍可在列表和修订谱系中查看。')
        await loadMemories()
      } catch (error) {
        showError(error)
      }
    }))
  }

  if (record.status === 'retracted' && !isSearchResult) {
    actions.append(button('恢复', 'button button-secondary button-small', async () => {
      if (!window.confirm('恢复后，这条记忆会重新进入有效搜索。继续吗？')) return
      try {
        unwrap(await window.morrow.memories.restore({ id: record.id }))
        showFeedback('记忆已显式恢复，并重新参与有效记忆搜索。')
        await loadMemories()
      } catch (error) {
        showError(error)
      }
    }))
  }

  if (!isSearchResult) {
    actions.append(button('删除', 'button button-danger button-small', async () => {
      if (!window.confirm('删除会从应用数据库移除这条记忆及其全部修订，且无法在应用内恢复。确认删除？')) return
      try {
        unwrap(await window.morrow.memories.delete({ id: record.id }))
        showFeedback('记忆及其修订已从应用数据库删除。')
        await loadMemories()
      } catch (error) {
        showError(error)
      }
    }))
  }

  card.append(top, content, meta, actions)
  return card
}

function renderMemories(records: MemoryRecord[], isSearchResult: boolean): void {
  const list = element<HTMLDivElement>('#memory-list')
  if (records.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.append(
      textElement('span', 'empty-mark', isSearchResult ? '⌕' : '—'),
      textElement('h3', '', isSearchResult ? '没有匹配的有效记忆' : '还没有保存的记忆'),
      textElement('p', '', isSearchResult
        ? '搜索只返回当前有效的记录；已撤销或已删除的内容不会出现。'
        : '你明确提交并保存的内容会出现在这里。删除是硬删除：被删除的记忆及其全部修订会从数据库移除，界面不再展示且无法在应用内恢复；撤销的记忆仍会保留在这里并可显式恢复。')
    )
    list.replaceChildren(empty)
    return
  }
  list.replaceChildren(...records.map((record) => createMemoryCard(record, isSearchResult)))
}

async function updateRuntimeStatus(): Promise<void> {
  try {
    const info = unwrap(await window.morrow.getAppInfo())
    element<HTMLSpanElement>('#runtime-status').textContent = '本地数据库已就绪'
    element<HTMLSpanElement>('#app-version').textContent = `版本 ${info.version} · ${info.platform}`
  } catch {
    element<HTMLSpanElement>('#runtime-status').textContent = '本地存储状态不可用'
    showFeedback('本地存储暂不可用。请重启应用后重试。', true)
  }
}

element<HTMLFormElement>('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const textarea = element<HTMLTextAreaElement>('#create-content')
  const submit = element<HTMLButtonElement>('#create-form button[type="submit"]')
  submit.disabled = true
  try {
    const sensitivity = element<HTMLSelectElement>('#memory-sensitivity').value as MemoryRecord['sensitivity']
    unwrap(await window.morrow.memories.create({ content: textarea.value, sensitivity }))
    textarea.value = ''
    currentQuery = ''
    element<HTMLInputElement>('#search-query').value = ''
    showFeedback('已保存。来源标记为“用户明确输入”，不会自动抽取或推断。')
    await loadMemories()
  } catch (error) {
    showError(error)
  } finally {
    submit.disabled = false
  }
})

element<HTMLFormElement>('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const query = element<HTMLInputElement>('#search-query').value.trim()
  if (!query) {
    showFeedback('请输入搜索词，或选择“显示全部”。', true)
    return
  }
  currentQuery = query
  clearFeedback()
  await loadMemories()
})

element<HTMLButtonElement>('#clear-search').addEventListener('click', async () => {
  currentQuery = ''
  element<HTMLInputElement>('#search-query').value = ''
  clearFeedback()
  await loadMemories()
})

element<HTMLButtonElement>('#refresh-memories').addEventListener('click', async () => {
  clearFeedback()
  await loadMemories()
})

initializePresence()
initializeShell()
void updateRuntimeStatus()
void loadMemories()
initializeGoals()
initializeGoalCandidates()
initializeReminders()
initializeCompanion()
initializeProviderProfiles()
initializeSelfModel()
initializeBackup()
initializePendingPanel()
