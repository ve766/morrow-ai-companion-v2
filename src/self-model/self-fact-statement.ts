/**
 * Derives a self-model statement without copying the user's message.
 *
 * The previous implementation stored `content.slice(0, 2000)` verbatim in
 * `self_model_entries.statement`, which made the derived table a second copy of
 * private conversation text and bypassed the message-deletion boundary. This
 * module reduces a turn to a single structured predicate/value pair (for
 * example `居住地：杭州`) using the same fact-slot reader the memory layer uses.
 *
 * Rules:
 *   - only an affirmative single-predicate assertion produces a statement;
 *   - questions, negations and hedged statements produce nothing, because the
 *     self-model has no confirmation path for them;
 *   - the value is bounded, and an unreadable turn yields `null` rather than a
 *     vague placeholder that would later reach the prompt as noise.
 */
import { readFactSlot, type FactPredicate } from '../memory/fact-slot'

const PREDICATE_LABELS: Readonly<Record<FactPredicate, string>> = {
  residence: '居住地',
  employer: '工作单位',
  job_role: '职位',
  study: '学习',
  preference: '偏好',
  goal: '目标',
  name: '称呼',
  age: '年龄',
  project_code: '项目代号',
  pet_name: '宠物名字',
  object_location: '物品位置',
  health: '健康状况',
  schedule: '日程'
}

/** A statement longer than this is not a minimal fact and is not stored. */
export const SELF_FACT_STATEMENT_MAX = 80
/** A value longer than this is treated as prose, not as a slot value. */
const SELF_FACT_VALUE_MAX = 40

export function deriveSelfFactStatement(content: string): string | null {
  if (typeof content !== 'string') return null
  const slot = readFactSlot(content)
  if (!slot) return null
  if (slot.kind !== 'assertion') return null
  const value = slot.value.normalize('NFKC').trim()
  if (value.length === 0 || value.length > SELF_FACT_VALUE_MAX) return null
  const statement = `${PREDICATE_LABELS[slot.predicate]}：${value}`
  return statement.length > SELF_FACT_STATEMENT_MAX ? null : statement
}
