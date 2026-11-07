import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { applyMigrations } from '../persistence/migrations'
import { ConsentGrantService, SqliteConsentGrantRepository } from './consent-grants'

const scope = { action: 'chat' as const, providerId: 'spark', endpoint: 'https://maas.example.com/v2/chat/completions', model: 'spark-x2.6', maximumSensitivity: 'personal' as const }

function setup() {
  const database = SqliteDatabase.open(':memory:')
  applyMigrations(database.connection)
  let now = '2026-11-08T10:00:00.000Z'
  return { database, service: new ConsentGrantService(new SqliteConsentGrantRepository(database), () => now), advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString() } }
}

describe('chat consent grants', () => {
  it('reuses a normal/personal grant for the exact provider scope', () => {
    const { database, service } = setup()
    try {
      expect(service.find(scope)).toBeNull()
      service.grant(scope)
      expect(service.find(scope)).not.toBeNull()
      expect(service.find({ ...scope, model: 'other' })).toBeNull()
      expect(service.find({ ...scope, endpoint: 'https://other.example.com' })).toBeNull()
      expect(service.find({ ...scope, maximumSensitivity: 'sensitive' })).toBeNull()
    } finally { database.close() }
  })

  it('never gives a 30-day grant to sensitive scope', () => {
    const { database, service } = setup()
    try {
      expect(service.grant({ ...scope, maximumSensitivity: 'sensitive' })).toBeNull()
      expect(service.find({ ...scope, maximumSensitivity: 'sensitive' })).toBeNull()
    } finally { database.close() }
  })

  it('honours expiry and revocation', () => {
    const { database, service, advance } = setup()
    try {
      const grant = service.grant(scope)!
      expect(service.revoke(grant.scopeFingerprint)).toBe(true)
      expect(service.find(scope)).toBeNull()
      service.grant(scope)
      advance(31 * 24 * 60 * 60 * 1000)
      expect(service.find(scope)).toBeNull()
    } finally { database.close() }
  })

  it('keeps the fingerprint free of keys and message payloads', () => {
    const { database, service } = setup()
    try {
      const grant = service.grant(scope)!
      expect(grant.scopeFingerprint).toHaveLength(64)
      expect(grant.scopeFingerprint).not.toContain('spark-x2.6')
    } finally { database.close() }
  })
})
