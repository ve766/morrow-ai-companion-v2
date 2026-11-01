import { analyzeCognitiveTurnDetailed } from '../src/cognition/cognitive-turn-analyzer'
import { policyForIntent } from '../src/memory/retrieval-policy'
import { readFactSlot } from '../src/memory/fact-slot'
const q = '我觉得我现在住在苏州。'
const turn = analyzeCognitiveTurnDetailed(q, [], '00000000-0000-4000-8000-000000000001')
console.log('intent:', turn.decision?.intent, '| strategy:', turn.analysis?.strategy)
const policy = policyForIntent(turn.decision?.intent ?? 'ambiguous')
console.log('policy:', JSON.stringify({ intent: policy.intent, max: policy.maxMemories, overlap: policy.requireContentOverlap, filter: policy.predicateFilter, conflicts: policy.admitConflictingEvidence }))
console.log('querySlot:', JSON.stringify(readFactSlot(q)))
void 0
