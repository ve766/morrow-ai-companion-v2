/**
 * Pure policy used by tests and by the self-hosted workflow documentation.
 * The workflow mirrors this list in its job-level `if`; tests assert both stay
 * in sync. No repository code runs in the guard job itself.
 */
export const TRUSTED_REPOSITORY = 've766/morrow-ai-companion-v2'
export const TRUSTED_ACTORS = ['ve766']
export const TRUSTED_BRANCHES = [
  'refs/heads/feat/morrow-v2-final-closure',
  'refs/heads/feat/morrow-v2-product-complete-20261106',
  'refs/heads/feat/morrow-v2-product-closure-20261107'
]
export const TRUSTED_TAG_PREFIX = 'refs/tags/ci-self-hosted-'

export function isTrustedBranch(ref: string): boolean {
  return TRUSTED_BRANCHES.includes(ref)
}

export function isTrustedTag(ref: string, refName: string, sha: string): boolean {
  return ref.startsWith(TRUSTED_TAG_PREFIX) && refName === `ci-self-hosted-${sha}`
}

export interface GuardInput { repository: string; actor: string; triggeringActor: string; eventName: string; ref: string; refName: string; sha: string }

export function evaluateGuard(input: GuardInput): { allowed: boolean; reason: string } {
  const repositoryOk = input.repository === TRUSTED_REPOSITORY
  const actorOk = TRUSTED_ACTORS.includes(input.actor) && input.triggeringActor === input.actor
  const dispatchBranchOk = input.eventName === 'workflow_dispatch' && isTrustedBranch(input.ref)
  const tagOk = input.eventName === 'push' && isTrustedTag(input.ref, input.refName, input.sha)
  return {
    allowed: repositoryOk && actorOk && (dispatchBranchOk || tagOk),
    reason: !repositoryOk ? 'repository' : !actorOk ? 'actor' : dispatchBranchOk ? 'branch' : tagOk ? 'tag' : 'ref-or-event'
  }
}
