import type { IpcResult } from '../../shared/contracts'
import type { GoalListItem } from '../../motivation/goals'
import type { ReminderDecisionRecord, ReminderRecord, ReminderSettingsRequest, ReminderSnapshot } from '../../motivation/reminders'

class ReminderUiError extends Error {}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('提醒界面不可用。')
  return element
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new ReminderUiError(result.error.message)
  return result.data
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  return element
}

function makeButton(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  element.addEventListener('click', () => void action())
  return element
}

function showFeedback(message: string, isError = false): void {
  const feedback = getElement<HTMLParagraphElement>('#reminder-feedback')
  feedback.textContent = message
  feedback.dataset.kind = isError ? 'error' : 'success'
  feedback.hidden = false
}

function showError(error: unknown): void {
  showFeedback(error instanceof ReminderUiError ? error.message : '提醒操作失败，请刷新后重试。', true)
}

function formatDate(value: string, timeZone?: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间不可用'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {})
    }).format(date)
  } catch {
    return '时间不可用'
  }
}

const statusLabels: Record<ReminderRecord['status'], string> = {
  scheduled: '已安排',
  showing: '正在显示',
  shown: '已显示',
  suppressed: '已抑制',
  cancelled: '已取消'
}

const reasonLabels: Record<ReminderDecisionRecord['reason'], string> = {
  user_scheduled: '用户安排',
  user_rescheduled: '用户重新安排',
  triggered_on_time: '按时触发',
  triggered_after_restart: '重启后补发',
  feature_disabled: '功能旗标关闭',
  consent_withdrawn: '同意已撤回',
  paused: '用户暂停',
  type_disabled: '该提醒类型已关闭',
  invalid_state: '提醒依据无法验证',
  goal_inactive: '目标已停止',
  goal_deleted: '目标已删除',
  quiet_hours: '处于安静时段',
  daily_limit: '达到每日上限',
  cooldown: '处于提醒间隔',
  muted: '用户静音',
  overdue: '提醒已过期',
  notification_unsupported: '系统不支持通知',
  notification_failed: '系统通知未能显示',
  user_cancelled: '用户取消',
  history_cleared: '历史已清除'
}

const decisionLabels: Record<ReminderDecisionRecord['decision'], string> = {
  scheduled: '安排',
  rescheduled: '重新安排',
  displaying: '尝试显示',
  triggered: '已触发',
  suppressed: '未显示',
  cancelled: '取消'
}

let currentSnapshot: ReminderSnapshot | undefined
let currentGoals: GoalListItem[] = []
let requestSequence = 0

