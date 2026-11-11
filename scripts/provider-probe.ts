/**
 * Provider probe (Phase 2.3).
 *
 * Answers three questions without inventing anything:
 *   1. does the endpoint route the OpenAI-compatible surface at all
 *   2. does the credential authenticate
 *   3. which model ids exist on the account, and are they authorized to answer
 *
 * It drives the real adapter through CompanionService, so the result reflects
 * the same code path the app uses. The key is read from the environment and is
 * never written to the report, the console or the error.
 *
 *   MORROW_SPARK_API_KEY=... MORROW_SPARK_MODELS=xdeepseekv3,x1 \
 *     node /tmp/provider-probe.cjs
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionService } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { SPARK_MAAS_BASE_URL, SPARK_PROVIDER_ID } from '../src/shared/companion'
import { captureProvenance } from '../src/evaluation/code-provenance'

const apiKey = process.env.MORROW_SPARK_API_KEY ?? ''
const models = (process.env.MORROW_SPARK_MODELS ?? 'xdeepseekv3').split(',').map((value) => value.trim()).filter(Boolean)
const endpointLabel = SPARK_MAAS_BASE_URL.replace(/^https:\/\//u, 'https://')

if (!apiKey) {
  console.error('MORROW_SPARK_API_KEY is not set; nothing was sent.')
  process.exit(2)
}

interface ProbeRow {
  model: string
  configured: boolean
  connection: 'ok' | 'error'
  errorCode: string | null
  reportedModel: string | null
  latencyMs: number
}

function sanitize(message: string): string {
  return message.split(apiKey).join('[redacted]')
}

async function main(): Promise<void> {
  const provenance = captureProvenance()
  const directory = mkdtempSync(join(tmpdir(), 'morrow-probe-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const rows: ProbeRow[] = []
  try {
    const companion = new CompanionService({
      database,
      memories: new MemoryService(new SqliteMemoryRepository(database)),
      conversations: new ConversationService(new SqliteConversationRepository(database)),
      secrets: new MemorySecretStore(),
      authorize: async (preview) => {
        const approvedAt = new Date()
        return {
          providerId: preview.providerId,
          payloadSha256: preview.payloadSha256,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
          includeSensitive: preview.maximumSensitivity === 'sensitive'
        }
      }
    })
    companion.saveCognitiveSettings({ enabled: true })

    for (const model of models) {
      const startedAt = Date.now()
      try {
        companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model, enabled: true, apiKey })
      } catch (error) {
        rows.push({ model, configured: false, connection: 'error', errorCode: (error as { code?: string }).code ?? 'UNKNOWN', reportedModel: null, latencyMs: Date.now() - startedAt })
        continue
      }
      try {
        const result = await companion.testProviderConnection({ providerId: SPARK_PROVIDER_ID })
        rows.push({ model, configured: true, connection: result.connected ? 'ok' : 'error', errorCode: result.connected ? null : 'EMPTY_REPLY', reportedModel: result.model, latencyMs: Date.now() - startedAt })
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'UNKNOWN'
        rows.push({ model, configured: true, connection: 'error', errorCode: code, reportedModel: null, latencyMs: Date.now() - startedAt })
        console.log(`${model}: ${code} (${sanitize(String((error as Error).message))})`)
      }
    }

    const report = {
      schemaVersion: 1,
      runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
      generatedAt: new Date().toISOString(),
      provider: { id: SPARK_PROVIDER_ID, endpoint: endpointLabel, protocol: 'OpenAI Chat Completions' },
      credential: { provided: true, source: 'environment', length: apiKey.length, storedInRepo: false },
      provenance,
      probes: rows,
      summary: {
        attempted: rows.length,
        connected: rows.filter((row) => row.connection === 'ok').length,
        errorCodes: rows.reduce<Record<string, number>>((accumulator, row) => {
          const key = row.errorCode ?? 'ok'
          accumulator[key] = (accumulator[key] ?? 0) + 1
          return accumulator
        }, {})
      }
    }
    const outputPath = join(process.cwd(), 'evaluation', 'reports', `phase23-provider-probe.${report.runId}.json`)
    mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify({ runId: report.runId, summary: report.summary, report: outputPath }))
    if (report.summary.connected === 0) process.exitCode = 1
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

void main()
