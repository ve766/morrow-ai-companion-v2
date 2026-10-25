import { COGNITIVE_ANALYZER_VERSION, type CognitiveCoreSettings } from './cognition'
import { ApplicationError } from '../shared/errors'
import { SqliteDatabase } from '../persistence/database'

interface CognitiveSettingsRow {
  enabled: number
  updated_at: string
}

export class CognitiveSettingsService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  get(): CognitiveCoreSettings {
    if (!this.database.cognitivePersistenceAvailable) {
      return { enabled: false, available: false, updatedAt: null, analyzerVersion: COGNITIVE_ANALYZER_VERSION }
    }
    const row = this.database.connection.prepare('SELECT enabled, updated_at FROM cognitive_core_settings WHERE id = 1')
      .get() as unknown as CognitiveSettingsRow | undefined
    return {
      enabled: row?.enabled === 1,
      available: true,
      updatedAt: row?.updated_at ?? null,
      analyzerVersion: COGNITIVE_ANALYZER_VERSION
    }
  }

  save(enabled: boolean): CognitiveCoreSettings {
    if (typeof enabled !== 'boolean') throw new ApplicationError('INVALID_INPUT')
    if (!this.database.cognitivePersistenceAvailable) throw new ApplicationError('STORAGE_ERROR')
    const value = this.clock()
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed) || !value.endsWith('Z')) throw new ApplicationError('STORAGE_ERROR')
    const updatedAt = new Date(parsed).toISOString()
    this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO cognitive_core_settings(id, enabled, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
      `).run(enabled ? 1 : 0, updatedAt)
    })
    return this.get()
  }
}
