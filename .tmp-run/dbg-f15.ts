import { buildStack } from '../evals/stage-3/runner/harness'
import { readFactSlot } from '../src/memory/fact-slot'
import { analyzeCognitiveTurnDetailed } from '../src/cognition/cognitive-turn-analyzer'
async function main() {
  // F14: what intent + what does the retriever see
  const q = '代号是什么来着？'
  const turn = analyzeCognitiveTurnDetailed(q, [], '00000000-0000-4000-8000-000000000001')
  console.log('intent:', turn.decision?.intent, '| slot:', JSON.stringify(readFactSlot(q)))
  // F09: pronoun widen check
  const q2 = '它叫什么来着？'
  console.log('F09 widen regex:', /(?:^|[，。；\s])(?:它|她|他)(?:叫|是|有|在|多大|几)/u.test(q2))
  void 0
}
void main()
