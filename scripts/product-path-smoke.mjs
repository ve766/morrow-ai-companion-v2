/**
 * Product-path acceptance for the final closure.
 *
 * Drives the real renderer (DOM form → preload bridge → IPC → SQLite →
 * OS SafeStorage) in the built Electron app, then restarts the app on the same
 * profile and verifies that provider secrets and companion state survive.
 * Fake keys only; no provider network request is made.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const electronBinary = process.platform === 'win32'
  ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : join(root, 'node_modules', 'electron', 'dist', 'electron')
const appEntry = join(root, 'out', 'main', 'index.js')
const profile = resolve(process.env.MORROW_PRODUCT_PROFILE || join(root, '.tmp', 'product-path-profile'))
const resultsDir = join(root, 'evals', 'morrow-v2-final', 'results')
const transcriptsDir = join(root, 'evals', 'morrow-v2-final', 'transcripts')
const startedAt = new Date().toISOString()
const runId = `${startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')}-${randomUUID().slice(0, 8)}`
const sandboxDisabled = process.env.MORROW_SMOKE_DISABLE_SANDBOX === '1' || process.platform === 'linux'
const FAKE_KEY_A = `FAKE_PRODUCT_PATH_KEY_A_${randomUUID()}`
const FAKE_KEY_B = `FAKE_PRODUCT_PATH_KEY_B_${randomUUID()}`
const FAKE_KEY_A2 = `FAKE_PRODUCT_PATH_KEY_A2_${randomUUID()}`

if (!existsSync(appEntry)) throw new Error('Built application not found. Run npm run build first.')
if (!existsSync(electronBinary)) throw new Error('Electron is not installed. Run npm ci first.')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })

const checks = []
function record(name, ok, detail) {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error(`${name}: ${detail}`)
}
function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}
function differingKeys(before, after) {
  return Object.keys(before).filter((key) => hash(before[key]) !== hash(after[key]))
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local test port.')
  const port = address.port
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  return port
}

function launch(port) {
  const environment = { ...process.env }
  delete environment.ELECTRON_RENDERER_URL
  delete environment.ELECTRON_RUN_AS_NODE
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`
  ]
  if (sandboxDisabled) args.push('--no-sandbox')
  args.push(root)
  const child = spawn(electronBinary, args, { cwd: root, env: environment, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192) })
  const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  return { child, exited, port, get stderr() { return stderr } }
}

async function findPage(run) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (run.child.exitCode !== null) {
      throw new Error(`Application exited during launch (${run.child.exitCode})${run.stderr.trim() ? `: ${run.stderr.trim()}` : '.'}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${run.port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page.webSocketDebuggerUrl
      }
    } catch {}
    await delay(200)
  }
  throw new Error('Renderer did not expose a DevTools page.')
}

async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.error) request.reject(new Error('DevTools command failed.'))
    else request.resolve(message.result)
  })
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error('DevTools connection timed out.')), 10000)
    socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timeout); rejectOpen(new Error('DevTools connection failed.')) }, { once: true })
  })
  return {
    evaluate(expression) {
      return new Promise((resolveResult, rejectResult) => {
        const id = ++nextId
        const timeout = setTimeout(() => { pending.delete(id); rejectResult(new Error('Renderer evaluation timed out.')) }, 20000)
        pending.set(id, { resolve: resolveResult, reject: rejectResult, timeout })
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      }).then((result) => {
        if (result.exceptionDetails) {
          throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown exception'}.`)
        }
        return result.result?.value
      })
    },
    close() { if (socket.readyState === WebSocket.OPEN) socket.close() }
  }
}

async function waitForBridge(client) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try { if (await client.evaluate('typeof window.morrow === "object"')) return } catch {}
    await delay(200)
  }
  throw new Error('The built renderer did not expose its typed preload bridge.')
}

async function stop(run, client) {
  // A graceful close lets Electron flush its OS-crypt key material; a forced
  // kill can leave the next process unable to decrypt secrets it just wrote.
  if (client) {
    try { await client.evaluate('window.close()') } catch {}
    client.close()
  }
  if (run.child.exitCode === null) {
    await Promise.race([run.exited, delay(10000)])
  }
  if (run.child.exitCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      run.child.kill()
    }
    await Promise.race([run.exited, delay(5000)])
  }
}

async function start() {
  const run = launch(await freePort())
  let client
  try {
    client = await connect(await findPage(run))
    await waitForBridge(client)
    return { run, client }
  } catch (error) {
    await stop(run, client)
    throw error
  }
}

function findDatabase(directory, depth = 0) {
  if (depth > 8) return undefined
  let entries
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return undefined }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'morrow.sqlite3') return join(directory, entry.name)
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !['node_modules', 'install'].includes(entry.name)) {
      const found = findDatabase(join(directory, entry.name), depth + 1)
      if (found) return found
    }
  }
  return undefined
}

function snapshotDatabase() {
  const path = findDatabase(profile)
  if (!path) throw new Error('Morrow database was not found in the isolated profile.')
  const database = new DatabaseSync(path)
  try {
    const tables = [
      'personality_profiles', 'self_model_entries', 'interests', 'memories', 'goals',
      'relationship_threads', 'conversations', 'messages', 'cognitive_pending_items',
      'reflection_findings', 'reflection_finding_routes'
    ]
    const snapshot = {}
    for (const table of tables) {
      const rows = database.prepare(`SELECT * FROM ${table}`).all()
      snapshot[table] = { count: rows.length }
    }
    return { path, snapshot }
  } finally {
    database.close()
  }
}

function secretPath(profileId) {
  const path = findDatabase(profile)
  if (!path) throw new Error('Morrow database was not found in the isolated profile.')
  return join(dirname(path), 'secrets', `${profileId}.bin`)
}

function secretDigest(profileId) {
  const path = secretPath(profileId)
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
}

function snapshotSecrets(profileIds) {
  return Object.fromEntries(profileIds.map((id) => [id, secretDigest(id)]))
}

const seedScript = `(async () => {
  const personality = await window.morrow.personality.save({
    warmth: 61, directness: 57, humor: 33, disagreementStyle: 'balanced',
    systemRules: 'PRODUCT_PATH_PERSONALITY_MARKER'
  })
  const memory = await window.morrow.memories.create({ content: 'PRODUCT_PATH_MEMORY_MARKER', sensitivity: 'personal' })
  const goal = await window.morrow.goals.create({
    intent: '核对本机当前有效记忆数量',
    successCriterion: 'active_memory_count_matches_database',
    constraints: '只读取当前有效记忆数量，不修改或删除数据，不访问网络。',
    acceptedBoundary: true
  })
  const conversation = await window.morrow.conversations.create()
  if (!personality.ok || !memory.ok || !goal.ok || !conversation.ok) {
    throw new Error('Continuity seed failed: ' + JSON.stringify({ personality, memory, goal, conversation }).slice(0, 400))
  }
  return {
    personalityVersion: personality.data.version,
    memoryId: memory.data.id,
    goalId: goal.data.id,
    conversationId: conversation.data.id
  }
})()`

const continuityScript = `(async () => {
  const [personality, entries, interests, memories, goals, conversations] = await Promise.all([
    window.morrow.personality.get(),
    window.morrow.selfModel.listEntries({}),
    window.morrow.selfModel.listInterests(),
    window.morrow.memories.list(),
    window.morrow.goals.list(),
    window.morrow.conversations.list()
  ])
  const all = [personality, entries, interests, memories, goals, conversations]
  if (all.some((result) => !result.ok)) throw new Error('Continuity read failed: ' + JSON.stringify(all).slice(0, 400))
  return {
    personality: { version: personality.data.version, systemRules: personality.data.systemRules },
    selfModel: entries.data.map((entry) => ({ id: entry.id, kind: entry.kind, statement: entry.statement })),
    interests: interests.data.map((entry) => ({ id: entry.id, label: entry.label })),
    memories: memories.data.map((entry) => ({ id: entry.id, currentText: entry.currentText })),
    goals: goals.data.map((entry) => ({ id: entry.goal.id, intent: entry.goal.intent })),
    conversations: conversations.data.map((entry) => ({ id: entry.id, title: entry.title }))
  }
})()`

async function saveProfileThroughForm(client, values) {
  return client.evaluate(`(async () => {
    const set = (selector, value) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
        throw new Error('Missing form control: ' + selector)
      }
      element.value = value
    }
    set('#provider-profile-id', ${JSON.stringify(values.profileId ?? '')})
    set('#provider-profile-name', ${JSON.stringify(values.displayName)})
    set('#provider-profile-source', ${JSON.stringify(values.sourceKind ?? 'custom-proxy')})
    set('#provider-profile-protocol', 'openai-chat-completions')
    set('#provider-profile-endpoint', ${JSON.stringify(values.endpoint)})
    set('#provider-profile-endpoint-path', '')
    set('#provider-profile-model', ${JSON.stringify(values.model)})
    set('#provider-profile-api-key', ${JSON.stringify(values.apiKey ?? '')})
    const enabled = document.querySelector('#provider-profile-enabled')
    const isDefault = document.querySelector('#provider-profile-default')
    if (!(enabled instanceof HTMLInputElement) || !(isDefault instanceof HTMLInputElement)) throw new Error('Missing provider toggles.')
    enabled.checked = ${values.enabled === false ? 'false' : 'true'}
    isDefault.checked = false
    const feedback = document.querySelector('#provider-profile-feedback')
    const form = document.querySelector('#provider-profile-form')
    if (!(form instanceof HTMLFormElement) || !(feedback instanceof HTMLElement)) throw new Error('Provider form is unavailable.')
    const before = feedback.textContent
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const text = feedback.textContent ?? ''
      if (text !== before && (text.includes('已保存') || text.includes('失败') || text.includes('无法'))) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const list = await window.morrow.providers.listProfiles()
    if (!list.ok) throw new Error('Profile list failed after save.')
    const saved = list.data.find((profile) => profile.displayName === ${JSON.stringify(values.displayName)})
    return {
      feedback: feedback.textContent ?? '',
      saved: saved ? {
        id: saved.id, displayName: saved.displayName, endpoint: saved.endpoint,
        enabled: saved.enabled, apiKeyConfigured: saved.apiKeyConfigured,
        lastTest: saved.lastTest?.status ?? null, capabilities: saved.capabilities
      } : null,
      count: list.data.length
    }
  })()`)
}

const result = {
  runId,
  suite: 'morrow-v2-final-product-path',
  startedAt,
  finishedAt: '',
  status: 'FAILED',
  platform: process.platform,
  electronVersion: '',
  sandboxDisabled,
  profile: 'isolated-temporary-profile',
  checks,
  continuity: {},
  secrets: {},
  limitation: 'Native provider-consent dialogs are not automatable through CDP; consent denial and fetch-count-zero are proven by the service integration suite at the same SHA. Connection tests were not triggered here to avoid an unattended native dialog.'
}

let activeRun
let activeClient
try {
  let started = await start()
  activeRun = started.run
  activeClient = started.client
  result.electronVersion = await activeClient.evaluate(`(async () => {
    const info = await window.morrow.getAppInfo()
    if (!info.ok) throw new Error('App info failed.')
    return info.data.electronVersion
  })()`)
  const seed = await activeClient.evaluate(seedScript)
  record('seed continuity stores', true, `personality v${seed.personalityVersion}, memory ${seed.memoryId}, goal ${seed.goalId}, conversation ${seed.conversationId}`)

  const profileA = await saveProfileThroughForm(activeClient, {
    displayName: 'Product Path A',
    endpoint: 'https://relay-a.example.com',
    model: 'gemini-3-flash',
    apiKey: FAKE_KEY_A
  })
  record('create profile A through renderer form', profileA.saved?.apiKeyConfigured === true && profileA.saved.enabled === true, `feedback: ${profileA.feedback}`)
  const profileB = await saveProfileThroughForm(activeClient, {
    displayName: 'Product Path B',
    endpoint: 'https://relay-b.example.com',
    model: 'claude-sonnet-4-5',
    apiKey: FAKE_KEY_B
  })
  record('create profile B through renderer form', profileB.saved?.apiKeyConfigured === true && profileB.saved.enabled === true, `feedback: ${profileB.feedback}`)
  const idA = profileA.saved.id
  const idB = profileB.saved.id
  assert.notEqual(idA, idB)

  const continuityBefore = await activeClient.evaluate(continuityScript)
  await stop(activeRun, activeClient)
  await delay(750)
  activeRun = undefined
  activeClient = undefined
  const dbBefore = snapshotDatabase()
  const secretsBefore = snapshotSecrets([idA, idB])
  record('two profiles use distinct OS secret files', secretsBefore[idA] !== null && secretsBefore[idB] !== null && secretsBefore[idA] !== secretsBefore[idB], 'distinct ciphertext digests')

  started = await start()
  activeRun = started.run
  activeClient = started.client
  const afterRestart = await activeClient.evaluate(`(async () => {
    let lastError = null
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const list = await window.morrow.providers.listProfiles()
      if (list.ok) {
        return {
          ok: true,
          profiles: list.data.map((profile) => ({ id: profile.id, enabled: profile.enabled, apiKeyConfigured: profile.apiKeyConfigured, endpoint: profile.endpoint }))
        }
      }
      lastError = list.error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return { ok: false, error: lastError ? lastError.code + ': ' + lastError.message : 'unknown' }
  })()`)
  if (!afterRestart.ok) record('profiles and OS secrets survive restart', false, afterRestart.error)
  const restartedA = afterRestart.profiles.find((profile) => profile.id === idA)
  const restartedB = afterRestart.profiles.find((profile) => profile.id === idB)
  record('profiles and OS secrets survive restart', restartedA?.apiKeyConfigured === true && restartedB?.apiKeyConfigured === true, 'both profiles read back configured after restart')
  const continuityAfterRestart = await activeClient.evaluate(continuityScript)
  record('continuity unchanged across restart', hash(continuityAfterRestart) === hash(continuityBefore), `differing=${differingKeys(continuityBefore, continuityAfterRestart).join(',') || 'none'}`)
  const dbAfterRestart = snapshotDatabase()
  record('SQLite row counts unchanged across restart', hash(dbAfterRestart.snapshot) === hash(dbBefore.snapshot), 'all continuity table counts match')

  const changed = await saveProfileThroughForm(activeClient, {
    profileId: idA,
    displayName: 'Product Path A',
    endpoint: 'https://relay-a-new.example.com',
    model: 'gemini-3-flash',
    apiKey: '',
    enabled: true
  })
  record('endpoint change clears the old secret and disables the remote profile',
    changed.saved?.apiKeyConfigured === false && changed.saved.enabled === false && changed.feedback.includes('旧密钥已清除'),
    `feedback: ${changed.feedback}`)
  await stop(activeRun, activeClient)
  await delay(750)
  activeRun = undefined
  activeClient = undefined
  const secretsAfterChange = snapshotSecrets([idA, idB])
  record('only the changed profile secret was removed', secretsAfterChange[idA] === null && secretsAfterChange[idB] === secretsBefore[idB], 'B ciphertext unchanged')

  started = await start()
  activeRun = started.run
  activeClient = started.client
  const rekeyed = await saveProfileThroughForm(activeClient, {
    profileId: idA,
    displayName: 'Product Path A',
    endpoint: 'https://relay-a-new.example.com',
    model: 'gemini-3-flash',
    apiKey: FAKE_KEY_A2
  })
  record('re-entering a key re-enables the profile', rekeyed.saved?.apiKeyConfigured === true && rekeyed.saved.enabled === true, `feedback: ${rekeyed.feedback}`)
  await stop(activeRun, activeClient)
  await delay(750)
  activeRun = undefined
  activeClient = undefined
  const secretsAfterRekey = snapshotSecrets([idA, idB])
  record('rekey writes a new OS secret without touching the other profile', secretsAfterRekey[idA] !== null && secretsAfterRekey[idA] !== secretsBefore[idA] && secretsAfterRekey[idB] === secretsBefore[idB], 'A ciphertext rotated, B unchanged')

  started = await start()
  activeRun = started.run
  activeClient = started.client
  const switched = await activeClient.evaluate(`(async () => {
    const a = await window.morrow.providers.setDefaultProfile({ profileId: ${JSON.stringify(idA)} })
    const b = await window.morrow.providers.setDefaultProfile({ profileId: ${JSON.stringify(idB)} })
    const back = await window.morrow.providers.setDefaultProfile({ profileId: ${JSON.stringify(idA)} })
    if (!a.ok || !b.ok || !back.ok) throw new Error('Default switch failed.')
    const list = await window.morrow.providers.listProfiles()
    if (!list.ok) throw new Error('Profile list failed after switch.')
    return list.data.map((profile) => ({ id: profile.id, isDefault: profile.isDefault }))
  })()`)
  record('switch A → B → A through the product bridge', switched.find((profile) => profile.id === idA)?.isDefault === true, 'A is default again')
  const continuityAfterSwitch = await activeClient.evaluate(continuityScript)
  record('continuity unchanged across provider switch', hash(continuityAfterSwitch) === hash(continuityBefore), `differing=${differingKeys(continuityBefore, continuityAfterSwitch).join(',') || 'none'}`)
  await stop(activeRun, activeClient)
  await delay(750)
  activeRun = undefined
  activeClient = undefined
  const dbAfterSwitch = snapshotDatabase()
  record('SQLite row counts unchanged across provider switch', hash(dbAfterSwitch.snapshot) === hash(dbBefore.snapshot), 'all continuity table counts match')

  started = await start()
  activeRun = started.run
  activeClient = started.client
  const deleted = await activeClient.evaluate(`(async () => {
    const card = document.querySelector('[data-profile-id="${idB}"]')
    const remove = card?.querySelector('button.button-danger')
    if (!(remove instanceof HTMLButtonElement)) throw new Error('Delete control is unavailable.')
    remove.click()
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const list = await window.morrow.providers.listProfiles()
      if (list.ok && !list.data.some((profile) => profile.id === ${JSON.stringify(idB)})) return { deleted: true }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return { deleted: false }
  })()`)
  record('delete profile B through the renderer', deleted.deleted === true, 'B removed from the list')
  await stop(activeRun, activeClient)
  await delay(750)
  activeRun = undefined
  activeClient = undefined
  const secretsAfterDelete = snapshotSecrets([idA, idB])
  record('deleting B removes only B’s OS secret', secretsAfterDelete[idB] === null && secretsAfterDelete[idA] !== null, 'A secret retained')

  started = await start()
  activeRun = started.run
  activeClient = started.client
  const finalState = await activeClient.evaluate(`(async () => {
    const list = await window.morrow.providers.listProfiles()
    const continuity = ${continuityScript}
    if (!list.ok) throw new Error('Final profile list failed.')
    return {
      profiles: list.data.map((profile) => ({ id: profile.id, enabled: profile.enabled, apiKeyConfigured: profile.apiKeyConfigured })),
      continuity
    }
  })()`)
  record('final restart keeps only A configured', finalState.profiles.length === 1 && finalState.profiles[0].id === idA && finalState.profiles[0].apiKeyConfigured === true, 'one configured profile remains')
  record('final continuity unchanged', hash(finalState.continuity) === hash(continuityBefore), `differing=${differingKeys(continuityBefore, finalState.continuity).join(',') || 'none'}`)

  result.status = 'PASS'
  result.continuity = {
    baselineSha256: hash(continuityBefore),
    afterRestartSha256: hash(continuityAfterRestart),
    afterSwitchSha256: hash(continuityAfterSwitch),
    finalSha256: hash(finalState.continuity),
    databaseBaselineSha256: hash(dbBefore.snapshot),
    databaseAfterRestartSha256: hash(dbAfterRestart.snapshot),
    databaseAfterSwitchSha256: hash(dbAfterSwitch.snapshot),
    tables: Object.keys(dbBefore.snapshot)
  }
  result.secrets = {
    a: { before: secretsBefore[idA], afterChange: secretsAfterChange[idA], afterRekey: secretsAfterRekey[idA] },
    b: { before: secretsBefore[idB], afterChange: secretsAfterChange[idB], afterDelete: secretsAfterDelete[idB] }
  }
  result.profiles = { a: idA, b: idB }
} catch (error) {
  result.status = 'FAILED'
  result.error = error instanceof Error ? error.message : 'Unknown error'
} finally {
  if (activeRun) await stop(activeRun, activeClient)
  result.finishedAt = new Date().toISOString()
  mkdirSync(resultsDir, { recursive: true })
  mkdirSync(transcriptsDir, { recursive: true })
  writeFileSync(join(resultsDir, `${runId}.json`), `${JSON.stringify(result, null, 2)}\n`)
  const lines = [
    `# Morrow V2 final product-path run ${runId}`,
    '',
    `- Status: **${result.status}**`,
    `- Platform: ${result.platform} · Electron ${result.electronVersion || 'unknown'}`,
    `- Started: ${result.startedAt} · Finished: ${result.finishedAt}`,
    `- Profile: isolated temporary Electron profile`,
    '',
    '## Checks',
    '',
    ...checks.map((check) => `- ${check.ok ? 'PASS' : 'FAIL'} — ${check.name}: ${check.detail}`),
    '',
    '## Continuity',
    '',
    `- Bridge baseline: \`${result.continuity.baselineSha256 ?? 'not-run'}\``,
    `- After restart: \`${result.continuity.afterRestartSha256 ?? 'not-run'}\``,
    `- After A → B → A: \`${result.continuity.afterSwitchSha256 ?? 'not-run'}\``,
    `- Final: \`${result.continuity.finalSha256 ?? 'not-run'}\``,
    '',
    '## Limitation',
    '',
    result.limitation,
    '',
    'No API key, Authorization header or response body is recorded. Keys used here are fake literals.'
  ]
  writeFileSync(join(transcriptsDir, `${runId}.md`), `${lines.join('\n')}\n`)
  if (result.error) process.stderr.write(`${result.error}\n`)
  process.stdout.write(`${JSON.stringify({ runId, status: result.status, file: join(resultsDir, `${runId}.json`) })}\n`)
  process.exitCode = result.status === 'PASS' ? 0 : 1
}
