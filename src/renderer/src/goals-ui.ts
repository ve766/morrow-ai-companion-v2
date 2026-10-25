import type { IpcResult } from '../../shared/contracts'
import type { ApprovalChallenge, GoalAuditRecord, GoalListItem, GoalRecord, TaskRecord, TaskStatus } from '../../motivation/goals'
import {
  GOAL_DEFAULT_CONSTRAINTS,
  GOAL_SUCCESS_CRITERION,
  SUPPORTED_GOAL_INTENT
} from '../../motivation/goals'
import { buildGoalEvidenceTimeline } from '../../motivation/goal-evidence'
import { createRequestGuard } from '../../security/request-guard'
import { refreshReminders } from './reminders-ui'

class GoalUiError extends Error {}

function getElement<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector)
  if (!result) throw new Error('Goal interface element is unavailable.')
  return result
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new GoalUiError(result.error.message)
  return result.data
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

function actionButton(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
  const result = document.createElement('button')
  result.type = 'button'
  result.className = className
  result.textContent = label
  result.addEventListener('click', () => void action())
  return result
}

function showGoalFeedback(message: string, isError = false): void {
  const feedback = getElement<HTMLParagraphElement>('#goal-feedback')
  feedback.textContent = message
  feedback.dataset.kind = isError ? 'error' : 'success'
  feedback.hidden = false
}

function reportGoalError(error: unknown): void {
  showGoalFeedback(error instanceof GoalUiError ? error.message : '目标操作失败，请刷新后重试。', true)
}

function formatGoalTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '时间不可用'
}

const goalStatusLabels: Record<GoalRecord['status'], string> = {
  active: '进行中',
  completed: '已验证完成',
  cancelled: '已停止'
}

const taskStatusLabels: Record<TaskStatus, string> = {
  queued: '待授权',
  awaiting_approval: '等待逐次批准',
  running: '执行中',
  succeeded: '已独立验证',
  failed: '执行失败',
  cancelled: '已取消',
  verification_failed: '验证失败',
  outcome_unknown: '结果未知'
}

const auditLabels: Record<GoalAuditRecord['event'], string> = {
  unknown_outcome_acknowledged: '用户确认了先前的未知结果',
  goal_created: '用户创建目标',
  goal_stopped: '用户停止目标',
  task_queued: '创建候选计划',
  approval_requested: '请求一次性批准',
  approval_consumed: '批准已绑定并消费',
  approval_rejected: '用户拒绝批准',
  approval_expired: '批准已过期',
  task_cancelled: '任务取消',
  action_started: '只读工具开始运行',
  action_succeeded: '工具返回结果',
  action_failed: '工具执行失败',
  verification_failed: '独立验证未通过',
  outcome_unknown: '结果未确定，未自动重试'
}

function renderChallenge(challenge: ApprovalChallenge): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'approval-challenge'
  panel.setAttribute('aria-label', '等待用户批准的具体动作')
  const title = node('h4', 'task-title', '待批准的具体动作')
  const details = document.createElement('dl')
  details.className = 'challenge-details'
  const entries: Array<[string, string]> = [
    ['目标', challenge.goalIntent],
    ['约束', challenge.goalConstraints],
    ['工具与版本', `${challenge.toolId} · v${challenge.toolVersion}`],
    ['参数', JSON.stringify(challenge.parameters)],
    ['资源范围', challenge.resourceScope],
    ['风险', challenge.risk],
    ['预期影响', challenge.expectedEffect],
    ['授权有效期', formatGoalTime(challenge.expiresAt)],
    ['授权方式', challenge.singleUse ? '单次；过期后作废' : '不可用']
  ]
  for (const [label, value] of entries) {
    const row = document.createElement('div')
    row.className = 'challenge-row'
    row.append(node('dt', 'challenge-label', label), node('dd', 'challenge-value', value))
    details.append(row)
  }
  panel.append(title, details)
  return panel
}

