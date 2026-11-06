/**
 * Multi-source provider profiles (Phase 2.5).
 *
 * The panel is a thin shell over the typed bridge: list, create/update, test,
 * discover, set default and delete. It never sees a stored key (the bridge
 * returns only `apiKeyConfigured`) and it never builds a request URL itself.
 */
import type { IpcResult } from '../../shared/contracts'
import type { ProviderConfigRecord, ProviderConnectionResult, ProviderModelsResult, ProviderProfileSaveInput } from '../../shared/companion'
import { createRequestGuard } from '../../security/request-guard'

class ProfileUiError extends Error {}

const guard = createRequestGuard()

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Provider profile element is unavailable: ${selector}`)
  return found
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new ProfileUiError(result.error.message)
  return result.data
}

function feedback(message: string, isError = false): void {
  const target = element<HTMLParagraphElement>('#provider-profile-feedback')
  target.textContent = message
  target.dataset.kind = isError ? 'error' : 'success'
  target.hidden = false
}

function notifyProviderChange(): void {
  if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('morrow:providers-changed'))
}

function maskedEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.origin}${url.pathname}`
  } catch {
    return '无效地址'
  }
}

function sourceLabel(source: ProviderConfigRecord['sourceKind']): string {
  if (source === 'local') return '本机'
  if (source === 'custom-proxy') return '中转站'
  if (source === 'official') return '官方'
  return '私有网络'
}

function healthLabel(profile: ProviderConfigRecord): string {
  const test = profile.lastTest
  if (!test) return '尚未测试'
  const labels: Record<string, string> = {
    connected: '连接成功',
    auth_failed: '认证失败',
    model_not_found: '模型不存在',
    quota: '额度不足',
    timeout: '超时',
    network: '网络错误',
    protocol: '协议不兼容',
    unknown: '未知错误'
  }
  return `${labels[test.status] ?? test.status} · ${test.latencyMs}ms · ${new Date(test.testedAt).toLocaleString('zh-CN')}`
}

