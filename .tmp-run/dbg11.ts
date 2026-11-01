import { buildStack } from '../evals/stage-3/runner/harness'
import { analyzeCognitiveTurnDetailed, boundCognitiveHistory } from '../src/cognition/cognitive-turn-analyzer'
import { policyForIntent } from '../src/memory/retrieval-policy'
import { buildRetrievalQuery } from '../src/app/companion-service'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  stack.memories.create('我住在杭州。', 'personal')
  const conversation = stack.companion.createConversation()
  await stack.companion.sendChat({ conversationId: conversation.id, requestId: crypto.randomUUID(), content: '我住在哪个城市来着？', includeSensitive: false }, () => undefined)
  const read = stack.companion.readConversation({ conversationId: conversation.id })
  const history = read.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const cognitive = boundCognitiveHistory(history.map(({ id, role, body }) => ({ id, role, body })))
  const turn = analyzeCognitiveTurnDetailed('我觉得我现在住在苏州。', cognitive, '00000000-0000-4000-8000-000000000001')
  console.log('strategy:', turn.analysis?.strategy, '| topicRef:', turn.analysis?.topicReferenceMessageId)
  const referenced = turn.analysis?.topicReferenceMessageId ? cognitive.find((m) => m.id === turn.analysis!.topicReferenceMessageId) : undefined
  const priorUser = [...cognitive].reverse().find((m) => m.role === 'user')
  const query = buildRetrievalQuery({ content: '我觉得我现在住在苏州。', referencedBody: referenced?.body, priorUserBody: priorUser?.body, widen: turn.analysis?.strategy === 'retrieve_memory' })
  console.log('QUERY:', JSON.stringify(query))
  const policy = policyForIntent(turn.decision?.intent ?? 'ambiguous')
  const ctx = await stack.memories.assembleContext(query, 'personal', policy)
  console.log('selected:', JSON.stringify(ctx.selected.map((s) => s.content)))
  stack.close()
}
void main()