function renderAudit(entries: GoalAuditRecord[], tasks: TaskRecord[]): HTMLElement {
  const timeline = buildGoalEvidenceTimeline(entries, tasks)
  const section = document.createElement('section')
  section.className = 'goal-audit'
  section.append(node('h4', 'task-title', `进度与证据 · ${timeline.length} 条（按发生顺序）`))
  const list = document.createElement('ol')
  list.className = 'audit-list'
  for (const entry of timeline) {
    const item = document.createElement('li')
    const time = entry.happenedAtValid ? formatGoalTime(entry.happenedAt) : '时间戳无效，无法显示时间'
    const result = entry.resultCount === null ? '' : ` · 工具结果 ${entry.resultCount}`
    const verified = entry.verifiedCount === null ? '' : ` · 独立核验 ${entry.verifiedCount}`
    // 独立核验数据始终取自持久化的任务记录，而不是事件自述；
    // 未获批准或被拒绝的审批在这里仍然显示为审批事件，不会被当成已完成的事实。
    const verification = entry.verification
      ? ` · 独立核验状态：${entry.verification.verificationStatus}（工具 ${entry.verification.toolId} v${entry.verification.toolVersion}，结果 ${entry.verification.resultCount ?? '未知'}，核验 ${entry.verification.verifiedCount ?? '未完成'}）`
      : ''
    item.textContent = `${time} · ${auditLabels[entry.event]} · ${entry.reason}${result}${verified}${verification}`
    list.append(item)
  }
  section.append(list)
  return section
}

