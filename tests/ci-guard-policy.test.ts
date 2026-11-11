import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateGuard, isTrustedTag, TRUSTED_BRANCHES } from '../scripts/ci/guard-policy'

const base = {
  repository: 've766/morrow-ai-companion-v2',
  actor: 've766',
  triggeringActor: 've766',
  eventName: 'workflow_dispatch',
  ref: 'refs/heads/feat/morrow-v2-product-closure-20261107',
  refName: 'feat/morrow-v2-product-closure-20261107',
  sha: '0123456789abcdef0123456789abcdef01234567'
}

describe('self-hosted CI guard policy', () => {
  it('allows every explicitly registered product branch for manual dispatch', () => {
    for (const ref of TRUSTED_BRANCHES) {
      expect(evaluateGuard({ ...base, ref, refName: ref.replace('refs/heads/', '') })).toMatchObject({ allowed: true, reason: 'branch' })
    }
  })

  it('rejects an unregistered branch, a fork repository, or a different actor', () => {
    expect(evaluateGuard({ ...base, ref: 'refs/heads/feature/random' }).allowed).toBe(false)
    expect(evaluateGuard({ ...base, repository: 'someone/fork' }).allowed).toBe(false)
    expect(evaluateGuard({ ...base, actor: 'contributor' }).allowed).toBe(false)
    expect(evaluateGuard({ ...base, triggeringActor: 'contributor' }).allowed).toBe(false)
  })

  it('allows only a tag whose name equals ci-self-hosted-<sha>', () => {
    const tagBase = { ...base, eventName: 'push', ref: `refs/tags/ci-self-hosted-${base.sha}`, refName: `ci-self-hosted-${base.sha}` }
    expect(evaluateGuard(tagBase).allowed).toBe(true)
    expect(isTrustedTag(tagBase.ref, tagBase.refName, tagBase.sha)).toBe(true)
    expect(isTrustedTag('refs/tags/ci-self-hosted-deadbeef', 'ci-self-hosted-deadbeef', base.sha)).toBe(false)
    expect(isTrustedTag(tagBase.ref, tagBase.refName, 'ffffffffffffffffffffffffffffffffffffffff')).toBe(false)
  })

  it('keeps the workflow allowlist and final failure gate in sync', () => {
    const workflow = readFileSync('.github/workflows/self-hosted-ci.yml', 'utf8')
    for (const ref of TRUSTED_BRANCHES) expect(workflow).toContain(ref.replace('refs/heads/', 'refs/heads/'))
    expect(workflow).toContain('guard-outcome')
    expect(workflow).toContain("if ($guard -ne 'success' -or $verify -ne 'success')")
    expect(workflow).toContain('continue-on-error: false')
  })
})
