import { buildStack } from '../evals/stage-3/runner/harness'
async function main() {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  const mem = stack.memories.create('我对花生过敏。', 'personal')
  try {
    stack.factMemory.reindexMemory(mem.id)
    console.log('reindex ok:', JSON.stringify(stack.factMemory.counts()))
  } catch (e) {
    console.log('REINDEX ERROR:', e instanceof Error ? e.message : e)
  }
  stack.close()
}
void main()
