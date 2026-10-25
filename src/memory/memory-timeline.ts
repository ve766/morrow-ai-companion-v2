import type { MemoryChangeType, MemoryRevisionRecord, MemoryStatus } from './memory-domain'

export interface MemoryTimelineEntry {
  key: string
  memoryId: string
  revision: number
  changeType: MemoryChangeType
  status: MemoryStatus
  content: string
  sourceCategory: MemoryRevisionRecord['sourceCategory']
  recordedAt: string
  recordedAtValid: boolean
}

function recordedAtValue(recordedAt: string): { valid: boolean; order: number } {
  const parsed = Date.parse(recordedAt)
  if (!Number.isFinite(parsed)) return { valid: false, order: Number.POSITIVE_INFINITY }
  return { valid: true, order: parsed }
}

// Builds the user-visible revision/来源 timeline for one memory from its
// immutable revision records. The input is treated as read-only and never
// mutated; entries describing the same memory revision are deduplicated by
// key (first occurrence wins); ordering is deterministic: revision ascending,
// then recorded time ascending, then content, with unparsable timestamps
// flagged instead of being silently rendered as facts.
export function buildMemoryTimeline(revisions: readonly MemoryRevisionRecord[]): MemoryTimelineEntry[] {
  const entries = new Map<string, MemoryTimelineEntry>()
  for (const record of revisions) {
    const key = `${record.memoryId}:${record.revision}`
    if (entries.has(key)) continue
    const { valid, order } = recordedAtValue(record.createdAt)
    entries.set(key, {
      key,
      memoryId: record.memoryId,
      revision: record.revision,
      changeType: record.changeType,
      status: record.status,
      content: record.content,
      sourceCategory: record.sourceCategory,
      recordedAt: record.createdAt,
      recordedAtValid: valid,
      order
    } as MemoryTimelineEntry & { order: number })
  }
  const list = [...entries.values()] as Array<MemoryTimelineEntry & { order: number }>
  list.sort((left, right) =>
    left.revision - right.revision
    || left.order - right.order
    || (left.content < right.content ? -1 : left.content > right.content ? 1 : 0))
  return list.map(({ order: _order, ...entry }) => entry)
}
