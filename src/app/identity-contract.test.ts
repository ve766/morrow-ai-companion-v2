import { describe, expect, it } from 'vitest'
import { identityContract } from './companion-service'

describe('provider-independent identity contract', () => {
  it('names Morrow as the subject and the backend only as infrastructure', () => {
    const contract = identityContract({ id: 'spark', displayName: 'Spark', model: 'spark-x2.6' })
    expect(contract).toContain('You are Morrow')
    expect(contract).toContain('Spark / spark-x2.6')
    expect(contract).toContain('computing infrastructure, not your identity')
    expect(contract).toContain('Never introduce yourself as that provider or model')
    expect(contract).toContain('Changing provider, model, endpoint, conversation, or restarting the app does not change who you are')
  })

  it('does not hard-code any provider as Morrow identity', () => {
    const contract = identityContract({ id: 'deepseek', model: 'deepseek-flash' })
    expect(contract).toContain('Morrow')
    expect(contract).not.toMatch(/Morrow is (?:DeepSeek|Spark|讯飞星火)/u)
  })
})