function renderProfile(profile: ProviderConfigRecord): HTMLElement {
  const card = document.createElement('article')
  card.className = 'pending-item'
  card.dataset.profileId = profile.id

  const body = document.createElement('div')
  body.className = 'pending-item-body'
  const kind = document.createElement('p')
  kind.className = 'pending-item-kind'
  kind.textContent = `${sourceLabel(profile.sourceKind)} · ${profile.protocolId ?? 'openai-chat-completions'}`
  const title = document.createElement('h3')
  title.className = 'pending-item-summary'
  title.textContent = `${profile.displayName ?? profile.id}${profile.isDefault ? '（默认）' : ''}`
  const meta = document.createElement('p')
  meta.className = 'pending-item-meta'
  meta.textContent = `${maskedEndpoint(profile.endpoint)} · ${profile.model} · ${profile.enabled ? '已启用' : '未启用'} · ${healthLabel(profile)}`
  const key = document.createElement('p')
  key.className = 'pending-item-meta'
  key.textContent = profile.apiKeyConfigured ? '密钥：已保存在本机安全存储' : '密钥：未配置'
  body.append(kind, title, meta, key)

  const actions = document.createElement('div')
  actions.className = 'pending-item-actions'
  const test = document.createElement('button')
  test.type = 'button'
  test.className = 'button button-secondary button-small'
  test.textContent = '测试连接'
  const discover = document.createElement('button')
  discover.type = 'button'
  discover.className = 'button button-quiet button-small'
  discover.textContent = '发现模型'
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'button button-quiet button-small'
  edit.textContent = '编辑'
  edit.disabled = profile.sourceKind === 'official'
  const makeDefault = document.createElement('button')
  makeDefault.type = 'button'
  makeDefault.className = 'button button-quiet button-small'
  makeDefault.textContent = '设为默认'
  makeDefault.disabled = profile.isDefault === true || !profile.enabled
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'button button-danger button-small'
  const builtinProfile = profile.id === 'deepseek' || profile.id === 'spark' || profile.id === 'local-openai'
  remove.textContent = '删除'
  remove.disabled = builtinProfile
  if (builtinProfile) remove.title = '内置 Provider 不能删除；可以禁用或替换凭据。'
  actions.append(test, discover, edit, makeDefault, remove)

  const run = async (action: () => Promise<void>): Promise<void> => {
    for (const button of [test, discover, edit, makeDefault, remove]) button.disabled = true
    try {
      await action()
    } catch (error) {
      feedback(error instanceof ProfileUiError ? error.message : '操作失败，请刷新后重试。', true)
    } finally {
      for (const button of [test, discover, edit, makeDefault, remove]) button.disabled = false
      makeDefault.disabled = profile.isDefault === true || !profile.enabled
      remove.disabled = builtinProfile
      edit.disabled = profile.sourceKind === 'official'
    }
  }

  test.addEventListener('click', () => void run(async () => {
    const result = unwrap(await window.morrow.providers.testConnection({ providerId: profile.id }))
    feedback(`连接成功：${result.model} · ${result.latencyMs ?? 0}ms · attempts=${result.attempts ?? 1}`)
    await loadProfiles()
  }))
  discover.addEventListener('click', () => void run(async () => {
    const result = unwrap(await window.morrow.providers.discoverModels({ profileId: profile.id }))
    feedback(result.models.length > 0 ? `发现 ${result.models.length} 个模型：${result.models.slice(0, 8).join(', ')}` : '该服务没有返回模型列表；请手动填写模型 ID。')
  }))
  edit.addEventListener('click', () => {
    disarmDelete()
    fillForm(profile)
    feedback(`正在编辑「${profile.displayName ?? profile.id}」`)
  })
  makeDefault.addEventListener('click', () => void run(async () => {
    unwrap(await window.morrow.providers.setDefaultProfile({ profileId: profile.id }))
    notifyProviderChange()
    feedback('已设为默认对话 Provider')
    await loadProfiles()
  }))
  let deleteArmed = false
  let deleteTimer: ReturnType<typeof setTimeout> | undefined
  const disarmDelete = (): void => {
    deleteArmed = false
    remove.textContent = '删除'
    delete remove.dataset.confirm
    if (deleteTimer) clearTimeout(deleteTimer)
  }
  remove.addEventListener('click', () => void run(async () => {
    if (!deleteArmed) {
      deleteArmed = true
      remove.textContent = '确认删除'
      remove.dataset.confirm = 'true'
      deleteTimer = setTimeout(disarmDelete, 5000)
      return
    }
    disarmDelete()
    unwrap(await window.morrow.providers.deleteProfile({ profileId: profile.id }))
    notifyProviderChange()
    feedback('配置已删除')
    resetForm()
    await loadProfiles()
  }))

  card.addEventListener('click', (event) => {
    if (!remove.contains(event.target as Node)) disarmDelete()
  })

  card.append(body, actions)
  return card
}

function fillForm(profile: ProviderConfigRecord): void {
  element<HTMLInputElement>('#provider-profile-id').value = profile.id
  element<HTMLInputElement>('#provider-profile-name').value = profile.displayName ?? profile.id
  element<HTMLSelectElement>('#provider-profile-source').value = profile.sourceKind === 'local' ? 'local' : 'custom-proxy'
  element<HTMLSelectElement>('#provider-profile-protocol').value = 'openai-chat-completions'
  element<HTMLInputElement>('#provider-profile-endpoint').value = profile.endpoint
  element<HTMLInputElement>('#provider-profile-endpoint-path').value = profile.endpointPath ?? ''
  element<HTMLInputElement>('#provider-profile-model').value = profile.model
  element<HTMLInputElement>('#provider-profile-api-key').value = ''
  element<HTMLInputElement>('#provider-profile-enabled').checked = profile.enabled
  element<HTMLInputElement>('#provider-profile-default').checked = profile.isDefault === true
}

function resetForm(): void {
  element<HTMLInputElement>('#provider-profile-id').value = ''
  element<HTMLFormElement>('#provider-profile-form').reset()
  element<HTMLInputElement>('#provider-profile-enabled').checked = true
}

