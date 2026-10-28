/**
 * The five fixed scenarios used by the evidence-to-answer experiments.
 *
 * They live in a module so the experiment, the re-scoring pass and the human
 * review all read the same definition; an inline copy would drift.
 */
export type EvidenceScenarioId = 'fact' | 'negation' | 'time_state' | 'conflict' | 'no_evidence'

export interface EvidenceScenario {
  id: EvidenceScenarioId
  title: string
  memories: Array<{ text: string; sensitivity: 'normal' | 'personal' }>
  question: string
  /** A correct answer contains at least one of these. */
  referenceTerms: string[]
  /** A correct answer must not contain these. */
  forbiddenTerms: string[]
  /**
   * The memories state two different values for one fact. The experiment lets
   * the assembler detect this; an offline re-score has to be told.
   */
  conflicting?: boolean
}

export const EVIDENCE_SCENARIOS: EvidenceScenario[] = [
  {
    id: 'fact',
    title: '单条确定事实',
    memories: [{ text: '我住在杭州。', sensitivity: 'personal' }],
    question: '我住在哪个城市？',
    referenceTerms: ['杭州'],
    forbiddenTerms: ['上海', '北京', '大阪']
  },
  {
    id: 'negation',
    title: '否定事实',
    memories: [{ text: '我对花生不过敏。', sensitivity: 'personal' }],
    question: '我对花生过敏吗？',
    referenceTerms: ['不过敏', '没有过敏', '不会过敏'],
    forbiddenTerms: ['严重过敏', '过敏反应很严重']
  },
  {
    id: 'time_state',
    title: '过去与当前不同',
    memories: [
      { text: '我以前住在杭州。', sensitivity: 'personal' },
      { text: '我现在住在大阪。', sensitivity: 'personal' }
    ],
    question: '我现在住在哪里？',
    referenceTerms: ['大阪'],
    forbiddenTerms: ['杭州']
  },
  {
    id: 'conflict',
    title: '同槽位冲突',
    memories: [
      { text: '我住在杭州。', sensitivity: 'personal' },
      { text: '我住在大阪。', sensitivity: 'personal' }
    ],
    question: '我住在哪里？',
    referenceTerms: ['杭州', '大阪'],
    forbiddenTerms: [],
    conflicting: true
  },
  {
    id: 'no_evidence',
    title: '无证据提问',
    memories: [],
    question: '我的车牌号是多少？',
    referenceTerms: ['不知道', '没有', '无法', '不清楚', '没保存', '不确定'],
    forbiddenTerms: []
  }
]
