// Pending internal items (D-11): the renderer surface where the user accepts,
// rejects or dismisses what Morrow's reflection proposed. The list is loaded
// from the continuity IPC; a decision is one call and re-renders the panel.
// Rejected items keep their dropped status on the backend, so they never come
// back — neither here nor as prompt hints.

interface PendingItemView {
  id: string
  kind: string
  summary: string
  status: string
  createdAt: string
}

type PendingDecision = 'accepted' | 'rejected' | 'dismissed'

const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  memory_gap: '记忆缺口',
  intent_correction: '理解纠正',
  bias_hint: '自我校准',
  next_turn_suggestion: '下一步建议',
  consistency_note: '一致性核对',
  conflict: '记忆冲突',
  evidence_gap: '证据缺口',
  open_question: '未决问题'
})

function render(item: PendingItemView): HTMLElement {
  const li = document.createElement('li')
  li.className = 'pending-item'
  li.dataset.itemId = item.id

  const text = document.createElement('div')
  text.className = 'pending-item-body'
  const kind = document.createElement('p')
  kind.className = 'pending-item-kind'
  kind.textContent = KIND_LABELS[item.kind] ?? item.kind
  const summary = document.createElement('p')
  summary.className = 'pending-item-summary'
  summary.textContent = item.summary
  text.append(kind, summary)

  const actions = document.createElement('div')
  actions.className = 'pending-item-actions'
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'button button-secondary'
  accept.textContent = '接受'
  accept.addEventListener('click', () => void decide(item.id, 'accepted'))
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'button button-quiet'
  reject.textContent = '拒绝'
  reject.addEventListener('click', () => void decide(item.id, 'rejected'))
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'button button-quiet'
  dismiss.textContent = '忽略'
  dismiss.addEventListener('click', () => void decide(item.id, 'dismissed'))
  actions.append(accept, reject, dismiss)

  li.append(text, actions)
  return li
}

async function decide(itemId: string, decision: PendingDecision): Promise<void> {
  const result = await window.morrow.continuity.decidePendingItem({ itemId, decision })
  if (result.ok) await refreshPendingItems()
}

export async function refreshPendingItems(): Promise<void> {
  const list = document.getElementById('pending-list')
  const empty = document.getElementById('pending-empty')
  if (!list || !empty) throw new Error('Interface element unavailable: pending panel')
  const result = await window.morrow.continuity.listPendingItems()
  if (!result.ok) return
  const open = result.data.filter((item) => item.status === 'open')
  list.replaceChildren(...open.map(render))
  empty.hidden = open.length > 0
}

export function initializePendingPanel(): void {
  const refresh = document.getElementById('refresh-pending')
  refresh?.addEventListener('click', () => void refreshPendingItems())
  void refreshPendingItems()
}