function renderTask(task: TaskRecord, goal: GoalRecord, audit: GoalAuditRecord[]): HTMLElement {
  const card = document.createElement('article')
  card.className = 'task-card'
  card.dataset.status = task.status
  card.dataset.taskId = task.id
  const header = document.createElement('div')
  header.className = 'task-header'
  header.append(
    node('span', `status-pill task-status-${task.status}`, taskStatusLabels[task.status]),
    node('span', 'task-id', `任务 ${task.id.slice(0, 8)}`)
  )
  const detail = node('p', 'task-detail', `工具 ${task.action.toolId} v${task.action.toolVersion} · ${task.action.risk} · 资源范围 ${task.action.resourceScope}`)
  const result = task.action.resultCount === null
    ? '尚无工具结果'
    : `工具结果 ${task.action.resultCount}；独立核验 ${task.action.verifiedCount ?? '未完成'}（${task.action.verificationStatus}）`
  const resultLine = node('p', 'task-result', result)
  card.append(header, detail, resultLine)
  if (task.status === 'outcome_unknown') {
    card.append(node('p', 'task-warning', '执行结果未知；系统不会自动重放。只有你确认并重新发起后才会创建新计划。'))
  }
  if (task.approvalChallenge) card.append(renderChallenge(task.approvalChallenge))

  const actions = document.createElement('div')
  actions.className = 'goal-actions'
  if (task.status === 'queued') {
    actions.append(actionButton('查看并请求一次性授权', 'button button-secondary button-small', async () => {
      try {
        unwrap(await window.morrow.goals.requestApproval({ taskId: task.id }))
        showGoalFeedback('授权请求已创建。批准前请检查工具、参数、范围、风险和有效期。')
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
  }
  if (task.status === 'awaiting_approval') {
    actions.append(actionButton('批准并执行', 'button button-primary button-small', async () => {
      try {
        const updated = unwrap(await window.morrow.goals.approveAndExecute({ taskId: task.id }))
        showGoalFeedback(updated.status === 'succeeded'
          ? `目标已通过独立核验：工具 ${updated.action.resultCount}，核验 ${updated.action.verifiedCount}。`
          : `操作结束：${taskStatusLabels[updated.status]}。`)
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
    actions.append(actionButton('拒绝本次授权', 'button button-quiet button-small', async () => {
      try {
        unwrap(await window.morrow.goals.rejectApproval({ taskId: task.id }))
        showGoalFeedback('本次授权已拒绝；不会执行工具。')
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
  }
  if (['queued', 'awaiting_approval', 'running'].includes(task.status)) {
    actions.append(actionButton('取消任务', 'button button-danger button-small', async () => {
      try {
        const updated = unwrap(await window.morrow.goals.cancelTask({ taskId: task.id }))
        showGoalFeedback(updated.status === 'outcome_unknown'
          ? '已请求停止；结果不确定，因此不会自动重试。'
          : '任务已取消，旧授权不能复用。')
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
  }
  if (actions.childElementCount > 0) card.append(actions)
  return card
}

function renderGoal(item: GoalListItem): HTMLElement {
  const card = document.createElement('article')
  card.className = 'goal-card'
  card.dataset.goalId = item.goal.id
  const header = document.createElement('div')
  header.className = 'goal-card-header'
  header.append(
    node('span', `status-pill goal-status-${item.goal.status}`, goalStatusLabels[item.goal.status]),
    node('span', 'goal-source', '来源：用户明确创建')
  )
  const title = node('h3', 'goal-title', item.goal.intent)
  const criterion = node('p', 'goal-criterion', '成功标准：当前有效记忆数量与独立只读核验一致。')
  const constraints = node('p', 'goal-constraints', `约束：${item.goal.constraints}`)
  const meta = node('p', 'goal-meta', `创建 ${formatGoalTime(item.goal.createdAt)} · 更新 ${formatGoalTime(item.goal.updatedAt)} · ${item.goal.successCriterion}`)
  card.append(header, title, criterion, constraints, meta)

  for (const task of item.tasks) card.append(renderTask(task, item.goal, item.audit))

  const actions = document.createElement('div')
  actions.className = 'goal-actions'
  if (item.goal.status === 'active') {
    actions.append(actionButton('创建候选计划', 'button button-secondary button-small', async () => {
      const hasUnknown = item.tasks.some((task) => task.status === 'outcome_unknown')
      if (hasUnknown && !window.confirm('上一次结果仍未知。只有在你确认它不需要恢复或补救后，才继续创建新的只读计划。继续？')) return
      try {
        unwrap(await window.morrow.goals.prepare({ goalId: item.goal.id, acknowledgeUnknown: hasUnknown }))
        showGoalFeedback('候选计划已保存。计划不会自动执行；下一步仅可请求此固定只读工具的一次性批准。')
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
    actions.append(actionButton('停止目标', 'button button-danger button-small', async () => {
      if (!window.confirm('停止会取消待执行任务并使待批准动作失效。已运行动作的结果将标为未知。继续？')) return
      try {
        unwrap(await window.morrow.goals.stop({ goalId: item.goal.id }))
        showGoalFeedback('目标已停止，待处理动作已失效。')
        await loadGoals()
      } catch (error) {
        reportGoalError(error)
      }
    }))
  }
  actions.append(actionButton('删除目标与审计记录', 'button button-danger button-small', async () => {
    if (!window.confirm('删除会永久移除该目标、任务、授权和审计记录。确认删除？')) return
    try {
      unwrap(await window.morrow.goals.delete({ goalId: item.goal.id }))
      showGoalFeedback('目标、任务、授权和审计记录已从应用数据库删除。')
      await loadGoals()
    } catch (error) {
      reportGoalError(error)
    }
  }))
  card.append(actions, renderAudit(item.audit, item.tasks))
  return card
}

function renderGoals(items: GoalListItem[]): void {
  const list = getElement<HTMLDivElement>('#goal-list')
  if (items.length === 0) {
    list.replaceChildren(node('p', 'empty-state', '尚未创建目标。'))
    return
  }
  list.replaceChildren(...items.map(renderGoal))
}

const goalsGuard = createRequestGuard()

async function loadGoals(): Promise<void> {
  const request = goalsGuard.begin()
  const list = getElement<HTMLDivElement>('#goal-list')
  list.setAttribute('aria-busy', 'true')
  try {
    const items = unwrap(await window.morrow.goals.list())
    if (!goalsGuard.isCurrent(request)) return
    renderGoals(items)
  } catch (error) {
    if (goalsGuard.isCurrent(request)) reportGoalError(error)
  } finally {
    if (goalsGuard.isCurrent(request)) list.setAttribute('aria-busy', 'false')
  }
}

async function refreshGoalViews(): Promise<void> {
  await loadGoals()
  await refreshReminders()
}

export function initializeGoals(): void {
  const constraints = getElement<HTMLTextAreaElement>('#goal-constraints')
  constraints.value = GOAL_DEFAULT_CONSTRAINTS
  getElement<HTMLFormElement>('#goal-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const consent = getElement<HTMLInputElement>('#goal-boundary')
    if (!consent.checked) {
      showGoalFeedback('请先确认只读工具、授权步骤和无外部副作用的范围。', true)
      return
    }
    const submit = getElement<HTMLButtonElement>('#goal-form button[type="submit"]')
    submit.disabled = true
    try {
      unwrap(await window.morrow.goals.create({
        intent: SUPPORTED_GOAL_INTENT,
        successCriterion: GOAL_SUCCESS_CRITERION,
        constraints: constraints.value,
        acceptedBoundary: true
      }))
      consent.checked = false
      showGoalFeedback('目标已创建。此操作没有执行工具；每次运行都要单独批准。')
      await refreshGoalViews()
    } catch (error) {
      reportGoalError(error)
    } finally {
      submit.disabled = false
    }
  })
  getElement<HTMLButtonElement>('#refresh-goals').addEventListener('click', () => void refreshGoalViews())
  void loadGoals()
}
