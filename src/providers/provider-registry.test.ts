import { describe, expect, it } from 'vitest'
import { isRemoteConfigValid, remoteSpecFor } from './provider-registry'
import { SPARK_MAAS_BASE_URL } from '../shared/companion'

describe('phase 2.3: remote provider registry', () => {
  it('accepts the Spark MaaS host with an account model id', () => {
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, 'xdeepseekv3')).toBe(true)
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, 'xop3qwen235b')).toBe(true)
  })

  it('rejects a Spark config on any other host', () => {
    expect(isRemoteConfigValid('spark', 'https://example.com/v1', 'xdeepseekv3')).toBe(false)
    expect(isRemoteConfigValid('spark', 'http://maas-api.cn-huabei-1.xf-yun.com/v1', 'xdeepseekv3')).toBe(false)
    expect(isRemoteConfigValid('spark', `${SPARK_MAAS_BASE_URL}/../v1`, 'xdeepseekv3')).toBe(false)
  })

  it('rejects a model id outside the strict character set', () => {
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, '')).toBe(false)
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, 'x deepseek')).toBe(false)
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, '模型')).toBe(false)
    expect(isRemoteConfigValid('spark', SPARK_MAAS_BASE_URL, '-leading')).toBe(false)
  })

  it('keeps the DeepSeek contract unchanged', () => {
    expect(isRemoteConfigValid('deepseek', 'https://api.deepseek.com', 'deepseek-flash')).toBe(true)
    expect(isRemoteConfigValid('deepseek', 'https://api.deepseek.com', 'xdeepseekv3')).toBe(false)
    expect(isRemoteConfigValid('deepseek', SPARK_MAAS_BASE_URL, 'deepseek-flash')).toBe(false)
  })

  it('has no spec for an unknown provider', () => {
    expect(remoteSpecFor('openai')).toBeNull()
    expect(isRemoteConfigValid('openai', 'https://api.openai.com/v1', 'gpt-4o')).toBe(false)
  })
})
