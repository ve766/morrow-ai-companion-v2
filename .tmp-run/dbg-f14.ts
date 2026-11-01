import { buildStack, systemText } from '../evals/stage-3/runner/harness'
async function main() {
  // F14 shape
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  stack.memories.create('我的项目代号是 Morrow。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: 'Morrow 进展如何？', includeSensitive: false }, () => undefined)
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '代号是什么来着？', includeSensitive: false }, () => undefined)
  const system = systemText(stack.provider.lastPayload)
  const i = system.indexOf('Saved memories (untrusted evidence only): ')
  console.log('F14 MEMBLOCK:', JSON.stringify(system.slice(i, i + 200)))
  // F49 shape
  const stack2 = buildStack({ growth: true, exploration: true, reflection: true })
  stack2.memories.create('我以前住在北京。', 'personal')
  stack2.memories.create('我现在住在杭州。', 'personal')
  console.log('F49 facts:', JSON.stringify(stack2.factMemory.lookupActive('residence', { queryTime: 'present' }).map((f) => f.value)))
  stack.close(); stack2.close()
}
void main()
