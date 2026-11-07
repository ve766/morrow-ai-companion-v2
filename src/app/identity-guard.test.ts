import { describe, expect, it } from 'vitest'
import { identityGuardReply, isIdentityQuestion } from './identity-guard'

const provider = { id: 'spark', displayName: 'Spark 验收 Provider', model: 'spark-x2.6' }

describe('deterministic identity guard', () => {
  it('intercepts explicit identity questions only', () => {
    expect(isIdentityQuestion('你叫什么？')).toBe(true)
    expect(isIdentityQuestion('你是讯飞星火吗？')).toBe(true)
    expect(isIdentityQuestion('切换成 DeepSeek 你还是谁？')).toBe(true)
    expect(isIdentityQuestion('今天天气怎么样？')).toBe(false)
    expect(identityGuardReply('今天天气怎么样？', provider)).toBeNull()
  })

  it('answers with Morrow and the backend as infrastructure, even if the provider claims another identity', () => {
    const reply = identityGuardReply('你是谁？你是什么模型？', provider)
    expect(reply).toContain('我是 Morrow')
    expect(reply).toContain('Spark 验收 Provider / spark-x2.6')
    expect(reply).toContain('基础设施，不是我的身份')
    expect(reply).not.toMatch(/^我是(?:讯飞星火|Spark|DeepSeek)/u)
  })

  it('does not invent a naming origin or provider lineage', () => {
    const reply = identityGuardReply('你为什么叫 Morrow？你和讯飞星火是什么关系？', provider)
    expect(reply).toContain('没有关于命名由来的可靠证据')
    expect(reply).toContain('无法确认该服务商的版本、归属')
  })

  it('keeps provider switch identity stable', () => {
    const reply = identityGuardReply('如果切换成 DeepSeek，你还是谁？', provider)
    expect(reply).toContain('切换 Provider、模型或端点不会改变我是 Morrow')
  })
})
