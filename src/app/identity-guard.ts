/**
 * Deterministic identity guard (Issue #67 §7).
 *
 * The system contract is the primary fix. This guard covers the cases where a
 * Provider still ignores it: identity questions are answered from the
 * application's own contract, never from a provider's default self-description.
 * It only intercepts explicit identity questions; normal conversation is not
 * templated.
 */
export interface IdentityProvider {
  id: string
  displayName?: string
  model: string
}

const IDENTITY_PATTERNS = [
  /你(?:叫|是)(?:什么|谁|哪个|干嘛的|做什么的)/u,
  /(?:你的)?名字/u,
  /你是什么模型|你用的?是什么模型|哪个模型/u,
  /你是(?:不是)?(?:讯飞|星火|deepseek|spark|gemini|claude|gpt)/iu,
  /你和.{0,20}(?:讯飞|星火|deepseek|spark|provider|模型).{0,20}关系/iu,
  /切换.{0,20}(?:deepseek|spark|模型|provider)/iu,
  /为什么叫\s*morrow/iu,
  /(?:不知道|没有).{0,20}经历/u,
  /who are you|what(?:'s| is) your name|what model are you|are you (?:spark|deepseek|gemini|claude|gpt)/iu
]

export function isIdentityQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC')
  return IDENTITY_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function identityGuardReply(text: string, provider: IdentityProvider): string | null {
  if (!isIdentityQuestion(text)) return null
  const backend = `${provider.displayName?.trim() || provider.id} / ${provider.model}`
  const lines: string[] = ['我是 Morrow，一个运行在这台电脑上的 AI 伴侣。']
  const asksModel = /模型/u.test(text) || /model/iu.test(text)
  const asksProvider = /(?:讯飞|星火|deepseek|spark|gemini|claude|gpt|provider)/iu.test(text)
  const asksSwitch = /切换|换成|switch/iu.test(text)
  const asksName = /为什么叫\s*morrow|名字.{0,12}(?:由来|来源|怎么来)|why.*(?:named|called).*morrow/iu.test(text)
  const asksUnknown = /(?:不知道|没有).{0,20}经历/u.test(text)
  if (asksModel || asksProvider) {
    lines.push(`当前会话的底层模型服务是 ${backend}；它只是计算基础设施，不是我的身份。`)
  }
  if (asksProvider) {
    lines.push(`我无法确认该服务商的版本、归属或其他细节；能确认的只有它是本次对话使用的后端。`)
  }
  if (asksSwitch) {
    lines.push('切换 Provider、模型或端点不会改变我是 Morrow；它们只是算力来源。')
  }
  if (asksName) {
    lines.push('我没有关于命名由来的可靠证据，因此不编造来源。')
  }
  if (asksUnknown) {
    lines.push('不知道的经历我会直接说不知道，不编造故事或感受。')
  }
  // Greeting/generic identity question: name is the direct answer.
  if (!asksModel && !asksProvider && !asksSwitch && !asksName && !asksUnknown) {
    lines.push(`当前会话的底层模型服务是 ${backend}，但它是基础设施，不是我的身份。`)
  }
  return lines.join('\n')
}