function renderSettings(snapshot: ReminderSnapshot): void {
  const settings = snapshot.settings
  const featureFlag = snapshot.featureEnabled
  const enabled = getElement<HTMLInputElement>('#reminders-enabled')
  const goalReviewEnabled = getElement<HTMLInputElement>('#goal-review-enabled')
  const consent = getElement<HTMLInputElement>('#reminders-consent')
  const maxPerDay = getElement<HTMLInputElement>('#reminders-max-per-day')
  const cooldown = getElement<HTMLInputElement>('#reminders-cooldown')
  const timeZone = getElement<HTMLInputElement>('#reminders-time-zone')
  const quietEnabled = getElement<HTMLInputElement>('#quiet-hours-enabled')
  const quietStart = getElement<HTMLInputElement>('#quiet-hours-start')
  const quietEnd = getElement<HTMLInputElement>('#quiet-hours-end')

  enabled.checked = settings.enabled
  enabled.disabled = !featureFlag || !snapshot.notificationSupported
  goalReviewEnabled.checked = settings.goalReviewEnabled
  goalReviewEnabled.disabled = !featureFlag || !snapshot.notificationSupported
  consent.checked = false
  consent.disabled = !featureFlag || !snapshot.notificationSupported
  maxPerDay.value = String(settings.maxPer24Hours)
  cooldown.value = String(settings.cooldownMinutes)
  timeZone.value = settings.timeZone
  quietEnabled.checked = settings.quietHoursEnabled
  quietStart.value = settings.quietHoursStart
  quietEnd.value = settings.quietHoursEnd

  getElement<HTMLParagraphElement>('#reminder-status').textContent = !featureFlag
    ? '本构建的提醒功能旗标关闭；用户设置仍保持关闭。'
    : !snapshot.notificationSupported
      ? '当前系统不支持桌面通知，无法启用提醒。'
      : settings.enabled && settings.consentStatus === 'active'
        ? !settings.goalReviewEnabled
          ? '提醒总开关已开启，但目标复核类型未启用；不会安排提醒。'
          : settings.mutedUntil && Date.parse(settings.mutedUntil) > Date.now()
            ? `提醒已启用，但静音至 ${formatDate(settings.mutedUntil, settings.timeZone)}。`
            : '目标复核提醒已启用；本机通知不会执行目标操作。'
        : settings.consentStatus === 'withdrawn'
          ? '你已撤回提醒同意；再次启用时需要重新明确同意。'
          : '提醒当前关闭；只有你明确同意并启用后才会安排。'

  const meta = getElement<HTMLDivElement>('#reminder-meta')
  meta.replaceChildren(
    textElement('span', '', `同意状态：${settings.consentStatus === 'active' ? '已同意' : settings.consentStatus === 'withdrawn' ? '已撤回' : '从未同意'}`),
    textElement('span', '', `目标复核类型：${settings.goalReviewEnabled ? '已开启' : '已关闭'}`),
    textElement('span', '', `时区：${settings.timeZone}`),
    textElement('span', '', `每 24 小时上限：${settings.maxPer24Hours}`),
    textElement('span', '', `保留期：30 天`)
  )

  getElement<HTMLButtonElement>('#pause-reminders').disabled = !settings.enabled
  const withdraw = getElement<HTMLButtonElement>('#withdraw-reminder-consent')
  withdraw.disabled = settings.consentStatus !== 'active'
  getElement<HTMLButtonElement>('#mute-reminders').disabled = !settings.enabled || settings.consentStatus !== 'active'
  getElement<HTMLButtonElement>('#unmute-reminders').disabled = !settings.mutedUntil
}

function renderGoalOptions(goals: GoalListItem[], snapshot: ReminderSnapshot): void {
  const select = getElement<HTMLSelectElement>('#reminder-goal')
  const activeGoals = goals.filter((item) => item.goal.status === 'active')
  const options = activeGoals.map((item) => {
    const option = document.createElement('option')
    option.value = item.goal.id
    option.textContent = item.goal.intent
    return option
  })
  if (options.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '没有可安排提醒的活动目标'
    options.push(option)
  }
  select.replaceChildren(...options)
  const canSchedule = snapshot.featureEnabled && snapshot.notificationSupported && snapshot.settings.enabled &&
    snapshot.settings.goalReviewEnabled && activeGoals.length > 0
  select.disabled = !canSchedule
  getElement<HTMLInputElement>('#reminder-local-time').disabled = !canSchedule
  getElement<HTMLButtonElement>('#schedule-reminder').disabled = !canSchedule
}

