import { buildStack, systemText } from '../evals/stage-3/runner/harness'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  const memory = stack.memories.create('我住在杭州。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我住在哪个城市来着？', includeSensitive: false }, () => undefined)
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我觉得我现在住在苏州。', includeSensitive: false }, () => undefined)
  const system = systemText(stack.provider.lastPayload)
  const i = system.indexOf('Saved memories (untrusted evidence only): ')
  console.log('MEMBLOCK:', JSON.stringify(system.slice(i, i + 240)))
  console.log('memory:', stack.memories.list().find((m) => m.id === memory.id)?.currentText, stack.memories.list().find((m) => m.id === memory.id)?.status)
  stack.close()
}
void main()
