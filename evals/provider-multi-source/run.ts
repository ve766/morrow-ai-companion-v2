/**
 * Multi-source provider real-run evidence.
 *
 * Credentials come from MORROW_TEST_API_KEY only. The script writes sanitized
 * machine results and a transcript; it never writes the key, the Authorization
 * header or the model's response text.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SqliteDatabase } from '../../src/persistence/database'
import { MemorySecretStore } from '../../src/security/secrets'
import { ProviderConfigService } from '../../src/app/companion-service'
import { resolveChatEndpoint } from '../../src/providers/endpoint-resolver'
import { endpointDigest, maskEndpoint } from '../../src/providers/endpoint-security'
import { readGitMetadata } from '../../src/evaluation/git-metadata'
import { createIpcHandlers } from '../../src/app/ipc'
import { IPC_CHANNELS } from '../../src/shared/contracts'
import type { ProviderInput } from '../../src/providers/provider-policy'
import type { ProviderConfigRecord } from '../../src/shared/companion'

const base = process.env.MORROW_SECOND_PROVIDER_URL?.trim() || 'https://api.supxh.xin'
const model = process.env.MORROW_TEST_MODEL?.trim() || 'gemini-3-flash'
const key = process.env.MORROW_TEST_API_KEY?.trim() || ''
const localUrl = process.env.MORROW_LOCAL_PROVIDER_URL?.trim() || ''
const localModel = process.env.MORROW_LOCAL_PROVIDER_MODEL?.trim() || 'local-model'
const git = readGitMetadata()
const startedAt = new Date().toISOString()
const runId = `${startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')}-${randomUUID().slice(0, 8)}`
const root = resolve(process.cwd())
const resultsDir = join(root, 'evals', 'provider-multi-source', 'results')
const transcriptsDir = join(root, 'evals', 'provider-multi-source', 'transcripts')

interface RunResult {
  runId: string
  suite: 'provider-multi-source'
  startedAt: string
  finishedAt: string
  codeCommit: string
  branch: string | null
  branchReason: string
  workingTree: string
  endpoint: string
  endpointDigest: string
  model: string
  status: 'REAL_PROVIDER_PASS' | 'REAL_PROVIDER_FAIL' | 'BLOCKED_NO_SECRET'
  checks: Array<{ name: string; ok: boolean; detail: string }>
  nonStream?: { ok: boolean; latencyMs: number; attempts: number; replyLength: number; modelId: string }
  stream?: { ok: boolean; latencyMs: number; attempts: number; deltaCount: number; replyLength: number; textMatchesDeltas: boolean }
  local: { status: 'PASS' | 'BLOCKED_LOCAL_SERVICE_NOT_RUNNING' | 'FAIL'; detail: string }
  ipc?: { save: boolean; list: boolean; test: boolean }
  error?: string
}

function write(result: RunResult): void {
  mkdirSync(resultsDir, { recursive: true })
  mkdirSync(transcriptsDir, { recursive: true })
  writeFileSync(join(resultsDir, `${runId}.json`), `${JSON.stringify(result, null, 2)}\n`)
  const lines = [
    `# Provider multi-source real run ${runId}`,
    '',
    `- Status: **${result.status}**`,
    `- Endpoint: \`${result.endpoint}\` (digest ${result.endpointDigest})`,
    `- Model: \`${result.model}\``,
    `- Code: \`${result.codeCommit}\` · branch ${result.branch ?? 'detached'} · tree ${result.workingTree}`,
    `- Time: ${result.startedAt} → ${result.finishedAt}`,
    '',
    '## Checks',
    '',
    ...result.checks.map((check) => `- ${check.ok ? 'PASS' : 'FAIL'} — ${check.name}: ${check.detail}`),
    '',
    '## Local service',
    '',
    `- ${result.local.status}: ${result.local.detail}`,
    '',
    'No key, Authorization header or response text is recorded.'
  ]
  writeFileSync(join(transcriptsDir, `${runId}.md`), `${lines.join('\n')}\n`)
}

async function run(): Promise<void> {
  const result: RunResult = {
    runId,
    suite: 'provider-multi-source',
    startedAt,
    finishedAt: '',
    codeCommit: git.commit,
    branch: git.branch,
    branchReason: git.branchReason,
    workingTree: git.workingTree,
    endpoint: maskEndpoint(base),
    endpointDigest: endpointDigest(base),
    model,
    status: 'BLOCKED_NO_SECRET',
    checks: [],
    local: { status: 'BLOCKED_LOCAL_SERVICE_NOT_RUNNING', detail: 'MORROW_LOCAL_PROVIDER_URL is not set; no local OpenAI-compatible service was started.' }
  }
  if (!key) {
    result.checks.push({ name: 'secret', ok: false, detail: 'MORROW_TEST_API_KEY is not set; BLOCKED_NO_SECRET.' })
    result.finishedAt = new Date().toISOString()
    write(result)
    process.stdout.write(`${JSON.stringify({ runId, status: result.status, file: join(resultsDir, `${runId}.json`) })}\n`)
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'morrow-provider-eval-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const secrets = new MemorySecretStore()
  try {
    const service = new ProviderConfigService(database, secrets, async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      includeSensitive: false
    }))
    const profile = service.saveProfile({
      displayName: 'Second provider real test',
      sourceKind: 'custom-proxy',
      protocolId: 'openai-chat-completions',
      endpoint: base,
      model,
      enabled: true,
      isDefault: true,
      apiKey: key
    })
    result.checks.push({ name: 'profile saved', ok: true, detail: `profile ${profile.id} · key isolated` })
    const trusted = 'file:///opt/morrow/out/renderer/index.html'
    const frame = { url: trusted }
    const event = { sender: { mainFrame: frame }, senderFrame: frame }
    const handlers = createIpcHandlers(
      { getAppInfo: () => ({ name: 'Morrow', version: '0.0.0', platform: process.platform, electronVersion: 'test', dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders' }) },
      trusted,
      {
        memories: {} as never,
        goals: {} as never,
        reminders: {} as never,
        companion: {
          testProviderConnection: (request: { providerId: string }) => service.testConnection(request),
          listProfiles: () => service.listProfiles(),
          saveProfile: (request: never) => service.saveProfile(request),
          deleteProfile: (request: { profileId: string }) => service.deleteProfile(request.profileId),
          setDefaultProfile: (request: { profileId: string }) => service.setDefaultProfile(request.profileId),
          discoverModels: (request: { profileId: string }) => service.discoverModels(request)
        } as never
      }
    )
    const savedViaIpc = await handlers[IPC_CHANNELS.providerProfileSave]!(event, {
      profileId: profile.id,
      displayName: profile.displayName,
      sourceKind: 'custom-proxy',
      protocolId: 'openai-chat-completions',
      endpoint: base,
      model,
      enabled: true,
      isDefault: true,
      apiKey: key
    })
    if (!savedViaIpc.ok) throw new Error('IPC profile save failed: ' + savedViaIpc.error.code)
    const listViaIpc = await handlers[IPC_CHANNELS.providerProfilesList]!(event, {})
    const testViaIpc = await handlers[IPC_CHANNELS.providerTestConnection]!(event, { providerId: profile.id })
    result.ipc = { save: savedViaIpc.ok, list: listViaIpc.ok, test: testViaIpc.ok }
    if (!testViaIpc.ok) result.checks.push({ name: 'IPC test error', ok: false, detail: testViaIpc.error.code + ': ' + testViaIpc.error.message })
    result.checks.push({ name: 'IPC path (trusted sender, schema, service)', ok: savedViaIpc.ok && listViaIpc.ok && testViaIpc.ok, detail: JSON.stringify(result.ipc) })
    const connection = await service.testConnection({ providerId: profile.id })
    result.checks.push({
      name: 'connection test (consent + adapter + SSE)',
      ok: connection.connected,
      detail: `status=${connection.status ?? 'unknown'} latency=${connection.latencyMs ?? 0}ms attempts=${connection.attempts ?? 0}`
    })

    const config: ProviderConfigRecord = service.get(profile.id)!
    const adapter = service.createAdapter(config)
    const input: ProviderInput = {
      prompt: 'Reply with exactly OK.',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: resolveChatEndpoint(config.endpoint, config.endpointPath),
      maximumSensitivity: 'normal',
      requestPayload: {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        stream: false,
        max_tokens: 64
      }
    }
    const nonStreamStart = Date.now()
    const nonStream = await adapter.generate(input)
    result.nonStream = {
      ok: nonStream.text.trim().length > 0,
      latencyMs: Date.now() - nonStreamStart,
      attempts: nonStream.attempts ?? 1,
      replyLength: nonStream.text.length,
      modelId: nonStream.modelId
    }
    result.checks.push({ name: 'non-stream adapter', ok: result.nonStream.ok, detail: `replyLength=${result.nonStream.replyLength} model=${nonStream.modelId}` })

    const deltas: string[] = []
    const streamStart = Date.now()
    const streamed = await adapter.generate({
      ...input,
      requestPayload: { ...input.requestPayload as Record<string, unknown>, stream: true }
    }, (delta) => deltas.push(delta))
    result.stream = {
      ok: streamed.text.trim().length > 0 && deltas.length > 0,
      latencyMs: Date.now() - streamStart,
      attempts: streamed.attempts ?? 1,
      deltaCount: deltas.length,
      replyLength: streamed.text.length,
      textMatchesDeltas: deltas.join('') === streamed.text
    }
    result.checks.push({
      name: 'stream adapter',
      ok: result.stream.ok && result.stream.textMatchesDeltas,
      detail: `deltas=${result.stream.deltaCount} textMatchesDeltas=${result.stream.textMatchesDeltas}`
    })

    if (localUrl) {
      try {
        const localProfile = service.saveProfile({
          displayName: 'Local provider real test',
          sourceKind: 'local',
          protocolId: 'openai-chat-completions',
          endpoint: localUrl,
          model: localModel,
          enabled: true,
          apiKey: ''
        })
        const localConnection = await service.testConnection({ providerId: localProfile.id })
        result.local = { status: localConnection.connected ? 'PASS' : 'FAIL', detail: `latency=${localConnection.latencyMs ?? 0}ms` }
      } catch (error) {
        result.local = { status: 'FAIL', detail: error instanceof Error ? error.message : 'local test failed' }
      }
    }

    const allOk = result.checks.every((check) => check.ok) && result.local.status !== 'FAIL'
    result.status = allOk ? 'REAL_PROVIDER_PASS' : 'REAL_PROVIDER_FAIL'
  } catch (error) {
    result.status = 'REAL_PROVIDER_FAIL'
    result.error = error instanceof Error ? error.message.slice(0, 160).split(key).join('***') : 'unknown'
    result.checks.push({ name: 'real provider run', ok: false, detail: result.error })
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  result.finishedAt = new Date().toISOString()
  write(result)
  process.stdout.write(`${JSON.stringify({ runId, status: result.status, file: join(resultsDir, `${runId}.json`) })}\n`)
  if (result.status !== 'REAL_PROVIDER_PASS') process.exitCode = 1
}

void run()
