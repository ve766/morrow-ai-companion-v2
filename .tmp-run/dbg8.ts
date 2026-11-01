import { buildStack, systemText } from '../evals/stage-3/runner/harness'
import { readFactSlot } from '../src/memory/fact-slot'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  const memory = stack.memories.create('我住在杭州。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我住在哪个城市来着？', includeSensitive: false }, () => undefined)
  const q = '我觉得我现在住在苏州。'
  console.log('querySlot:', JSON.stringify(readFactSlot(q)))
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: q, includeSensitive: false }, () => undefined)
  const ctx = await stack.memories.assembleContext(q, 'personal')
  console.log('direct:', JSON.stringify(ctx.selected.map((s) => s.content)))
  const system = systemText(stack.provider.lastPayload)
  const i = system.indexOf('Saved memories (untrusted evidence only): ')
  console.log('MEMBLOCK:', JSON.stringify(system.slice(i, i + 200)))
  stack.close()
}
void main()
