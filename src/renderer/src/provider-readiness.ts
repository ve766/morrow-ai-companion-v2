import type { ProviderConfigRecord } from '../../shared/companion'

/** A local loopback profile does not need a credential; a remote one does. */
export function isProviderUsable(profile: ProviderConfigRecord | null | undefined): boolean {
  if (!profile?.enabled) return false
  return profile.sourceKind === 'local' || profile.apiKeyConfigured
}

/**
 * Mirrors ProviderConfigService.requireConfigured(): explicit default first,
 * then the legacy local → spark → deepseek order, then a custom profile.
 */
export function selectChatProvider(profiles: readonly ProviderConfigRecord[]): ProviderConfigRecord | null {
  const byId = (id: string): ProviderConfigRecord | undefined =>
    profiles.find((profile) => profile.id === id && profile.enabled)
  return profiles.find((profile) => profile.isDefault && profile.enabled)
    ?? byId('local-openai')
    ?? byId('spark')
    ?? byId('deepseek')
    ?? profiles.find((profile) => profile.enabled && profile.sourceKind !== 'official')
    ?? null
}