function renderReminders(snapshot: ReminderSnapshot, goals: GoalListItem[]): void {
  const container = getElement<HTMLDivElement>('#reminder-list')
  const goalNames = new Map(goals.map((item) => [item.goal.id, item.goal.intent]))
  const records = snapshot.reminders
  if (records.length === 0) {
    container.replaceChildren(textElement('p', 'reminder-detail', '还没有提醒记录。'))
  } else {
    container.replaceChildren(...records.map((record) => {
      const card = document.createElement('article')
      card.className = 'reminder-card'
      const header = document.createElement('div')
      header.className = 'reminder-card-header'
      const status = textElement('span', 'reminder-status-pill', statusLabels[record.status])
      status.dataset.status = record.status
      header.append(status, textElement('span', 'goal-source', `决策：${reasonLabels[record.lastReason]}`))
      card.append(
        header,
        textElement('h3', 'reminder-goal-title', goalNames.get(record.goalId) ?? '关联目标已删除'),
        textElement('p', 'reminder-detail', `计划时间：${formatDate(record.scheduledAt, record.scheduledTimeZone)}（${record.scheduledTimeZone}）`),
        textElement('p', 'reminder-detail', `创建时间：${formatDate(record.createdAt)}`)
      )

      const actions = document.createElement('div')
      actions.className = 'reminder-actions-inline'
      if (record.status === 'scheduled' || record.status === 'showing') {
        actions.append(makeButton('取消提醒', 'button button-danger button-small', async () => {
          try {
            unwrap(await window.morrow.reminders.cancel({ reminderId: record.id }))
            showFeedback('提醒已取消。')
            await loadReminderData()
          } catch (error) {
            showError(error)
          }
        }))
      } else if (record.status === 'suppressed' || record.status === 'cancelled') {
        const form = document.createElement('form')
        form.className = 'reminder-actions-inline'
        const label = document.createElement('label')
        label.textContent = '重新安排至'
        const dateTime = document.createElement('input')
        dateTime.type = 'datetime-local'
        dateTime.required = true
        const button = document.createElement('button')
        button.type = 'submit'
        button.className = 'button button-secondary button-small'
        button.textContent = '重新安排'
        const canReschedule = snapshot.featureEnabled && snapshot.settings.enabled && snapshot.settings.goalReviewEnabled &&
          snapshot.notificationSupported && goals.some((item) => item.goal.id === record.goalId && item.goal.status === 'active')
        dateTime.disabled = !canReschedule
        button.disabled = !canReschedule
        label.append(dateTime)
        form.append(label, button)
        form.addEventListener('submit', async (event) => {
          event.preventDefault()
          if (!dateTime.value) return
          button.disabled = true
          try {
            unwrap(await window.morrow.reminders.reschedule({ reminderId: record.id, localDateTime: dateTime.value }))
            showFeedback('提醒已重新安排。')
            await loadReminderData()
          } catch (error) {
            showError(error)
          } finally {
            button.disabled = !canReschedule
          }
        })
        actions.append(form)
      }
      if (actions.childElementCount > 0) card.append(actions)
      return card
    }))
  }

  const decisionList = getElement<HTMLOListElement>('#reminder-decision-list')
  const decisions = snapshot.recentDecisions.slice(0, 20)
  if (decisions.length === 0) {
    decisionList.replaceChildren(textElement('li', '', '还没有提醒决策记录。'))
  } else {
    decisionList.replaceChildren(...decisions.map((decision) => textElement(
      'li', '',
      `${formatDate(decision.happenedAt)} · ${decisionLabels[decision.decision]} · ${reasonLabels[decision.reason]} · 规则 ${decision.ruleVersion}`
    )))
  }
}

async function loadReminderData(): Promise<void> {
  const request = ++requestSequence
  const container = getElement<HTMLDivElement>('#reminder-list')
  container.setAttribute('aria-busy', 'true')
  try {
    const [snapshot, goals] = await Promise.all([
      window.morrow.reminders.getSnapshot(),
      window.morrow.goals.list()
    ])
    if (request !== requestSequence) return
    currentSnapshot = unwrap(snapshot)
    currentGoals = unwrap(goals)
    renderSettings(currentSnapshot)
    renderGoalOptions(currentGoals, currentSnapshot)
    renderReminders(currentSnapshot, currentGoals)
  } catch (error) {
    if (request === requestSequence) showError(error)
  } finally {
    if (request === requestSequence) container.setAttribute('aria-busy', 'false')
  }
}

export async function refreshReminders(): Promise<void> {
  await loadReminderData()
}

async function updateSnapshot(action: () => Promise<IpcResult<ReminderSnapshot>>, message: string): Promise<void> {
  try {
    unwrap(await action())
    showFeedback(message)
    await loadReminderData()
  } catch (error) {
    showError(error)
  }
}