async function loadProfiles(): Promise<void> {
  const request = guard.begin()
  const list = element<HTMLDivElement>('#provider-profile-list')
  const empty = element<HTMLParagraphElement>('#provider-profile-empty')
  list.setAttribute('aria-busy', 'true')
  try {
    const profiles = unwrap(await window.morrow.providers.listProfiles())
    if (!guard.isCurrent(request)) return
    list.replaceChildren(...profiles.map(renderProfile))
    empty.hidden = profiles.length > 0
  } catch (error) {
    if (guard.isCurrent(request)) feedback(error instanceof ProfileUiError ? error.message : '配置列表加载失败。', true)
  } finally {
    if (guard.isCurrent(request)) {
      list.setAttribute('aria-busy', 'false')
      if (document.body) document.body.dataset.providerUiReady = 'true'
    }
  }
}

async function save(): Promise<void> {
  const id = element<HTMLInputElement>('#provider-profile-id').value.trim()
  const endpointPath = element<HTMLInputElement>('#provider-profile-endpoint-path').value.trim()
  const apiKey = element<HTMLInputElement>('#provider-profile-api-key').value
  const input: ProviderProfileSaveInput = {
    ...(id ? { profileId: id } : {}),
    displayName: element<HTMLInputElement>('#provider-profile-name').value.trim(),
    sourceKind: element<HTMLSelectElement>('#provider-profile-source').value as 'custom-proxy' | 'local',
    protocolId: 'openai-chat-completions',
    endpoint: element<HTMLInputElement>('#provider-profile-endpoint').value.trim(),
    ...(endpointPath ? { endpointPath } : {}),
    model: element<HTMLInputElement>('#provider-profile-model').value.trim(),
    enabled: element<HTMLInputElement>('#provider-profile-enabled').checked,
    isDefault: element<HTMLInputElement>('#provider-profile-default').checked,
    ...(apiKey.trim() ? { apiKey } : {})
  }
  const saved = unwrap(await window.morrow.providers.saveProfile(input))
  notifyProviderChange()
  element<HTMLInputElement>('#provider-profile-api-key').value = ''
  if (!saved.enabled && !saved.apiKeyConfigured && saved.sourceKind !== 'local') {
    feedback(`已保存「${saved.displayName ?? saved.id}」。接入地址已变更，旧密钥已清除；请重新输入 API Key 并启用后使用。`)
  } else {
    feedback(`已保存「${saved.displayName ?? saved.id}」`)
  }
  fillForm(saved)
  await loadProfiles()
}

export function initializeProviderProfiles(): void {
  element<HTMLButtonElement>('#refresh-provider-profiles').addEventListener('click', () => void loadProfiles())
  element<HTMLButtonElement>('#provider-profile-reset').addEventListener('click', () => { resetForm(); feedback('已清空表单，可新建配置。') })
  element<HTMLButtonElement>('#provider-profile-discover').addEventListener('click', () => {
    const id = element<HTMLInputElement>('#provider-profile-id').value.trim()
    if (!id) { feedback('请先保存配置，再发现模型。', true); return }
    void (async () => {
      try {
        const result: ProviderModelsResult = unwrap(await window.morrow.providers.discoverModels({ profileId: id }))
        feedback(result.models.length > 0 ? `发现模型：${result.models.slice(0, 10).join(', ')}` : '服务未返回模型列表，请手动填写。')
      } catch (error) {
        feedback(error instanceof ProfileUiError ? error.message : '模型发现失败。', true)
      }
    })()
  })
  element<HTMLButtonElement>('#provider-profile-test').addEventListener('click', () => {
    const id = element<HTMLInputElement>('#provider-profile-id').value.trim()
    if (!id) { feedback('请先保存配置，再测试连接。', true); return }
    void (async () => {
      try {
        const result: ProviderConnectionResult = unwrap(await window.morrow.providers.testConnection({ providerId: id }))
        feedback(result.connected
          ? `连接成功：${result.model}${result.latencyMs === undefined ? '' : ` · ${result.latencyMs}ms`}`
          : '连接已返回，但没有可用回复。', !result.connected)
        await loadProfiles()
      } catch (error) {
        feedback(error instanceof ProfileUiError ? error.message : '连接测试失败。', true)
      }
    })()
  })
  element<HTMLFormElement>('#provider-profile-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void save().catch((error: unknown) => feedback(error instanceof ProfileUiError ? error.message : '保存失败，请检查输入。', true))
  })
  void loadProfiles()
}
