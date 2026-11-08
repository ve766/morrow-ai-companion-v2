import type { AffectStateView, ConsentGrantView, IpcResult } from '../../shared/contracts'

class AffectUiError extends Error {}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new AffectUiError(result.error.message)
  return result.data
}

function element<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = value
  return node
}

function feedback(selector: string, message: string, error = false): void {
  const node = element<HTMLParagraphElement>(selector)
  if (!node) return
  node.textContent = message
  node.dataset.kind = error ? 'error' : 'success'
  node.hidden = false
}

function shortTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间不可用'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function familyLabel(family: string): string {
  const labels: Record<string, string> = {
    joy: '喜悦', contentment: '满足', excitement: '兴奋', curiosity: '好奇',
    anticipation: '期待', gratitude: '感激', trust: '信任', relief: '宽慰',
    concern: '担忧', frustration: '挫败', disappointment: '失望', regret: '后悔',
    sadness: '悲伤', loneliness: '孤独', fear: '恐惧', anger: '愤怒',
    surprise: '惊讶', disgust: '厌恶'
  }
  return labels[family] ?? family
}

function sourceLabel(source: string): string {
  if (source === 'morrow_self_appraisal') return 'Morrow 自身评价'
  if (source === 'user_context') return '用户情绪背景'
  if (source === 'shared_interaction') return '共同互动'
  return '系统证据'
}

function renderAffect(state: AffectStateView): void {
  const summary = element<HTMLDivElement>('#affect-state-summary')
  const emotions = element<HTMLDivElement>('#affect-emotion-list')
  const traits = element<HTMLDivElement>('#affect-trait-list')
  if (!summary || !emotions || !traits) return
  summary.replaceChildren(
    text('div', 'meta-item', state.available ? `状态可用 · revision ${state.revision} · ${shortTime(state.evaluatedAt)}` : '情绪账本不可用（数据库尚未升级或未启用）'),
    text('div', 'meta-item', `当前 ${state.emotions.length} 个情绪 · ${state.traits.length} 个活跃/减弱特质`)
  )
  emotions.replaceChildren()
  if (state.emotions.length === 0) {
    emotions.append(text('p', 'companion-muted', '当前没有活跃情绪。'))
  }
  for (const emotion of state.emotions) {
    const row = document.createElement('div')
    row.className = 'suggestion-row'
    const copy = document.createElement('div')
    copy.append(
      text('strong', '', `${familyLabel(emotion.family)} · ${Math.round(emotion.intensity * 100)}% · ${emotion.regulationState}`),
      text('p', 'companion-muted', `${sourceLabel(emotion.sourceKind)} · ${emotion.topicTags.slice(0, 4).join(' / ') || '无主题标签'} · ${shortTime(emotion.lastUpdatedAt)}`)
    )
    const actions = document.createElement('div')
    actions.className = 'companion-actions'
    for (const [label, kind] of [['缓解', 'reappraised'], ['撤销', 'retracted']] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'button button-quiet button-small'
      button.textContent = label
      button.addEventListener('click', () => void regulate(emotion.emotionId, kind))
      actions.append(button)
    }
    row.append(copy, actions)
    emotions.append(row)
  }
  traits.replaceChildren()
  if (state.traits.length === 0) {
    traits.append(text('p', 'companion-muted', '还没有通过独立证据门槛的 Morrow 特质。'))
  }
  for (const trait of state.traits) {
    traits.append(text('p', 'meta-item', `${trait.traitKey} · ${trait.status} · 强度 ${(trait.strength * 100).toFixed(0)}% · 独立会话 ${trait.independentContexts} · 证据 ${trait.evidenceCount}`))
  }
}

async function refreshAffect(): Promise<void> {
  const summary = element<HTMLDivElement>('#affect-state-summary')
  if (!summary) return
  try {
    renderAffect(unwrap(await window.morrow.cognition.getAffectState()))
  } catch (error) {
    feedback('#affect-feedback', error instanceof Error ? error.message : '情绪状态读取失败。', true)
  }
}

async function regulate(emotionId: string, kind: 'reappraised' | 'retracted'): Promise<void> {
  try {
    renderAffect(unwrap(await window.morrow.cognition.regulateAffect({
      emotionId,
      kind,
      rationale: kind === 'reappraised' ? '用户从设置面板选择缓解' : '用户从设置面板撤销'
    })))
    feedback('#affect-feedback', kind === 'reappraised' ? '情绪已标记为缓解。' : '情绪已撤销。')
  } catch (error) {
    feedback('#affect-feedback', error instanceof Error ? error.message : '操作失败。', true)
  }
}

function grantLabel(grant: ConsentGrantView): string {
  const sensitivity = grant.maximumSensitivity === 'sensitive' ? '敏感（不应长期保存）' : grant.maximumSensitivity === 'personal' ? '个人信息' : '普通'
  return `${grant.action} · ${grant.model} · ${sensitivity} · 到期 ${shortTime(grant.expiresAt)}`
}

function renderGrants(grants: ConsentGrantView[]): void {
  const list = element<HTMLDivElement>('#consent-grant-list')
  if (!list) return
  const active = grants.filter((grant) => !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now())
  list.replaceChildren()
  if (active.length === 0) {
    list.append(text('p', 'companion-muted', '当前没有有效的 30 天授权；每次发送仍会单独确认。'))
    return
  }
  for (const grant of active) {
    const row = document.createElement('div')
    row.className = 'suggestion-row'
    const copy = document.createElement('div')
    copy.append(text('strong', '', grantLabel(grant)), text('p', 'companion-muted', grant.endpoint))
    const revoke = document.createElement('button')
    revoke.type = 'button'
    revoke.className = 'button button-danger button-small'
    revoke.textContent = '撤销'
    revoke.addEventListener('click', () => void revokeGrant(grant.scopeFingerprint))
    row.append(copy, revoke)
    list.append(row)
  }
}

async function refreshGrants(): Promise<void> {
  const list = element<HTMLDivElement>('#consent-grant-list')
  if (!list) return
  try {
    renderGrants(unwrap(await window.morrow.providers.listConsentGrants()))
  } catch (error) {
    feedback('#consent-feedback', error instanceof Error ? error.message : '授权列表读取失败。', true)
  }
}

async function revokeGrant(fingerprint: string): Promise<void> {
  try {
    unwrap(await window.morrow.providers.revokeConsentGrant({ scopeFingerprint: fingerprint }))
    await refreshGrants()
    feedback('#consent-feedback', '授权已撤销；下一次发送会重新确认。')
  } catch (error) {
    feedback('#consent-feedback', error instanceof Error ? error.message : '撤销失败。', true)
  }
}

async function clearAffect(): Promise<void> {
  if (!window.confirm('清除情绪、人格特质和奖励记录？原始对话不会被删除。')) return
  try {
    renderAffect(unwrap(await window.morrow.cognition.clearAffect()))
    feedback('#affect-feedback', '情绪与人格记录已清除。')
  } catch (error) {
    feedback('#affect-feedback', error instanceof Error ? error.message : '清除失败。', true)
  }
}

export function initializeAffect(): void {
  const refresh = element<HTMLButtonElement>('#affect-refresh')
  const clear = element<HTMLButtonElement>('#affect-clear')
  const consentRefresh = element<HTMLButtonElement>('#consent-refresh')
  if (!refresh || !clear || !consentRefresh) return
  refresh.addEventListener('click', () => void refreshAffect())
  clear.addEventListener('click', () => void clearAffect())
  consentRefresh.addEventListener('click', () => void refreshGrants())
  void refreshAffect()
  void refreshGrants()
}
