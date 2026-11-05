/**
 * Provider profile panel: real bridge calls, form population and status text.
 * A small DOM stub is used because the renderer suite runs in node.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeElement {
  className = ''
  textContent = ''
  type = ''
  value = ''
  checked = false
  disabled = false
  hidden = false
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  listeners: Array<(event?: unknown) => unknown> = []
  attributes: Record<string, string> = {}
  append(...nodes: FakeElement[]): void { this.children.push(...nodes) }
  replaceChildren(...nodes: FakeElement[]): void { this.children = [...nodes] }
  addEventListener(_event: string, listener: (event?: unknown) => unknown): void { this.listeners.push(listener) }
  setAttribute(name: string, value: string): void { this.attributes[name] = value }
  reset(): void { this.value = ''; this.checked = false }
}

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Relay A',
  sourceKind: 'custom-proxy' as const,
  protocolId: 'openai-chat-completions' as const,
  providerClass: 'remote' as const,
  endpoint: 'https://relay-a.example.com/v1',
  endpointPath: null,
  model: 'gemini-3-flash',
  enabled: true,
  isDefault: true,
  apiKeyConfigured: true,
  capabilities: undefined,
  lastTest: { status: 'connected' as const, testedAt: '2026-11-04T00:00:00.000Z', latencyMs: 120, endpointDigest: 'abcdef0123456789', model: 'gemini-3-flash', httpStatus: null, attempts: 1 },
  updatedAt: '2026-11-04T00:00:00.000Z'
}

const ids = [
  'provider-profile-list', 'provider-profile-empty', 'provider-profile-feedback',
  'provider-profile-id', 'provider-profile-name', 'provider-profile-source', 'provider-profile-protocol',
  'provider-profile-endpoint', 'provider-profile-endpoint-path', 'provider-profile-model',
  'provider-profile-api-key', 'provider-profile-enabled', 'provider-profile-default',
  'provider-profile-form', 'provider-profile-reset', 'provider-profile-discover', 'refresh-provider-profiles'
]

function installDom(): Record<string, FakeElement> {
  const elements: Record<string, FakeElement> = {}
  for (const id of ids) elements[id] = new FakeElement()
  elements['provider-profile-list']!.children = []
  ;(globalThis as unknown as { document: unknown }).document = {
    querySelector: (selector: string) => elements[selector.replace(/^#/u, '')] ?? null,
    createElement: () => new FakeElement()
  }
  return elements
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document
  delete (globalThis as unknown as { window?: unknown }).window
  vi.restoreAllMocks()
})

function bridge(): { saveProfile: ReturnType<typeof vi.fn>; testConnection: ReturnType<typeof vi.fn>; deleteProfile: ReturnType<typeof vi.fn>; setDefaultProfile: ReturnType<typeof vi.fn>; discoverModels: ReturnType<typeof vi.fn>; listProfiles: ReturnType<typeof vi.fn> } {
  const listProfiles = vi.fn(async () => ({ ok: true as const, data: [profile] }))
  const saveProfile = vi.fn(async (request: unknown) => ({ ok: true as const, data: { ...profile, ...(request as object) } }))
  const testConnection = vi.fn(async () => ({ ok: true as const, data: { providerId: profile.id, model: profile.model, connected: true, status: 'connected', latencyMs: 120, attempts: 1 } }))
  const deleteProfile = vi.fn(async () => ({ ok: true as const, data: undefined }))
  const setDefaultProfile = vi.fn(async () => ({ ok: true as const, data: profile }))
  const discoverModels = vi.fn(async () => ({ ok: true as const, data: { profileId: profile.id, models: ['gemini-3-flash'], source: 'discovered', discoveredAt: '2026-11-04T00:00:00.000Z' } }))
  ;(globalThis as unknown as { window: unknown }).window = {
    morrow: { providers: { listProfiles, saveProfile, testConnection, deleteProfile, setDefaultProfile, discoverModels } }
  }
  return { saveProfile, testConnection, deleteProfile, setDefaultProfile, discoverModels, listProfiles }
}

async function load(): Promise<Record<string, FakeElement>> {
  const elements = installDom()
  const { initializeProviderProfiles } = await import('../src/renderer/src/provider-profiles-ui')
  initializeProviderProfiles()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return elements
}

describe('provider profile renderer', () => {
  it('renders real profiles with masked endpoint and health', async () => {
    bridge()
    const elements = await load()
    const card = elements['provider-profile-list']!.children[0]!
    expect(card.children[0]!.children[1]!.textContent).toContain('Relay A')
    expect(card.children[0]!.children[2]!.textContent).toContain('https://relay-a.example.com/v1')
    expect(card.children[0]!.children[2]!.textContent).toContain('连接成功')
    expect(elements['provider-profile-empty']!.hidden).toBe(true)
  })

  it('fills the form when editing and saves through the bridge', async () => {
    const calls = bridge()
    const elements = await load()
    const card = elements['provider-profile-list']!.children[0]!
    const edit = card.children[1]!.children[2]!
    await edit.listeners[0]!()
    expect(elements['provider-profile-id']!.value).toBe(profile.id)
    expect(elements['provider-profile-endpoint']!.value).toBe(profile.endpoint)
    elements['provider-profile-model']!.value = 'gemini-3.1-pro'
    await elements['provider-profile-form']!.listeners[0]!({ preventDefault: () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.id,
      displayName: 'Relay A',
      model: 'gemini-3.1-pro',
      sourceKind: 'custom-proxy',
      endpoint: profile.endpoint
    }))
    expect(elements['provider-profile-feedback']!.textContent).toContain('已保存')
  })

  it('tests a profile and reports the real connection result', async () => {
    const calls = bridge()
    const elements = await load()
    const test = elements['provider-profile-list']!.children[0]!.children[1]!.children[0]!
    await test.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.testConnection).toHaveBeenCalledWith({ providerId: profile.id })
    expect(elements['provider-profile-feedback']!.textContent).toContain('连接成功')
  })

  it('requires a second click before deleting a profile', async () => {
    const calls = bridge()
    const elements = await load()
    const actions = elements['provider-profile-list']!.children[0]!.children[1]!
    const remove = actions.children[4]!
    await remove.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.deleteProfile).not.toHaveBeenCalled()
    expect(remove.textContent).toBe('确认删除')
    expect(remove.dataset.confirm).toBe('true')
    await remove.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.deleteProfile).toHaveBeenCalledWith({ profileId: profile.id })
  })

  it('deletes and sets default only through the bridge', async () => {
    const calls = bridge()
    const elements = await load()
    const actions = elements['provider-profile-list']!.children[0]!.children[1]!
    await actions.children[4]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await actions.children[4]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.deleteProfile).toHaveBeenCalledWith({ profileId: profile.id })
    await actions.children[3]!.listeners[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.setDefaultProfile).toHaveBeenCalledWith({ profileId: profile.id })
  })

  it('disables edit and delete for an official built-in profile', async () => {
    const calls = bridge()
    calls.listProfiles.mockResolvedValueOnce({
      ok: true as const,
      data: [{
        ...profile,
        id: 'deepseek',
        displayName: 'DeepSeek',
        sourceKind: 'official' as const,
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-flash'
      }]
    })
    const elements = await load()
    const actions = elements['provider-profile-list']!.children[0]!.children[1]!
    expect(actions.children[2]!.disabled).toBe(true)
    expect(actions.children[4]!.disabled).toBe(true)
  })

  it('prompts for a new key when a destination change clears the credential', async () => {
    const calls = bridge()
    calls.saveProfile.mockResolvedValueOnce({
      ok: true as const,
      data: { ...profile, enabled: false, apiKeyConfigured: false, lastTest: null, capabilities: undefined }
    })
    const elements = await load()
    const card = elements['provider-profile-list']!.children[0]!
    const edit = card.children[1]!.children[2]!
    await edit.listeners[0]!()
    elements['provider-profile-endpoint']!.value = 'https://relay-new.example.com'
    await elements['provider-profile-form']!.listeners[0]!({ preventDefault: () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(elements['provider-profile-feedback']!.textContent).toContain('旧密钥已清除')
    expect(elements['provider-profile-enabled']!.checked).toBe(false)
  })
})
