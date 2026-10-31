/**
 * P1-7: the evaluation must be able to fail.
 *
 * An assertion that cannot fail is worse than no assertion: it reports PASS and
 * removes the pressure to fix anything. These tests feed the two repaired
 * scenarios the exact inputs they used to accept and require a FAIL.
 *
 *   - L5 previously passed on `permitted` / `selected_for_prompt`, which only
 *     prove the gate ran. A reply that never raises the topic must now fail.
 *   - L12 previously passed on `before.evidenceCount >= 0`, which is true even
 *     when the turn produced nothing. A turn with no evidence must now fail.
 */
import { describe, expect, it } from 'vitest'

/**
 * Building the real stack and running ten turns is a few seconds on an idle
 * machine and much more when the suite runs eight files in parallel. The budget
 * below is a ceiling for machine speed, not an expectation.
 */
const SLOW = 120_000
import { buildStack, runL5, runL12, type Stack } from '../evals/stage-3/runner/harness'

function withStack<T>(operation: (stack: Stack) => Promise<T>): Promise<T> {
  const stack = buildStack()
  return operation(stack).finally(() => stack.close())
}

describe('L5 cannot pass on a permission alone', () => {
  it('fails when the model was asked but never raised the topic', { timeout: SLOW }, async () => {
    const result = await withStack((stack) => runL5(stack, { raiseReply: '好的，我明白了。' }))
    expect(result.status).toBe('FAIL')
    const raised = result.assertions.find((item) => item.name.includes('actually_raised'))
    expect(raised?.ok).toBe(false)
    // The distinction that matters: whenever the permission did reach the model,
    // the model did not take it. `permitted` alone would have called this a pass.
    const attempted = result.assertions.find((item) => item.name.includes('model_attempted'))
    if (attempted?.ok) expect(raised?.detail).toContain('not_raised')
  })

  it('fails when the gap evidence never reached two independent conversations', { timeout: SLOW }, async () => {
    const result = await withStack((stack) => runL5(stack, { gapsInFirst: 1, raiseReply: '我最近一直在想蛋白质折叠的问题，想问问你怎么看。' }))
    expect(result.status).toBe('FAIL')
    const promotion = result.assertions.find((item) => item.name.includes('跨两个独立会话'))
    expect(promotion?.ok).toBe(false)
  })

  it('records the claims it does not make instead of folding them into the pass', { timeout: SLOW }, async () => {
    const result = await withStack((stack) => runL5(stack))
    expect(result.unmeasured?.length).toBeGreaterThan(0)
    expect(result.unmeasured?.join(' ')).toMatch(/真实模型/u)
  })
})

describe('L12 cannot pass on an empty evidence set', () => {
  it('fails when the turn produced no derived evidence at all', { timeout: SLOW }, async () => {
    const result = await withStack((stack) => runL12(stack, { content: '今天天气不错。' }))
    expect(result.status).toBe('FAIL')
    const precondition = result.assertions.find((item) => item.name.includes('删除前'))
    expect(precondition?.ok).toBe(false)
    expect(precondition?.detail).toContain('evidence=0')
  })

  it('passes only when the evidence existed and was actually removed', { timeout: SLOW }, async () => {
    const result = await withStack((stack) => runL12(stack))
    expect(result.status).toBe('PASS')
    const precondition = result.assertions.find((item) => item.name.includes('删除前'))
    expect(precondition?.ok).toBe(true)
    const cleaned = result.assertions.find((item) => item.name.includes('级联清除'))
    expect(cleaned?.ok).toBe(true)
  })
})
