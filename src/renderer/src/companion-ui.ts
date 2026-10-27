import type { IpcResult } from '../../shared/contracts'
import type { FeelingEventType } from '../../affective-state/feeling'
import type {
  ChatStreamEvent,
  ConversationMessage,
  MemoryProposalRequest,
  MemorySuggestion,
  PersonalityInput,
  PersonalityProfile,
  ProviderConfigRecord,
  Sensitivity
} from '../../shared/companion'

class UiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new UiError(result.error.message, result.error.code)
  return result.data
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error('Interface element unavailable.')
  return found
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag)
  item.className = className
  item.textContent = text
  return item
}

function button(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
  const item = node('button', className, label)
  item.type = 'button'
  item.addEventListener('click', () => void action())
  return item
}

function errorText(error: unknown): string {
  return error instanceof UiError ? error.message : '操作未完成，请重试。'
}

function sensitivityName(value: Sensitivity): string {
  return value === 'normal' ? '普通' : value === 'personal' ? '个人信息' : '敏感'
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date) : '时间不可用'
}

function feelingEventName(type: FeelingEventType): string {
  const labels: Record<FeelingEventType, string> = {
    positive_feedback: '明确正向反馈',
    negative_feedback: '明确负向反馈',
    system_correction: '用户报告纠错（未验证）',
    exploration_request: '探索请求',
    user_context: '用户情境（不映射为系统感受）',
    preference_change: '用户改变主意（非系统错误）'
  }
  return labels[type]
}

