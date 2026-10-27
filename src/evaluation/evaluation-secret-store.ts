import type { SecretStore } from '../security/secrets'

/**
 * In-memory secret store used by headless evaluation entry points.
 *
 * Deliberately not MemorySecretStore: that module imports Electron's
 * safeStorage at module scope, which would drag the Electron runtime into a
 * Node-only evaluation process. The type-only import keeps the contract.
 */
export class EvaluationSecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  isAvailable(): boolean { return true }
  set(id: string, value: string): void { this.values.set(id, value) }
  get(id: string): string | undefined { return this.values.get(id) }
  delete(id: string): void { this.values.delete(id) }
}
