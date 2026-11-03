import type { IpcResult } from '../../shared/contracts'
import type { CompanionGoal, CompanionGoalCandidate, GoalCandidateDecisionResult } from '../../motivation/companion-goal'
import { createRequestGuard } from '../../security/request-guard'
import { refreshGoalViews } from './goals-ui'

class CandidateUiError extends Error {}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error('Goal candidate interface element is unavailable.')
  return found
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new CandidateUiError(result.error.message)
  return result.data
}

function feedback(message: string, isError = false): void {
  const target = element<HTMLParagraphElement>('#goal-candidate-feedback')
  target.textContent = message
  target.dataset.kind = isError ? 'error' : 'success'
  target.hidden = false
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
    : '时间不可用'
}

function ownerLabel(owner: CompanionGoalCandidate['owner'] | CompanionGoal['owner']): string {
  if (owner === 'morrow') return 'Morrow 提出'
  if (owner === 'shared') return '共同提及'
  return '你提出的'
}

function dueLabel(candidate: CompanionGoalCandidate): string {
  if (candidate.dueExpression) return `时间表达：${candidate.dueExpression}`
  if (candidate.dueAt) return `解析日期：${formatTime(candidate.dueAt)}`
  return '尚未解析出具体日期'
}

function goalDueLabel(goal: CompanionGoal): string {
  return goal.dueAt ? `期限：${formatTime(goal.dueAt)}` : '没有具体期限'
}

function goalStatusLabel(status: CompanionGoal['status']): string {
  const labels: Record<CompanionGoal['status'], string> = {
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    cancelled: '已取消',
    expired: '已过期'
  }
  return labels[status]
}

function resultMessage(result: GoalCandidateDecisionResult, action: 'accept' | 'reject'): string {
  if (result.status === 'accepted') return result.replayed ? '该候选已经确认过，目标保持不变。' : '已确认成为长期目标。'
  if (result.status === 'rejected') return result.replayed ? '该候选已经忽略过。' : '已忽略，不会再出现在待确认列表。'
  if (result.status === 'conflict') return '该候选已有不同的处理结果，未做修改。'
  if (result.status === 'source_unavailable') return '这条候选的来源消息已删除，无法确认。'
  return '候选不存在，可能已被处理。'
}

const candidateGuard = createRequestGuard()
const formalGoalGuard = createRequestGuard()

function renderCandidate(candidate: CompanionGoalCandidate): HTMLElement {
  const card = document.createElement('article')
  card.className = 'pending-item'
  card.dataset.candidateId = candidate.id

  const body = document.createElement('div')
  body.className = 'pending-item-body'
  const kind = document.createElement('p')
  kind.className = 'pending-item-kind'
  kind.textContent = '长期目标候选'
  const title = document.createElement('h3')
  title.className = 'pending-item-summary'
  title.textContent = candidate.title
  const meta = document.createElement('p')
  meta.className = 'pending-item-meta'
  meta.textContent = `${ownerLabel(candidate.owner)} · ${dueLabel(candidate)} · 识别于 ${formatTime(candidate.createdAt)}`
  body.append(kind, title, meta)

  const actions = document.createElement('div')
  actions.className = 'pending-item-actions'
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'button button-primary button-small'
  accept.textContent = '确认成为目标'
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'button button-quiet button-small'
  reject.textContent = '不是我的目标'

  const decide = async (action: 'accept' | 'reject'): Promise<void> => {
    accept.disabled = true
    reject.disabled = true
    try {
      const result = unwrap(action === 'accept'
        ? await window.morrow.companionGoals.acceptCandidate({ candidateId: candidate.id })
        : await window.morrow.companionGoals.rejectCandidate({ candidateId: candidate.id }))
      feedback(resultMessage(result, action), result.status !== 'accepted' && result.status !== 'rejected')
      // Accept must reach both the formal companion-goal list and the existing
      // goals view; reject only changes the candidate list.
      await Promise.all(action === 'accept'
        ? [loadCandidates(), loadFormalGoals(), refreshGoalViews().catch(() => undefined)]
        : [loadCandidates()])
    } catch (error) {
      feedback(error instanceof CandidateUiError ? error.message : '目标候选操作失败，请刷新后重试。', true)
      accept.disabled = false
      reject.disabled = false
    }
  }
  accept.addEventListener('click', () => void decide('accept'))
  reject.addEventListener('click', () => void decide('reject'))
  actions.append(accept, reject)
  card.append(body, actions)
  return card
}

function renderGoal(goal: CompanionGoal): HTMLElement {
  const card = document.createElement('article')
  card.className = 'pending-item'
  const body = document.createElement('div')
  body.className = 'pending-item-body'
  const kind = document.createElement('p')
  kind.className = 'pending-item-kind'
  kind.textContent = '已确认的长期目标'
  const title = document.createElement('h3')
  title.className = 'pending-item-summary'
  title.textContent = goal.title
  const meta = document.createElement('p')
  meta.className = 'pending-item-meta'
  meta.textContent = `${ownerLabel(goal.owner)} · ${goalDueLabel(goal)} · ${goalStatusLabel(goal.status)}`
  body.append(kind, title, meta)
  card.append(body)
  return card
}

async function loadFormalGoals(): Promise<void> {
  const request = formalGoalGuard.begin()
  const list = element<HTMLDivElement>('#companion-goal-list')
  const empty = element<HTMLParagraphElement>('#companion-goal-empty')
  list.setAttribute('aria-busy', 'true')
  try {
    const goals = unwrap(await window.morrow.companionGoals.listGoals())
    if (!formalGoalGuard.isCurrent(request)) return
    list.replaceChildren(...goals.map(renderGoal))
    empty.hidden = goals.length > 0
  } catch (error) {
    if (formalGoalGuard.isCurrent(request)) feedback(error instanceof CandidateUiError ? error.message : '长期目标加载失败。', true)
  } finally {
    if (formalGoalGuard.isCurrent(request)) list.setAttribute('aria-busy', 'false')
  }
}

async function loadCandidates(): Promise<void> {
  const request = candidateGuard.begin()
  const list = element<HTMLDivElement>('#goal-candidate-list')
  const empty = element<HTMLParagraphElement>('#goal-candidate-empty')
  list.setAttribute('aria-busy', 'true')
  try {
    const candidates = unwrap(await window.morrow.companionGoals.listCandidates())
    if (!candidateGuard.isCurrent(request)) return
    list.replaceChildren(...candidates.map(renderCandidate))
    empty.hidden = candidates.length > 0
  } catch (error) {
    if (candidateGuard.isCurrent(request)) feedback(error instanceof CandidateUiError ? error.message : '目标候选加载失败。', true)
  } finally {
    if (candidateGuard.isCurrent(request)) list.setAttribute('aria-busy', 'false')
  }
}

export function initializeGoalCandidates(): void {
  element<HTMLButtonElement>('#refresh-goal-candidates').addEventListener('click', () => {
    void loadCandidates()
    void loadFormalGoals()
  })
  void loadCandidates()
  void loadFormalGoals()
}
