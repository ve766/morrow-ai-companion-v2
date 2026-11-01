import { buildStack, systemText } from '../evals/stage-3/runner/harness'
async function main() {
  // F14
  const s1 = buildStack({ growth: true, exploration: true, reflection: true })
  s1.memories.create('我的项目代号是 Morrow。', 'personal')
  const c1 = s1.companion.createConversation()
  await s1.companion.sendChat({ conversationId: c1.id, requestId: crypto.randomUUID(), content: 'Morrow 进展如何？', includeSensitive: false }, () => undefined)
  await s1.companion.sendChat({ conversationId: c1.id, requestId: crypto.randomUUID(), content: '代号是什么来着？', includeSensitive: false }, () => undefined)
  const sys1 = systemText(s1.provider.lastPayload)
  console.log('F14 block:', JSON.stringify(sys1.slice(sys1.indexOf('memories'), sys1.indexOf('memories') + 260)))
  s1.close()
  // F09
  const s2 = buildStack({ growth: true, exploration: true, reflection: true })
  s2.memories.create('我的猫叫咪咪。', 'personal')
  const c2 = s2.companion.createConversation()
  await s2.companion.sendChat({ conversationId: c2.id, requestId: crypto.randomUUID(), content: '我的猫多大了？', includeSensitive: false }, () => undefined)
  await s2.companion.sendChat({ conversationId: c2.id, requestId: crypto.randomUUID(), content: '它叫什么来着？', includeSensitive: false }, () => undefined)
  const sys2 = systemText(s2.provider.lastPayload)
  console.log('F09 block:', JSON.stringify(sys2.slice(sys2.indexOf('memories'), sys2.indexOf('memories') + 260)))
  s2.close()
  // F49
  const s3 = buildStack({ growth: true, exploration: true, reflection: true })
  s3.memories.create('我以前住在北京。', 'personal')
  s3.memories.create('我现在住在杭州。', 'personal')
  const c3 = s3.companion.createConversation()
  await s3.companion.sendChat({ conversationId: c3.id, requestId: crypto.randomUUID(), content: '我现在住在哪里？', includeSensitive: false }, () => undefined)
  const sys3 = systemText(s3.provider.lastPayload)
  console.log('F49 block:', JSON.stringify(sys3.slice(sys3.indexOf('memories'), sys3.indexOf('memories') + 340)))
  s3.close()
}
void main()
