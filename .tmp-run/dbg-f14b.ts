import { buildStack, systemText } from '../evals/stage-3/runner/harness'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  stack.memories.create('我的项目代号是 Morrow。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: 'Morrow 进展如何？', includeSensitive: false }, () => undefined)
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '代号是什么来着？', includeSensitive: false }, () => undefined)
  const sys = systemText(stack.provider.lastPayload)
  console.log('has 代号:', sys.includes('代号'), '| has Morrow:', sys.includes('Morrow'))
  const i = sys.indexOf('Saved memories (untrusted evidence only): ')
  console.log('block:', JSON.stringify(sys.slice(i, i + 240)))
  stack.close()
}
void main()
