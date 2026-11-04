// Pending internal items (D-11): the renderer surface where the user accepts,
// rejects or dismisses what Morrow's reflection proposed. The list is loaded
// from the continuity IPC; a decision is one call and re-renders the panel.
// Rejected items keep their dropped status on the backend, so they never come
// back — neither here nor as prompt hints.
//
// AUD45-P3-12: the decision result is a discriminated union, not a boolean.
// A conflict or a vanished item must be shown, not silently treated as success.

interface PendingItemView {
  id: string
  kind: string
  summary: string
  status: string
  createdAt: string
}

type PendingDecision = 'accepted' | 'rejected' | 'dismissed'

interface PendingDecisionView {
  status: 'decided' | 'unchanged' | 'conflict' | 'not_found'
  decision?: PendingDecision
  itemStatus?: 'done' | 'dropped'
  current?: PendingDecision | null
}

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

const DECISION_LABELS: Readonly<Record<PendingDecision, string>> = Object.freeze({
  accepted: '已接受',
  rejected: '已拒绝',
  dismissed: '已忽略'
})

function feedback(message: string, isError = false): void {
  const target = document.getElementById('pending-feedback')
  if (!target) return
  target.textContent = message
  target.dataset.kind = isError ? 'error' : 'success'
  target.hidden = false
}

function decisionMessage(result: PendingDecisionView): { text: string; isError: boolean } {
  if (result.status === 'decided') return { text: `${DECISION_LABELS[result.decision ?? 'accepted']}，列表已更新。`, isError: false }
  if (result.status === 'unchanged') return { text: '该事项已经处理过，状态保持不变。', isError: false }
  if (result.status === 'conflict') {
    const current = result.current ? DECISION_LABELS[result.current] : '其他状态'
    return { text: `该事项已被处理为「${current}」，本次操作未生效。`, isError: true }
  }
  return { text: '该事项已不存在，可能已被其他窗口处理。', isError: true }
}

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
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'button button-quiet'
  reject.textContent = '拒绝'
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'button button-quiet'
  dismiss.textContent = '忽略'
  const buttons = [accept, reject, dismiss]
  accept.addEventListener('click', () => void decide(item.id, 'accepted', buttons))
  reject.addEventListener('click', () => void decide(item.id, 'rejected', buttons))
  dismiss.addEventListener('click', () => void decide(item.id, 'dismissed', buttons))
  actions.append(accept, reject, dismiss)

  li.append(text, actions)
  return li
}

async function decide(itemId: string, decision: PendingDecision, buttons: HTMLButtonElement[]): Promise<void> {
  for (const button of buttons) button.disabled = true
  try {
    const result = await window.morrow.continuity.decidePendingItem({ itemId, decision })
    if (!result.ok) {
      // Schema upgrades, storage failures and validation errors must leave the
      // item retryable instead of freezing the buttons.
      feedback(result.error.message, true)
      for (const button of buttons) button.disabled = false
      return
    }
    const message = decisionMessage(result.data as unknown as PendingDecisionView)
    feedback(message.text, message.isError)
    await refreshPendingItems()
  } catch {
    feedback('处理该事项时发生错误，请刷新后重试。', true)
    for (const button of buttons) button.disabled = false
  }
}

export async function refreshPendingItems(): Promise<void> {
  const list = document.getElementById('pending-list')
  const empty = document.getElementById('pending-empty')
  if (!list || !empty) throw new Error('Interface element unavailable: pending panel')
  const result = await window.morrow.continuity.listPendingItems()
  if (!result.ok) {
    feedback(result.error.message, true)
    return
  }
  const open = result.data.filter((item) => item.status === 'open')
  list.replaceChildren(...open.map(render))
  empty.hidden = open.length > 0
}

export function initializePendingPanel(): void {
  const refresh = document.getElementById('refresh-pending')
  refresh?.addEventListener('click', () => void refreshPendingItems())
  void refreshPendingItems()
}
