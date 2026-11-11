import { isAbsolute, resolve } from 'node:path'

/**
 * Resolves the explicit local-acceptance data root. The acceptance deployment
 * must never fall back to the normal user profile, so only an absolute path is
 * accepted and any relative or empty-but-set value fails closed.
 */
export function resolveAcceptanceUserData(value: string | undefined): string | null {
  if (value === undefined) return null
  const candidate = value.trim()
  if (candidate.length === 0) return null
  if (!isAbsolute(candidate)) {
    throw new Error('MORROW_LOCAL_ACCEPTANCE_USER_DATA must be an absolute path.')
  }
  return resolve(candidate)
}
