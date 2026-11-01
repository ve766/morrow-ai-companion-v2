import { buildStack, systemText } from '../evals/stage-3/runner/harness'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  stack.memories.create('我以前住在北京。', 'personal')
  stack.memories.create('我现在住在杭州。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我现在住在哪里？', includeSensitive: false }, () => undefined)
  const sys = systemText(stack.provider.lastPayload)
  const i = sys.indexOf('memories":[')
  console.log('ENTRIES:', JSON.stringify(sys.slice(i, i + 420)))
  stack.close()
}
void main()
