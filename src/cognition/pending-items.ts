/**
 * Minimal internal activity, Phase 2.4 (§6).
 *
 * A "pending item" is a durable note that something is still open: two stored
 * memories disagree, the answer gate had to remove a claim because nothing
 * supported it, or a reflection run noticed a gap. Items are *internal*: by
 * default they can only be read and completed. They never send messages, never
 * touch permissions, and never call a provider on their own.
 *
 * Two properties matter more than features here:
 *
 *   * dedupe — the same concern observed on ten turns is one item, not ten;
 *   * no resurrection — completing an item is durable, so a resolved conflict
 *     does not reappear on the next turn.
 */
import { createHash } from 'node:crypto'

export const PENDING_ITEM_SOURCES = ['conflict', 'evidence_gap', 'open_question', 'reflection', 'interest'] as const
export type PendingItemSource = typeof PENDING_ITEM_SOURCES[number]
export type PendingItemStatus = 'open' | 'done' | 'dropped'

export const MAX_PENDING_ITEMS_PER_TURN = 5

export interface PendingItem {
  id: string
  dedupeKey: string
  source: PendingItemSource
  kind: string
  /** A short, system-authored line. Never memory text and never reply text. */
  summary: string
  priority: number
  status: PendingItemStatus
  conversationId: string | null
  detail: Record<string, unknown>
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface PendingItemDraft {
  id: string
  dedupeKey: string
  source: PendingItemSource
  kind: string
  summary: string
  priority: number
  conversationId: string | null
  detail: Record<string, unknown>
  createdAt: string
}

export interface PendingItemPort {
  upsert(draft: PendingItemDraft): PendingItem
  get(id: string): PendingItem | null
  list(options?: { status?: PendingItemStatus; limit?: number }): PendingItem[]
  complete(id: string, completedAt: string): boolean
  /** Durable user rejection: keeps the item out of the open list forever. */
  drop(id: string, completedAt: string): boolean
  findByDedupeKey(dedupeKey: string): PendingItem | null
}

export interface PendingDerivationInput {
  turnId: string
  conversationId: string
  at: string
  status: 'succeeded' | 'failed' | 'cancelled'
  /** Undisclosed conflict groups from this turn: predicate and ids only. */
  conflicts: ReadonlyArray<{ predicate: string; memoryIds: readonly string[] }>
  /** Claim kinds the delivery gate had to remove, e.g. `vehicle_plate`. */
  blockedClaimKinds: readonly string[]
}

/**
 * Derives the items a single turn justifies. Failed and cancelled turns
 * produce nothing: they observed no evidence about the user's stored facts.
 */
export function derivePendingItems(input: PendingDerivationInput, makeId: () => string): PendingItemDraft[] {
  if (input.status !== 'succeeded') return []
  const drafts: PendingItemDraft[] = []
  const seen = new Set<string>()

  for (const conflict of input.conflicts.slice(0, MAX_PENDING_ITEMS_PER_TURN)) {
    const ids = [...new Set(conflict.memoryIds)].sort()
    if (ids.length < 2) continue
    // The key is the concern itself, not the turn: the same two records
    // disagreeing again is the same open question.
    const dedupeKey = `conflict:${conflict.predicate}:${ids.join(',')}`.slice(0, 300)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    drafts.push({
      id: normalizeId(makeId()),
      dedupeKey,
      source: 'conflict',
      kind: `conflict_${conflict.predicate}`.slice(0, 64),
      summary: `已保存的记录在「${conflict.predicate}」上互相矛盾，尚未确认哪一条是当前状态。`,
      priority: 70,
      conversationId: input.conversationId,
      detail: { predicate: conflict.predicate, memoryIds: ids, firstSeenTurnId: input.turnId },
      createdAt: input.at
    })
  }

  for (const kind of [...new Set(input.blockedClaimKinds)].slice(0, MAX_PENDING_ITEMS_PER_TURN)) {
    const dedupeKey = `evidence_gap:${kind}`.slice(0, 300)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    drafts.push({
      id: normalizeId(makeId()),
      dedupeKey,
      source: 'evidence_gap',
      kind: `missing_${kind}`.slice(0, 64),
      summary: `有一类个人信息（${kind}）没有可依据的记录，交付前已被拦截；需要用户提供或确认。`,
      priority: 60,
      conversationId: input.conversationId,
      detail: { claimKind: kind, firstSeenTurnId: input.turnId },
      createdAt: input.at
    })
  }

  return drafts.slice(0, MAX_PENDING_ITEMS_PER_TURN)
}

/**
 * Fixed, content-free summaries for reflection-sourced items.
 *
 * A reflection finding can quote what the user said (a self-model entry, a
 * memory-derived topic). An internal item is read by the shell and may reach a
 * log, so it must not carry that text. The item therefore records *what kind of
 * concern* was found, never the wording that produced it; the digest links back
 * to the finding for anyone who has the right to read it.
 */
const REFLECTION_SUMMARIES: Readonly<Record<string, string>> = Object.freeze({
  memory_gap: '反思发现记忆记录存在缺口，需要与用户核对后再引用相关内容。',
  bias_hint: '反思发现近期交互被多次纠正，回答应更谨慎地承认不确定性。',
  consistency_note: '反思发现存在尚未确认的自我判断，等待用户澄清。',
  interest_candidate: '反思发现一个候选兴趣话题，等待更多独立证据后再确认。',
  open_question: '反思留下一个未解决的问题，等待后续对话澄清。'
})

const REFLECTION_DEFAULT_SUMMARY = '反思产生了一条待核实的内部事项。'

export function reflectionSummaryFor(kind: string): string {
  return REFLECTION_SUMMARIES[kind] ?? REFLECTION_DEFAULT_SUMMARY
}

/**
 * Builds a pending item from a reflection finding.
 *
 * Note the signature: there is no `statement` parameter. The caller hashes the
 * finding text and passes only the digest, so leaking the text here is not a
 * matter of remembering to strip it — the function cannot receive it.
 *
 * The digest is a dedupe key and a traceability handle. It is **not**
 * anonymisation and not encryption: a short, guessable statement can be
 * confirmed by hashing candidates.
 */
export function pendingItemFromReflection(input: {
  runId: string
  kind: string
  statementDigest: string
  confidence: number
  at: string
  makeId: () => string
}): PendingItemDraft {
  if (!/^[0-9a-f]{16}$/u.test(input.statementDigest)) throw new TypeError('Reflection items require a statement digest.')
  const priority = Math.min(95, Math.max(20, 100 - Math.round(input.confidence)))
  return {
    id: normalizeId(input.makeId()),
    dedupeKey: `reflection:${input.kind}:${input.statementDigest}`.slice(0, 300),
    source: 'reflection',
    kind: input.kind.slice(0, 64),
    summary: reflectionSummaryFor(input.kind),
    priority,
    conversationId: null,
    // No statement, no quoted text, no label: identifiers and a digest only.
    detail: {
      runId: input.runId,
      statementDigest: input.statementDigest,
      summaryPolicy: 'category_template_v1'
    },
    createdAt: input.at
  }
}

export interface BoundedRunResult<T> {
  status: 'completed' | 'cancelled' | 'failed' | 'skipped'
  value?: T
  reason?: string
}

/**
 * Runs one background step under an explicit budget and cancellation signal.
 *
 * The budget is checked before starting and the signal is honoured while
 * waiting. A failure is returned, never thrown into the caller: internal
 * activity must not be able to break a completed conversation.
 */
export async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T> | T,
  options: { signal?: AbortSignal | undefined; budgetMs?: number; startedAtMs?: number } = {}
): Promise<BoundedRunResult<T>> {
  const budgetMs = Math.max(1, options.budgetMs ?? 2_000)
  const startedAtMs = options.startedAtMs ?? Date.now()
  if (options.signal?.aborted) return { status: 'cancelled', reason: 'aborted_before_start' }
  const remaining = budgetMs - (Date.now() - startedAtMs)
  if (remaining <= 0) return { status: 'skipped', reason: 'budget_exhausted' }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), remaining)
  try {
    const value = await operation(controller.signal)
    return controller.signal.aborted ? { status: 'cancelled', reason: 'budget_or_abort' } : { status: 'completed', value }
  } catch {
    return controller.signal.aborted ? { status: 'cancelled', reason: 'budget_or_abort' } : { status: 'failed', reason: 'operation_failed' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export class PendingCognitionService {
  constructor(
    private readonly repository: PendingItemPort,
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Persists the items a turn justifies and returns their ids. Writing is
   * idempotent per dedupe key, so calling it twice for one turn is harmless.
   */
  observeTurn(input: PendingDerivationInput): string[] {
    return this.persistDrafts(derivePendingItems(input, this.makeId))
  }

  /**
   * Derives without writing, so the drafts can be stored in the turn's
   * finalization intent and applied later from persisted evidence.
   */
  deriveTurn(input: PendingDerivationInput): PendingItemDraft[] {
    return derivePendingItems(input, this.makeId)
  }

  /** Applies pre-derived drafts; idempotent by dedupe key. */
  persistDrafts(drafts: readonly PendingItemDraft[]): string[] {
    const ids: string[] = []
    for (const draft of drafts) ids.push(this.repository.upsert(draft).id)
    return ids
  }

  /**
   * Converts reflection findings into open items.
   *
   * The finding text is hashed here and then dropped: what reaches the store is
   * a category template, the run id and a digest. The text itself stays in the
   * reflection record, which only the owner reads.
   */
  absorbReflection(input: { runId: string; findings: ReadonlyArray<{ kind: string; statement: string; confidence: number }> }): string[] {
    const at = this.clock()
    const ids: string[] = []
    for (const finding of input.findings.slice(0, MAX_PENDING_ITEMS_PER_TURN)) {
      const stored = this.repository.upsert(pendingItemFromReflection({
        runId: input.runId,
        kind: finding.kind,
        statementDigest: createHash('sha256').update(finding.statement).digest('hex').slice(0, 16),
        confidence: finding.confidence,
        at,
        makeId: this.makeId
      }))
      ids.push(stored.id)
    }
    return ids
  }

  listOpen(limit = 50): PendingItem[] {
    return this.repository.list({ status: 'open', limit })
  }

  list(limit = 100): PendingItem[] {
    return this.repository.list({ limit })
  }

  get(id: string): PendingItem | null {
    return this.repository.get(id)
  }

  /** Returns false only when the item does not exist at all. */
  complete(id: string): boolean {
    return this.repository.complete(id, this.clock())
  }

  /**
   * Durable user decision on one open item (D-11): accept consumes it,
   * reject/dismiss drops it. The status column is never reset by the upsert,
   * so a rejected concern cannot resurface — neither as a pending item nor
   * (for reflection kinds) as a prompt hint.
   */
  decide(id: string, decision: 'accepted' | 'rejected' | 'dismissed'): boolean {
    if (decision === 'accepted') return this.complete(id)
    return this.repository.drop(id, this.clock())
  }
}

function normalizeId(value: string): string {
  return value.toLowerCase()
}