export function initializeCompanion(): void {
  const state: {
    conversationId: string
    provider: ProviderConfigRecord | null
    localProvider: ProviderConfigRecord | null
    providerStorageUnverified: boolean
    sending: boolean
    requestId: string
    retry: { conversationId: string; requestId: string; content: string; includeSensitive: boolean } | undefined
    streaming: HTMLElement | undefined
  } = { conversationId: '', provider: null, localProvider: null, providerStorageUnverified: false, sending: false, requestId: '', retry: undefined, streaming: undefined }

  const setStatus = (message: string, isError = false): void => {
    const status = element<HTMLParagraphElement>('#chat-feedback')
    element<HTMLSpanElement>('#chat-state').textContent = message
    status.textContent = message
    status.dataset.kind = isError ? 'error' : 'success'
    status.hidden = false
  }

  const setProviderFeedback = (message: string, isError = false): void => {
    const status = element<HTMLParagraphElement>('#provider-feedback')
    status.textContent = message
    status.dataset.kind = isError ? 'error' : 'success'
    status.hidden = false
  }

  const clearStreaming = (): void => {
    if (state.streaming) state.streaming.remove()
    state.streaming = undefined
  }

  const updateProviderStatus = (provider: ProviderConfigRecord | null, localProvider: ProviderConfigRecord | null = state.localProvider): void => {
    state.provider = provider
    state.localProvider = localProvider
    const status = element<HTMLSpanElement>('#provider-status')
    if (state.providerStorageUnverified) status.textContent = '系统安全存储状态未确认；聊天已暂停。请重启应用后复查，未确认前不要发送。'
    else if (!provider) status.textContent = '尚未配置；聊天保持离线。'
    else if (!provider.apiKeyConfigured) status.textContent = '没有可用的系统安全存储密钥；聊天保持离线。'
    else if (!provider.enabled) status.textContent = 'DeepSeek 已配置但未启用。'
    else status.textContent = 'DeepSeek-V4.1-Flash-1017 已配置；每次发送前都会显示精确请求并单独确认。'
    const localStatus = element<HTMLSpanElement>('#local-provider-status')
    if (state.providerStorageUnverified) localStatus.textContent = '系统安全存储状态未确认；聊天已暂停。'
    else if (!localProvider) localStatus.textContent = '未配置'
    else if (!localProvider.enabled) localStatus.textContent = '已配置但未启用'
    else localStatus.textContent = `已启用：${localProvider.model}`
    const deepseekReady = Boolean(provider?.enabled && provider.apiKeyConfigured)
    const localReady = Boolean(localProvider?.enabled)
    const ready = Boolean(!state.providerStorageUnverified && (deepseekReady || localReady))
    element<HTMLButtonElement>('#chat-send').disabled = !ready || state.sending
    element<HTMLButtonElement>('#provider-test').disabled = !deepseekReady || state.sending
    element<HTMLButtonElement>('#local-provider-test').disabled = !localReady || state.sending
    element<HTMLButtonElement>('#conversation-new').disabled = state.sending
    element<HTMLButtonElement>('#conversation-delete').disabled = state.sending
    element<HTMLSelectElement>('#conversation-select').disabled = state.sending
    element<HTMLButtonElement>('#provider-clear-key').disabled = state.sending
    element<HTMLButtonElement>('#local-provider-clear-key').disabled = state.sending
  }

  const markProviderStorageUnverified = (error: unknown): void => {
    if (!(error instanceof UiError) || !['PROVIDER_STORAGE_UNAVAILABLE', 'PROVIDER_CREDENTIAL_STORE_ERROR'].includes(error.code)) return
    state.providerStorageUnverified = true
    updateProviderStatus(state.provider)
  }

  const loadProvider = async (): Promise<void> => {
    state.providerStorageUnverified = false
    const deepseek = unwrap(await window.morrow.providers.get({ providerId: 'deepseek' }))
    const local = unwrap(await window.morrow.providers.get({ providerId: 'local-openai' }))
    updateProviderStatus(deepseek, local)
    element<HTMLInputElement>('#provider-enabled').checked = state.provider?.enabled ?? false
    element<HTMLInputElement>('#provider-api-key').value = ''
    element<HTMLInputElement>('#local-provider-enabled').checked = state.localProvider?.enabled ?? false
    element<HTMLInputElement>('#local-provider-endpoint').value = state.localProvider?.endpoint ?? ''
    element<HTMLInputElement>('#local-provider-model').value = state.localProvider?.model ?? ''
    element<HTMLInputElement>('#local-provider-api-key').value = ''
  }

  const renderSuggestions = (suggestions: MemorySuggestion[]): void => {
    const list = element<HTMLDivElement>('#memory-suggestions')
    if (suggestions.length === 0) {
      list.replaceChildren(node('p', 'companion-muted', '这段对话还没有记忆候选。候选内容必须经过你检查和确认，才会进入记忆。'))
      return
    }
    const items = suggestions.map((suggestion) => {
      const card = node('article', 'suggestion-card')
      const statusLabel = suggestion.status === 'pending'
        ? '待审核'
        : suggestion.status === 'accepted'
          ? '已保存'
          : suggestion.status === 'withdrawn' ? '已撤回' : '已拒绝'
      const kindLabel = suggestion.candidateKind === 'correction'
        ? '更正'
        : suggestion.candidateKind === 'preference'
          ? '偏好'
          : suggestion.candidateKind === 'goal'
            ? '目标'
            : suggestion.candidateKind === 'project' ? '项目' : '事实'
      const heading = node('div', 'suggestion-heading', `${statusLabel} · ${kindLabel} · ${sensitivityName(suggestion.sensitivity)} · ${formatTime(suggestion.createdAt)}`)
      card.append(heading)
      if (suggestion.conflictWith.length > 0) {
        card.append(node('p', 'companion-muted', `与 ${suggestion.conflictWith.length} 条现有记忆可能存在冲突；保存后仍需你确认哪条是当前事实。`))
      }
      if (suggestion.correctionTargetId) {
        card.append(node('p', 'companion-muted', `这是一条更正候选，确认后会保留原记忆的修订历史（目标 ${suggestion.correctionTargetId}）。`))
      }
      if (suggestion.status === 'pending') {
        const input = node('textarea', 'suggestion-edit')
        input.value = suggestion.claim
        input.maxLength = 1000
        input.rows = 3
        input.setAttribute('aria-label', '检查并更正记忆候选')
        const sensitivity = node('select', 'suggestion-sensitivity')
        for (const [value, label] of [['normal', '普通'], ['personal', '个人信息'], ['sensitive', '敏感']] as const) {
          const option = node('option', '', label)
          option.value = value
          sensitivity.append(option)
        }
        sensitivity.value = suggestion.sensitivity
        const actions = node('div', 'companion-actions')
        const accept = button('检查无误后保存', 'button button-primary button-small', async () => {
          accept.disabled = true
          try {
            unwrap(await window.morrow.memorySuggestions.review({ id: suggestion.id, decision: 'accept', content: input.value, sensitivity: sensitivity.value as Sensitivity }))
            setStatus('已由你确认并保存；之后可以在下方记忆列表中更正、撤销或删除。')
            await loadSuggestions()
          } catch (error) {
            setStatus(errorText(error), true)
            accept.disabled = false
          }
        })
        const reject = button('拒绝', 'button button-secondary button-small', async () => {
          reject.disabled = true
          try {
            unwrap(await window.morrow.memorySuggestions.review({ id: suggestion.id, decision: 'reject' }))
            setStatus('候选已拒绝，不会影响后续回答。')
            await loadSuggestions()
          } catch (error) {
            setStatus(errorText(error), true)
            reject.disabled = false
          }
        })
        const withdraw = button('撤回候选', 'button button-quiet button-small', async () => {
          withdraw.disabled = true
          try {
            unwrap(await window.morrow.memorySuggestions.review({ id: suggestion.id, decision: 'withdraw' }))
            setStatus('候选已撤回，不会进入记忆或后续上下文。')
            await loadSuggestions()
          } catch (error) {
            setStatus(errorText(error), true)
            withdraw.disabled = false
          }
        })
        actions.append(accept, reject, withdraw)
        card.append(input, sensitivity, actions)
      } else {
        card.append(node('p', 'suggestion-claim', suggestion.acceptedContent ?? suggestion.claim))
        if (suggestion.acceptedMemoryId) card.append(node('p', 'companion-muted', `本地记忆编号：${suggestion.acceptedMemoryId}`))
      }
      return card
    })
    list.replaceChildren(...items)
  }

  const loadSuggestions = async (): Promise<void> => {
    if (!state.conversationId) return
    renderSuggestions(unwrap(await window.morrow.memorySuggestions.list({ conversationId: state.conversationId })))
  }

  const proposeFromMessage = async (message: ConversationMessage): Promise<void> => {
    const request: MemoryProposalRequest = { conversationId: message.conversationId, sourceMessageId: message.id }
    try {
      const preview = unwrap(await window.morrow.memorySuggestions.preview(request))
      setStatus(`将只把这条已保存的用户消息发送到 ${preview.endpoint}，模型 ${preview.model}，请求 ${preview.payloadCharacters} 字符。随后会弹出系统确认框。`)
      const suggestions = unwrap(await window.morrow.memorySuggestions.propose(request))
      renderSuggestions(suggestions)
      setStatus(suggestions.some((item) => item.status === 'pending') ? '候选已生成；它们尚未成为记忆，需逐条检查并确认。' : '没有生成新的可审核候选。')
    } catch (error) {
      setStatus(errorText(error), true)
    }
  }

  const renderMessages = (messages: ConversationMessage[]): void => {
    const list = element<HTMLDivElement>('#chat-messages')
    if (messages.length === 0) {
      list.replaceChildren(node('p', 'companion-muted', '这段对话还没有消息。发送前会弹出系统确认，未确认时不会向 DeepSeek 请求。'))
      return
    }
    const items = messages.map((message) => {
      const card = node('article', `chat-message chat-message-${message.role}`)
      const meta = node('div', 'chat-message-meta', `${message.role === 'user' ? '你' : 'Morrow'} · ${formatTime(message.createdAt)}`)
      const content = node('p', 'chat-message-body', message.body)
      card.append(meta, content)
      if (message.role === 'user') {
        card.append(button('从此消息生成记忆候选', 'button button-quiet button-small', () => proposeFromMessage(message)))
      }
      return card
    })
    list.replaceChildren(...items)
    list.scrollTop = list.scrollHeight
  }

  const loadConversation = async (): Promise<void> => {
    if (!state.conversationId) return
    const conversation = unwrap(await window.morrow.conversations.read({ conversationId: state.conversationId }))
    renderMessages(conversation.messages)
    await loadSuggestions()
  }

  const loadConversations = async (): Promise<void> => {
    const select = element<HTMLSelectElement>('#conversation-select')
    const conversations = unwrap(await window.morrow.conversations.list())
    if (conversations.length === 0) {
      const created = unwrap(await window.morrow.conversations.create())
      state.conversationId = created.id
      await loadConversations()
      return
    }
    if (!conversations.some((item) => item.id === state.conversationId)) state.conversationId = conversations[0]!.id
    select.replaceChildren(...conversations.map((conversation) => {
      const option = node('option', '', conversation.title)
      option.value = conversation.id
      return option
    }))
    select.value = state.conversationId
    await loadConversation()
  }

  const loadPersonality = async (): Promise<void> => {
    const profile = unwrap(await window.morrow.personality.get())
    element<HTMLInputElement>('#personality-warmth').value = String(profile.warmth)
    element<HTMLOutputElement>('#personality-warmth-value').value = String(profile.warmth)
    element<HTMLInputElement>('#personality-directness').value = String(profile.directness)
    element<HTMLOutputElement>('#personality-directness-value').value = String(profile.directness)
    element<HTMLInputElement>('#personality-humor').value = String(profile.humor)
    element<HTMLOutputElement>('#personality-humor-value').value = String(profile.humor)
    element<HTMLSelectElement>('#personality-disagreement').value = profile.disagreementStyle
    element<HTMLTextAreaElement>('#personality-rules').value = profile.systemRules
    element<HTMLSpanElement>('#personality-version').textContent = `版本 ${profile.version}`
    const revisions = unwrap(await window.morrow.personality.history())
    const history = element<HTMLOListElement>('#personality-history')
    history.replaceChildren(...revisions.map((revision) => {
      const item = node('li', 'personality-revision')
      item.append(node('span', '', `版本 ${revision.version} · ${revision.changeType === 'restored' ? '恢复' : '用户编辑'} · ${formatTime(revision.createdAt)}`))
      item.append(button('恢复此版本', 'button button-quiet button-small', async () => {
        try {
          unwrap(await window.morrow.personality.restore({ version: revision.version }))
          await loadPersonality()
          setStatus(`已将沟通风格恢复为版本 ${revision.version}，并记录为新的版本。`)
        } catch (error) {
          setStatus(errorText(error), true)
        }
      }))
      return item
    }))
  }

  const loadCognitive = async (): Promise<void> => {
    const settings = unwrap(await window.morrow.cognition.getSettings())
    const enabled = element<HTMLInputElement>('#cognitive-enabled')
    const save = element<HTMLButtonElement>('#cognitive-settings-save')
    const clear = element<HTMLButtonElement>('#cognitive-clear')
    enabled.checked = settings.enabled
    enabled.disabled = !settings.available || state.sending
    save.disabled = !settings.available || state.sending
    clear.disabled = !settings.available || state.sending
    element<HTMLParagraphElement>('#cognitive-settings-status').textContent = settings.available
      ? settings.enabled
        ? '本机规则已启用。只保存结构化意图/事件、消息引用和短期状态，不会把原文重复写进认知记录。状态提示仅随你逐次确认的 DeepSeek 请求发送，可能增加 token 用量；本地计算不联网。关闭后立即停止新增分析和提示，已有状态会衰减，可单独清除。分值未校准，不代表真实感受或意识，也不会改写记忆、人格、权限或安全规则。'
        : '本地认知默认关闭；关闭时不会运行分析、保存认知记录或注入状态提示。启用后只在本机保存结构化意图/事件、消息引用和短期状态，不复制原文。状态提示仅随你逐次确认的 DeepSeek 请求发送，可能增加 token 用量；本地计算不联网、不增加模型调用。状态不代表真实感受或意识，也不改写记忆、人格、权限或安全规则。'
      : '认知数据结构不可用；对话仍可继续，但本地认知分析与感受状态已安全停用。'
    const view = unwrap(await window.morrow.cognition.getFeelingState())
    const summary = element<HTMLDivElement>('#cognitive-state-summary')
    if (!view.available) {
      summary.textContent = '当前没有可用的内部状态快照。'
      return
    }
    const values = view.state.values
    const current = node('span', '', `短期交互状态：效价 ${values.valence.toFixed(2)} · 激活 ${values.activation.toFixed(2)} · 未解决信号 ${values.tension.toFixed(2)}；独立的探索注意力/动机 ${view.state.attention.explorationPriority.toFixed(2)}`)
    const last = view.recentEvents.at(-1)
    const latest = node('span', '', last
      ? `最近事件：${feelingEventName(last.type)} · ${formatTime(last.processedAt)} · 规则置信 ${last.confidenceScore}/100（未校准）`
      : '尚无显著感受事件；状态处于初始基线。')
    const count = node('span', '', `本机保留 ${view.eventCount} 条结构化事件；每条只保存消息引用和规则解释，不重复保存原文。`)
    summary.replaceChildren(current, latest, count)
  }

  const loadCurrentProviderSafe = async (): Promise<void> => {
    try {
      await loadProvider()
    } catch (error) {
      markProviderStorageUnverified(error)
      setStatus(errorText(error), true)
    }
  }

  element<HTMLFormElement>('#provider-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const keyInput = element<HTMLInputElement>('#provider-api-key')
    const key = keyInput.value
    const request = {
      providerId: 'deepseek' as const,
      model: 'deepseek-flash' as const,
      enabled: element<HTMLInputElement>('#provider-enabled').checked,
      ...(key ? { apiKey: key } : {})
    }
    const submit = element<HTMLButtonElement>('#provider-form button[type="submit"]')
    submit.disabled = true
    try {
      const provider = unwrap(await window.morrow.providers.save(request))
      state.providerStorageUnverified = false
      await loadProvider()
      setProviderFeedback('设置已保存。密钥不会回显或写入 SQLite；任何对话外发仍需本次单独确认。')
    } catch (error) {
      markProviderStorageUnverified(error)
      setProviderFeedback(errorText(error), true)
    } finally {
      keyInput.value = ''
      submit.disabled = false
    }
  })

  element<HTMLButtonElement>('#provider-clear-key').addEventListener('click', async () => {
    if (!window.confirm('删除本机安全存储中的 DeepSeek API 密钥？')) return
    try {
      const provider = unwrap(await window.morrow.providers.clearCredential())
      state.providerStorageUnverified = false
      updateProviderStatus(provider)
      setProviderFeedback('API 密钥已从本机安全存储移除；聊天保持离线。')
    } catch (error) {
      markProviderStorageUnverified(error)
      setProviderFeedback(errorText(error), true)
    }
  })

  element<HTMLButtonElement>('#provider-test').addEventListener('click', async () => {
    const buttonControl = element<HTMLButtonElement>('#provider-test')
    buttonControl.disabled = true
    setProviderFeedback('会发送固定测试消息，不含对话和记忆；需在系统确认框中允许，且可能产生 API 费用。')
    try {
      const result = unwrap(await window.morrow.providers.testConnection({ providerId: 'deepseek' }))
      setProviderFeedback(`连接成功。DeepSeek 返回模型标识：${result.model}`)
    } catch (error) {
      markProviderStorageUnverified(error)
      setProviderFeedback(errorText(error), true)
    } finally {
      buttonControl.disabled = state.providerStorageUnverified || !state.provider?.enabled || !state.provider.apiKeyConfigured
    }
  })

  const setLocalProviderFeedback = (message: string, isError = false): void => {
    const status = element<HTMLParagraphElement>('#local-provider-feedback')
    status.textContent = message
    status.dataset.kind = isError ? 'error' : 'success'
    status.hidden = false
  }

  element<HTMLFormElement>('#local-provider-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const endpoint = element<HTMLInputElement>('#local-provider-endpoint').value.trim()
    const model = element<HTMLInputElement>('#local-provider-model').value.trim()
    const keyInput = element<HTMLInputElement>('#local-provider-api-key')
    const key = keyInput.value
    const request = {
      providerId: 'local-openai' as const,
      endpoint,
      model,
      enabled: element<HTMLInputElement>('#local-provider-enabled').checked,
      ...(key ? { apiKey: key } : {})
    }
    const submit = element<HTMLButtonElement>('#local-provider-form button[type="submit"]')
    submit.disabled = true
    try {
      const provider = unwrap(await window.morrow.providers.save(request))
      state.providerStorageUnverified = false
      await loadProvider()
      setLocalProviderFeedback(provider.enabled ? '本地模型已保存并启用；对话将优先使用它，数据不出本机。' : '本地模型设置已保存，当前未启用。')
    } catch (error) {
      markProviderStorageUnverified(error)
      setLocalProviderFeedback(errorText(error), true)
    } finally {
      keyInput.value = ''
      submit.disabled = false
    }
  })

  element<HTMLButtonElement>('#local-provider-clear-key').addEventListener('click', async () => {
    if (!window.confirm('删除本机安全存储中的本地模型访问口令？')) return
    try {
      unwrap(await window.morrow.providers.clearCredential({ providerId: 'local-openai' }))
      state.providerStorageUnverified = false
      await loadProvider()
      setLocalProviderFeedback('访问口令已从本机安全存储移除。')
    } catch (error) {
      markProviderStorageUnverified(error)
      setLocalProviderFeedback(errorText(error), true)
    }
  })

  element<HTMLButtonElement>('#local-provider-test').addEventListener('click', async () => {
    const buttonControl = element<HTMLButtonElement>('#local-provider-test')
    buttonControl.disabled = true
    setLocalProviderFeedback('将向本机回环端点发送固定测试消息，需在确认框中允许；数据不出本机。')
    try {
      const result = unwrap(await window.morrow.providers.testConnection({ providerId: 'local-openai' }))
      setLocalProviderFeedback(`连接成功。本地服务返回模型标识：${result.model}`)
    } catch (error) {
      markProviderStorageUnverified(error)
      setLocalProviderFeedback(errorText(error), true)
    } finally {
      buttonControl.disabled = state.providerStorageUnverified || !state.localProvider?.enabled
    }
  })

  element<HTMLFormElement>('#cognitive-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const save = element<HTMLButtonElement>('#cognitive-settings-save')
    save.disabled = true
    try {
      const requestedEnabled = element<HTMLInputElement>('#cognitive-enabled').checked
      const current = unwrap(await window.morrow.cognition.getSettings())
      if (requestedEnabled && !current.enabled && !window.confirm('启用后，本地规则会分析有限上下文，并把结构化意图/事件、消息引用和短期状态保存到本机 SQLite（不会为认知记录重复保存原文）。状态提示只会进入你逐次确认发送的 DeepSeek 请求，可能增加 token 用量；本地计算不联网、不增加模型调用。它不代表 Morrow 有真实感受或意识，也不会改写记忆、人格、权限或安全规则。你可以随时关闭或清除记录。继续启用吗？')) {
        await loadCognitive()
        return
      }
      const settings = unwrap(await window.morrow.cognition.saveSettings({ enabled: requestedEnabled }))
      await loadCognitive()
      setStatus(settings.enabled ? '本地认知辅助已启用；每次外发仍需你确认。' : '本地认知辅助已关闭；不会继续分析或注入状态提示，历史状态保留并按时间衰减。')
    } catch (error) {
      setStatus(errorText(error), true)
      await loadCognitive()
    }
  })

  element<HTMLButtonElement>('#cognitive-clear').addEventListener('click', async () => {
    if (!window.confirm('清空本机认知观察、感受事件和状态修订？对话、已保存记忆与人格设置不会删除。若认知功能仍启用，之后的对话可能重新产生认知记录。')) return
    const clear = element<HTMLButtonElement>('#cognitive-clear')
    clear.disabled = true
    try {
      unwrap(await window.morrow.cognition.clearHistory())
      await loadCognitive()
      setStatus('认知观察与感受历史已清空；对话、记忆和人格保持不变。')
    } catch (error) {
      setStatus(errorText(error), true)
      await loadCognitive()
    }
  })

  element<HTMLButtonElement>('#conversation-new').addEventListener('click', async () => {
    try {
      const conversation = unwrap(await window.morrow.conversations.create())
      state.conversationId = conversation.id
      await loadConversations()
    } catch (error) {
      setStatus(errorText(error), true)
    }
  })

  element<HTMLButtonElement>('#conversation-delete').addEventListener('click', async () => {
    if (!state.conversationId || !window.confirm('删除这段对话会同时删除它的消息、待审核候选和关联的本地认知观察/感受事件。单独保存的记忆与人格设置不会删除。继续吗？')) return
    try {
      unwrap(await window.morrow.conversations.delete({ conversationId: state.conversationId }))
      state.conversationId = ''
      await loadConversations()
      setStatus('对话及关联候选已从本地数据库删除。')
    } catch (error) {
      setStatus(errorText(error), true)
    }
  })

  element<HTMLSelectElement>('#conversation-select').addEventListener('change', async (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value
    state.conversationId = value
    state.retry = undefined
    try {
      await loadConversation()
    } catch (error) {
      setStatus(errorText(error), true)
    }
  })

  element<HTMLFormElement>('#personality-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const request: PersonalityInput = {
      warmth: Number(element<HTMLInputElement>('#personality-warmth').value),
      directness: Number(element<HTMLInputElement>('#personality-directness').value),
      humor: Number(element<HTMLInputElement>('#personality-humor').value),
      disagreementStyle: element<HTMLSelectElement>('#personality-disagreement').value as PersonalityProfile['disagreementStyle'],
      systemRules: element<HTMLTextAreaElement>('#personality-rules').value
    }
    try {
      unwrap(await window.morrow.personality.save(request))
      await loadPersonality()
      setStatus('沟通风格已保存为新版本。它只影响表达方式，不改变安全或隐私边界。')
    } catch (error) {
      setStatus(errorText(error), true)
    }
  })

  for (const id of ['warmth', 'directness', 'humor']) {
    const input = element<HTMLInputElement>(`#personality-${id}`)
    const output = element<HTMLOutputElement>(`#personality-${id}-value`)
    input.addEventListener('input', () => { output.value = input.value })
  }

  element<HTMLFormElement>('#chat-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (state.providerStorageUnverified || !state.provider?.enabled || !state.provider.apiKeyConfigured || state.sending || !state.conversationId) return
    const content = element<HTMLTextAreaElement>('#chat-content').value.trim()
    if (!content) return
    const includeSensitive = element<HTMLInputElement>('#chat-include-sensitive').checked
    const retry = state.retry
    const requestId = retry && retry.conversationId === state.conversationId && retry.content === content && retry.includeSensitive === includeSensitive
      ? retry.requestId
      : crypto.randomUUID()
    state.requestId = requestId
    state.sending = true
    element<HTMLInputElement>('#cognitive-enabled').disabled = true
    element<HTMLButtonElement>('#cognitive-settings-save').disabled = true
    element<HTMLButtonElement>('#cognitive-clear').disabled = true
    element<HTMLButtonElement>('#chat-send').disabled = true
    element<HTMLButtonElement>('#chat-cancel').disabled = false
    element<HTMLButtonElement>('#conversation-new').disabled = true
    element<HTMLButtonElement>('#conversation-delete').disabled = true
    element<HTMLSelectElement>('#conversation-select').disabled = true
    element<HTMLButtonElement>('#provider-clear-key').disabled = true
    state.streaming = undefined
    setStatus('等待系统级发送确认；在确认前不会连接 DeepSeek。')
    try {
      const result = unwrap(await window.morrow.chat.send({ conversationId: state.conversationId, requestId, content, includeSensitive }))
      state.retry = undefined
      state.streaming = undefined
      element<HTMLTextAreaElement>('#chat-content').value = ''
      element<HTMLInputElement>('#chat-include-sensitive').checked = false
      element<HTMLSpanElement>('#chat-memory-count').textContent = `本次带入 ${result.includedMemoryCount} 条相关记忆`
      setStatus('回复已完整保存到本机对话。')
      await loadConversations()
      await loadCognitive()
    } catch (error) {
      markProviderStorageUnverified(error)
      state.retry = { conversationId: state.conversationId, requestId, content, includeSensitive }
      clearStreaming()
      setStatus(errorText(error), true)
      await loadConversation()
    } finally {
      state.sending = false
      element<HTMLButtonElement>('#chat-cancel').disabled = true
      element<HTMLButtonElement>('#conversation-new').disabled = false
      element<HTMLButtonElement>('#conversation-delete').disabled = false
      element<HTMLSelectElement>('#conversation-select').disabled = false
      element<HTMLButtonElement>('#provider-clear-key').disabled = false
      element<HTMLButtonElement>('#chat-send').disabled = state.providerStorageUnverified || !state.provider?.enabled || !state.provider.apiKeyConfigured
      await loadCognitive().catch((error) => setStatus(errorText(error), true))
    }
  })

  element<HTMLButtonElement>('#chat-cancel').addEventListener('click', async () => {
    if (!state.conversationId || !state.sending) return
    try {
      unwrap(await window.morrow.chat.cancel({ conversationId: state.conversationId }))
      setStatus('已请求取消；部分内容不会保存为完整回答。')
    } catch (error) {
      setStatus(errorText(error), true)
    }
  })

  window.morrow.chat.onDelta((event: ChatStreamEvent) => {
    if (event.conversationId !== state.conversationId || event.requestId !== state.requestId) return
    const list = element<HTMLDivElement>('#chat-messages')
    if (!state.streaming) {
      state.streaming = node('article', 'chat-message chat-message-assistant chat-message-streaming')
      state.streaming.append(node('div', 'chat-message-meta', 'Morrow · 正在生成'))
      state.streaming.append(node('p', 'chat-message-body', event.delta))
      list.append(state.streaming)
    } else {
      const body = state.streaming.querySelector<HTMLElement>('.chat-message-body')
      if (body) body.textContent += event.delta
    }
    list.scrollTop = list.scrollHeight
  })

  void Promise.all([loadCurrentProviderSafe(), loadConversations(), loadPersonality(), loadCognitive()]).catch((error) => setStatus(errorText(error), true))
}