export function initializeReminders(): void {
  const form = getElement<HTMLFormElement>('#reminder-settings-form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!currentSnapshot) return
    const settings = currentSnapshot.settings
    const enabled = getElement<HTMLInputElement>('#reminders-enabled').checked
    const acceptConsent = getElement<HTMLInputElement>('#reminders-consent').checked
    if (enabled && settings.consentStatus !== 'active' && !acceptConsent) {
      showFeedback('启用前请先勾选本地提醒同意。', true)
      return
    }
    const request: ReminderSettingsRequest = {
      enabled,
      goalReviewEnabled: getElement<HTMLInputElement>('#goal-review-enabled').checked,
      acceptConsent,
      maxPer24Hours: Number(getElement<HTMLInputElement>('#reminders-max-per-day').value),
      cooldownMinutes: Number(getElement<HTMLInputElement>('#reminders-cooldown').value),
      quietHoursEnabled: getElement<HTMLInputElement>('#quiet-hours-enabled').checked,
      quietHoursStart: getElement<HTMLInputElement>('#quiet-hours-start').value,
      quietHoursEnd: getElement<HTMLInputElement>('#quiet-hours-end').value,
      timeZone: getElement<HTMLInputElement>('#reminders-time-zone').value.trim()
    }
    const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (save) save.disabled = true
    try {
      unwrap(await window.morrow.reminders.saveSettings(request))
      getElement<HTMLInputElement>('#reminders-consent').checked = false
      showFeedback(enabled ? '本地提醒设置已保存。' : '提醒设置已保存，并保持关闭。')
      await loadReminderData()
    } catch (error) {
      showError(error)
    } finally {
      if (save) save.disabled = false
    }
  })

  getElement<HTMLButtonElement>('#refresh-reminders').addEventListener('click', () => void loadReminderData())
  getElement<HTMLButtonElement>('#pause-reminders').addEventListener('click', () => {
    void updateSnapshot(() => window.morrow.reminders.pause(), '提醒已暂停，正在显示的通知已关闭。')
  })
  getElement<HTMLButtonElement>('#withdraw-reminder-consent').addEventListener('click', () => {
    if (!window.confirm('撤回后提醒会立即暂停。之后再次启用需要重新明确同意。继续？')) return
    void updateSnapshot(() => window.morrow.reminders.withdrawConsent(), '已撤回提醒同意，待处理提醒已取消。')
  })
  getElement<HTMLButtonElement>('#mute-reminders').addEventListener('click', () => {
    void updateSnapshot(() => window.morrow.reminders.muteForOneHour(), '提醒已静音一小时。')
  })
  getElement<HTMLButtonElement>('#unmute-reminders').addEventListener('click', () => {
    void updateSnapshot(() => window.morrow.reminders.unmute(), '提醒静音已取消。')
  })
  getElement<HTMLButtonElement>('#clear-reminder-history').addEventListener('click', () => {
    if (!window.confirm('删除已显示、已抑制、已取消提醒及其决策历史？待处理提醒保留且不会被执行。')) return
    void updateSnapshot(() => window.morrow.reminders.clearHistory(), '提醒历史已清除；待处理提醒仍保留。')
  })

  getElement<HTMLFormElement>('#reminder-schedule-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const goalId = getElement<HTMLSelectElement>('#reminder-goal').value
    const localDateTime = getElement<HTMLInputElement>('#reminder-local-time').value
    if (!goalId || !localDateTime) {
      showFeedback('请选择活动目标并填写提醒时间。', true)
      return
    }
    const submit = getElement<HTMLButtonElement>('#schedule-reminder')
    submit.disabled = true
    try {
      unwrap(await window.morrow.reminders.schedule({ goalId, localDateTime }))
      getElement<HTMLInputElement>('#reminder-local-time').value = ''
      showFeedback('提醒已安排。')
      await loadReminderData()
    } catch (error) {
      showError(error)
    } finally {
      submit.disabled = !currentSnapshot?.featureEnabled || !currentSnapshot.notificationSupported || !currentSnapshot.settings.enabled ||
        !currentSnapshot.settings.goalReviewEnabled
    }
  })

  window.morrow.reminders.onChanged(() => void loadReminderData())
  void loadReminderData()
}
