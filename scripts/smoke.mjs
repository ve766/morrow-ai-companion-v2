import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const electronBinary = process.platform === 'win32'
  ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : join(root, 'node_modules', 'electron', 'dist', 'electron')
const appEntry = join(root, 'out', 'main', 'index.js')
const installedExecutable = process.env.MORROW_SMOKE_EXECUTABLE ? resolve(process.env.MORROW_SMOKE_EXECUTABLE) : undefined
const externalProfile = process.env.MORROW_SMOKE_PROFILE ? resolve(process.env.MORROW_SMOKE_PROFILE) : undefined
const profile = externalProfile ?? await mkdtemp(join(tmpdir(), 'morrow-alpha-smoke-'))
const seederBundlePath = join(profile, `morrow-alpha-smoke-seeder-${process.pid}.mjs`)

if (externalProfile) await mkdir(profile, { recursive: true })
if (installedExecutable ? !existsSync(installedExecutable) : !existsSync(electronBinary)) {
  throw new Error(installedExecutable ? 'Installed Morrow executable was not found.' : 'Electron is not installed. Run npm ci first.')
}
if (!existsSync(appEntry)) throw new Error('Built application not found. Run npm run build first.')

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
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

function launch(port, { remindersEnabled = false, profileDirectory = profile } = {}) {
  const environment = { ...process.env }
  delete environment.ELECTRON_RENDERER_URL
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.MORROW_ENABLE_LOCAL_REMINDERS
  for (const key of Object.keys(environment)) {
    if (key.startsWith('MORROW_SMOKE_')) delete environment[key]
  }
  if (remindersEnabled) environment.MORROW_ENABLE_LOCAL_REMINDERS = 'true'
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--disable-gpu',
    '--disable-dev-shm-usage'
  ]
  args.push(`--user-data-dir=${profileDirectory}`)
  // Linux CI containers cannot use the Chromium setuid sandbox; headless
  // smoke runs there explicitly opt out (Windows/macOS unaffected).
  if (process.platform === 'linux') args.push('--no-sandbox')
  if (!installedExecutable) args.push(root)
  const child = spawn(installedExecutable ?? electronBinary, args, {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8192)
  })
  const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  return { child, exited, port, get stderr() { return stderr } }
}

async function findPage(run) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (run.child.exitCode !== null) {
      const details = run.stderr.trim()
      throw new Error(`Built application exited during launch (${run.child.exitCode})${details ? `: ${details}` : '.'}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${run.port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page.webSocketDebuggerUrl
      }
    } catch {
      await delay(200)
    }
    await delay(200)
  }
  throw new Error('Built renderer did not become available for the real IPC smoke test.')
}

async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.error) request.reject(new Error('DevTools command failed.'))
    else request.resolve(message.result)
  })
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error('DevTools connection timed out.')), 10000)
    socket.addEventListener('open', () => {
      clearTimeout(timeout)
      resolveOpen()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      rejectOpen(new Error('DevTools connection failed.'))
    }, { once: true })
  })

  return {
    evaluate(expression) {
      return new Promise((resolveResult, rejectResult) => {
        const id = ++nextId
        const timeout = setTimeout(() => {
          pending.delete(id)
          rejectResult(new Error('Renderer evaluation timed out.'))
        }, 15000)
        pending.set(id, { resolve: resolveResult, reject: rejectResult, timeout })
        socket.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        }))
      }).then((result) => {
        if (result.exceptionDetails) throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown exception'}.`)
        return result.result?.value
      })
    },
    close() {
      if (socket.readyState === WebSocket.OPEN) socket.close()
    }
  }
}

async function waitForBridge(client) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate('typeof window.morrow === "object"')) return
    } catch {
      await delay(200)
    }
    await delay(200)
  }
  throw new Error('The built renderer did not expose its typed preload bridge.')
}

async function stop(run, client) {
  client?.close()
  if (run.child.exitCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      run.child.kill()
    }
    await Promise.race([run.exited, delay(5000)])
  }
}

async function start(options = {}) {
  const run = launch(await freePort(), options)
  let client
  try {
    client = await connect(await findPage(run))
    await waitForBridge(client)
    return { run, client }
  } catch (error) {
    await stop(run, client)
    const message = error instanceof Error ? error.message : 'Application startup failed.'
    const diagnostic = run.stderr.trim()
    throw new Error(diagnostic ? `${message}\n${diagnostic}` : message)
  }
}

const manifestPath = join(profile, 'morrow-alpha-smoke-manifest.json')

async function buildSmokeSeeder() {
  await build({
    entryPoints: [join(root, 'scripts', 'seed-alpha-smoke.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: seederBundlePath,
    logLevel: 'silent'
  })
}

function runSeeder(action, ...args) {
  if (!existsSync(seederBundlePath)) throw new Error('Alpha smoke fixture was not compiled.')
  const result = spawnSync(process.execPath, [seederBundlePath, action, profile, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Alpha smoke fixture action '${action}' failed.`)
  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    throw new Error(`Alpha smoke fixture action '${action}' returned invalid output.`)
  }
}

async function verifyInstalledUpgrade() {
  if (!installedExecutable || !externalProfile) throw new Error('Installed-app verification requires an isolated profile and executable.')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let run
  let client
  try {
    const started = await start()
    run = started.run
    client = started.client
    const state = await client.evaluate(`(async () => {
      const info = await window.morrow.getAppInfo()
      const cognition = await window.morrow.cognition.getSettings()
      const feeling = await window.morrow.cognition.getFeelingState()
      const conversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(manifest.conversationId)} })
      const memories = await window.morrow.memories.list()
      const personality = await window.morrow.personality.get()
      const provider = await window.morrow.providers.get()
      if (!info.ok || !cognition.ok || !feeling.ok || !conversation.ok || !memories.ok || !personality.ok || !provider.ok) {
        throw new Error('Installed update IPC verification failed.')
      }
      const messages = conversation.data.messages
      return {
        version: info.data.version,
        cognitionDisabled: cognition.data.available && !cognition.data.enabled &&
          document.querySelector('#cognitive-enabled')?.checked === false && Boolean(cognition.data.updatedAt),
        stateCleared: feeling.data.available && feeling.data.eventCount === 0 && feeling.data.recentEvents.length === 0 &&
          feeling.data.state.revision === 0 && feeling.data.state.sourceEventId === null &&
          Object.values(feeling.data.state.values).every((value) => value === 0) &&
          feeling.data.state.attention.explorationPriority === 0 && feeling.data.state.attention.evidenceRefs.length === 0,
        conversationRetained: messages.length === 3 && messages.some((message) => message.body === ${JSON.stringify(manifest.cognitiveMessage)}),
        observationsCleared: messages.every((message) => !message.cognitiveObservations?.length),
        memoryRetained: memories.data.some((memory) => memory.status === 'active' && memory.currentText === ${JSON.stringify(manifest.persistentText)}),
        personalityRetained: personality.data.version === 2 && personality.data.systemRules === ${JSON.stringify(manifest.personalityMarker)},
        providerUnconfigured: provider.data === null
      }
    })()`)
    const expectedVersion = process.env.MORROW_SMOKE_EXPECT_VERSION
    if (expectedVersion && state.version !== expectedVersion) throw new Error(`Installed app version '${state.version}' did not match '${expectedVersion}'.`)
    for (const key of ['cognitionDisabled', 'stateCleared', 'conversationRetained', 'observationsCleared', 'memoryRetained', 'personalityRetained', 'providerUnconfigured']) {
      if (state[key] !== true) throw new Error(`Installed app upgrade did not preserve '${key}'.`)
    }
    console.log(JSON.stringify({ passed: true, ...state }))
  } finally {
    if (client) await client.evaluate('window.close()').catch(() => undefined)
    if (run) {
      await Promise.race([run.exited, delay(10000)])
      await stop(run, client)
    }
  }
}

function findProfileFile(directory, filename) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) return join(directory, entry.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findProfileFile(join(directory, entry.name), filename)
    if (found) return found
  }
  return undefined
}

async function verifyProviderCredentialStorage(initialRun, initialClient) {
  const credential = `OFFLINE_MORROW_TEST_CREDENTIAL_${randomUUID()}`
  let currentRun = initialRun
  let currentClient = initialClient
  const closeCurrent = async () => {
    if (!currentRun) return
    if (currentClient) await currentClient.evaluate('window.close()').catch(() => undefined)
    await Promise.race([currentRun.exited, delay(10000)])
    if (currentRun.child.exitCode === null) throw new Error('Built application did not close cleanly after Provider storage verification.')
    await stop(currentRun, currentClient)
    currentRun = undefined
    currentClient = undefined
  }
  try {
    const saved = await currentClient.evaluate(`(async () => {
      const form = document.querySelector('#provider-form')
      const input = document.querySelector('#provider-api-key')
      const enabled = document.querySelector('#provider-enabled')
      const submit = form?.querySelector('button[type="submit"]')
      if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !(enabled instanceof HTMLInputElement) || !(submit instanceof HTMLButtonElement)) {
        throw new Error('Provider configuration controls are unavailable.')
      }
      input.value = ${JSON.stringify(credential)}
      enabled.checked = true
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      const deadline = Date.now() + 7000
      while (submit.disabled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
      const info = await window.morrow.getAppInfo()
      const provider = await window.morrow.providers.get()
      if (!info.ok || !provider.ok) throw new Error('Provider configuration IPC failed.')
      return {
        platform: info.data.platform,
        saved: provider.data?.enabled === true && provider.data.apiKeyConfigured === true,
        noCredentialInIpc: provider.data === null || !Object.prototype.hasOwnProperty.call(provider.data, 'apiKey'),
        keyInputBlank: input.value === '',
        sendEnabled: document.querySelector('#chat-send')?.disabled === false,
        feedback: document.querySelector('#provider-feedback')?.textContent ?? ''
      }
    })()`)
    assert.equal(saved.noCredentialInIpc, true, 'Provider IPC must never return the API key.')
    assert.equal(saved.keyInputBlank, true, 'The password field must clear after each save attempt.')
    const databasePath = findProfileFile(profile, 'morrow.sqlite3')
    assert.ok(databasePath, 'The isolated Morrow database must exist.')
    const credentialPath = join(dirname(databasePath), 'secrets', 'deepseek.bin')
    if (!saved.saved) {
      assert.notEqual(saved.platform, 'win32', 'Windows safeStorage must accept a synthetic credential in the installed app.')
      assert.match(saved.feedback, /系统安全存储不可用/u, 'Unsupported secure storage must report a clear failure.')
      assert.equal(saved.sendEnabled, false, 'Chat must stay disabled when safeStorage refuses the credential.')
      await closeCurrent()
      const database = new DatabaseSync(databasePath, { readOnly: true })
      try {
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get()?.count, 0)
      } finally {
        database.close()
      }
      assert.equal(existsSync(credentialPath), false, 'A rejected credential must not leave a secret file.')
      return { platform: saved.platform, storage: 'failed-closed', liveProviderRequests: 0 }
    }

    assert.equal(saved.sendEnabled, true, 'Chat should be enabled only after a protected credential is available.')
    assert.match(saved.feedback, /密钥不会回显或写入 SQLite/u)
    await closeCurrent()
    assert.ok(existsSync(credentialPath), 'Electron safeStorage must persist the synthetic credential outside SQLite.')
    assert.equal(readFileSync(credentialPath).includes(Buffer.from(credential)), false, 'The secret file must not contain plaintext credentials.')
    assert.equal(readFileSync(databasePath).includes(Buffer.from(credential)), false, 'SQLite must not contain the API key.')
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const row = database.prepare('SELECT id, endpoint, model, enabled FROM provider_profiles WHERE id = ?').get('deepseek')
      assert.deepEqual({ ...row }, { id: 'deepseek', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', enabled: 1 })
    } finally {
      database.close()
    }

    const restarted = await start()
    currentRun = restarted.run
    currentClient = restarted.client
    const restored = await currentClient.evaluate(`(async () => {
      const deadline = Date.now() + 7000
      // Wait for a SETTLED provider status: the initial pill text is a
      // placeholder and the async load performs two IPC roundtrips.
      while (Date.now() < deadline && !/已配置|尚未配置|未启用|未确认/.test(document.querySelector('#provider-status')?.textContent ?? '')) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const provider = await window.morrow.providers.get()
      const input = document.querySelector('#provider-api-key')
      if (!provider.ok) throw new Error('Provider state could not be read after restart.')
      return {
        configured: provider.data?.enabled === true && provider.data.apiKeyConfigured === true,
        noCredentialInIpc: provider.data === null || !Object.prototype.hasOwnProperty.call(provider.data, 'apiKey'),
        keyInputBlank: input instanceof HTMLInputElement && input.value === '',
        sendEnabled: document.querySelector('#chat-send')?.disabled === false
      }
    })()`)
    assert.deepEqual(restored, { configured: true, noCredentialInIpc: true, keyInputBlank: true, sendEnabled: true })
    await closeCurrent()
    const corruptCiphertext = Buffer.from('MORROW_OFFLINE_SYNTHETIC_CORRUPT_CIPHERTEXT')
    writeFileSync(credentialPath, corruptCiphertext)
    const corrupted = await start()
    currentRun = corrupted.run
    currentClient = corrupted.client
    const corruptState = await currentClient.evaluate(`(async () => {
      const deadline = Date.now() + 7000
      while (Date.now() < deadline && !document.querySelector('#provider-status')?.textContent?.includes('系统安全存储状态未确认')) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const provider = await window.morrow.providers.get()
      const status = document.querySelector('#provider-status')?.textContent ?? ''
      const input = document.querySelector('#provider-api-key')
      const enabled = document.querySelector('#provider-enabled')
      const form = document.querySelector('#provider-form')
      if (!(input instanceof HTMLInputElement) || !(enabled instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        throw new Error('Provider credential recovery controls are unavailable.')
      }
      input.value = 'OFFLINE_MORROW_REPLACEMENT_AFTER_CORRUPTION'
      enabled.checked = true
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      const saveDeadline = Date.now() + 7000
      const submit = form.querySelector('button[type="submit"]')
      if (!(submit instanceof HTMLButtonElement)) throw new Error('Provider save control is unavailable.')
      while (Date.now() < saveDeadline && (submit.disabled || input.value !== '')) await new Promise((resolve) => setTimeout(resolve, 25))
      const feedback = document.querySelector('#provider-feedback')?.textContent ?? ''
      return {
        getRejectedAsCorrupt: provider.ok === false && provider.error.code === 'PROVIDER_CREDENTIAL_STORE_ERROR',
        getErrorIsGeneric: provider.ok === false && !provider.error.message.includes('MORROW_OFFLINE_SYNTHETIC_CORRUPT_CIPHERTEXT'),
        startupPaused: status.includes('系统安全存储状态未确认'),
        chatDisabled: document.querySelector('#chat-send')?.disabled === true,
        connectionTestDisabled: document.querySelector('#provider-test')?.disabled === true,
        replacementRejected: feedback.includes('本机 API 凭据无法安全读取') && input.value === ''
      }
    })()`)
    assert.deepEqual(corruptState, {
      getRejectedAsCorrupt: true,
      getErrorIsGeneric: true,
      startupPaused: true,
      chatDisabled: true,
      connectionTestDisabled: true,
      replacementRejected: true
    })
    assert.deepEqual(readFileSync(credentialPath), corruptCiphertext, 'A failed replacement must preserve the damaged encrypted file for an explicit user decision.')
    const cleared = await currentClient.evaluate(`(async () => {
      const button = document.querySelector('#provider-clear-key')
      if (!(button instanceof HTMLButtonElement)) throw new Error('Provider credential delete control is unavailable.')
      window.confirm = () => true
      button.click()
      const deadline = Date.now() + 7000
      while (Date.now() < deadline && !document.querySelector('#provider-feedback')?.textContent?.includes('API 密钥已从本机安全存储移除')) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const provider = await window.morrow.providers.get()
      if (!provider.ok) throw new Error('Provider state could not be read after explicit credential deletion.')
      return {
        keyRemoved: provider.data?.apiKeyConfigured === false,
        sendDisabled: document.querySelector('#chat-send')?.disabled === true,
        feedback: document.querySelector('#provider-feedback')?.textContent ?? ''
      }
    })()`)
    assert.deepEqual(cleared, { keyRemoved: true, sendDisabled: true, feedback: 'API 密钥已从本机安全存储移除；聊天保持离线。' })
    await closeCurrent()
    assert.equal(existsSync(credentialPath), false, 'The explicit delete action must remove the encrypted credential file.')
    const cleanupDatabase = new DatabaseSync(databasePath)
    try {
      cleanupDatabase.prepare('DELETE FROM provider_profiles WHERE id = ?').run('deepseek')
    } finally {
      cleanupDatabase.close()
    }
    assert.equal(readFileSync(databasePath).includes(Buffer.from(credential)), false)
    return { platform: saved.platform, storage: 'encrypted-restart-corruption-protected-then-explicit-delete-verified', liveProviderRequests: 0 }
  } finally {
    if (currentRun) await stop(currentRun, currentClient)
  }
}

if (process.argv.includes('--verify-upgrade')) {
  try {
    await verifyInstalledUpgrade()
  } catch (error) {
    console.error(`Morrow installed-update verification failed: ${error instanceof Error ? error.message : 'Unknown error'}.`)
    process.exitCode = 1
  }
} else {
const unique = randomUUID().replaceAll('-', '')
const originalText = `MORROW_SMOKE_${unique} <script>window.__morrowInjected = true</script>`
const correctedText = `MORROW_SMOKE_CORRECTED_${unique}`
const persistentText = `MORROW_SMOKE_PERSIST_${randomUUID().replaceAll('-', '')}`
const personalityMarker = `MORROW_ALPHA_PERSONALITY_${unique}`
const cognitiveMarker = `MORROW_ALPHA_COGNITIVE_${unique}`
const deletedConversationMarker = `MORROW_ALPHA_DELETED_${unique}`
let smokeConversationId = ''
let activeRun
let activeClient
let stage = 'smoke fixture compilation'

try {
  await buildSmokeSeeder()
  const first = await start()
  activeRun = first.run
  activeClient = first.client

  stage = 'runtime metadata IPC'
  const info = await activeClient.evaluate(`(async () => {
    const result = await window.morrow.getAppInfo()
    if (!result || result.ok !== true) throw new Error('App info IPC failed.')
    return result.data
  })()`)
  assert.equal(info.name, 'Morrow')
  assert.equal(info.dataPolicy, 'local-first-consented-deepseek-egress-memory-goals-reminders')
  if (!info.version || !info.electronVersion) throw new Error('Runtime metadata IPC is incomplete.')
  if (process.env.MORROW_SMOKE_EXPECT_VERSION && info.version !== process.env.MORROW_SMOKE_EXPECT_VERSION) {
    throw new Error(`Installed app version '${info.version}' did not match the expected test version.`)
  }

  stage = 'M5 provider default-off and no fabricated reply'
  const companionDefaults = await activeClient.evaluate(`(async () => {
    const deadline = Date.now() + 7000
    const select = document.querySelector('#conversation-select')
    while (Date.now() < deadline && (!select?.options.length || !document.querySelector('#provider-status')?.textContent?.includes('尚未配置'))) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const provider = await window.morrow.providers.get()
    const conversations = await window.morrow.conversations.list()
    const personality = await window.morrow.personality.get()
    if (!provider.ok || !conversations.ok || !personality.ok || conversations.data.length !== 1) throw new Error('M5 local defaults are unavailable.')
    const conversation = await window.morrow.conversations.read({ conversationId: conversations.data[0].id })
    const attempt = await window.morrow.chat.send({
      conversationId: conversations.data[0].id,
      requestId: crypto.randomUUID(),
      content: 'This must stay offline without an approved provider.',
      includeSensitive: false
    })
    const after = await window.morrow.conversations.read({ conversationId: conversations.data[0].id })
    return {
      providerUnconfigured: provider.data === null,
      sendDisabled: document.querySelector('#chat-send')?.disabled === true,
      testDisabled: document.querySelector('#provider-test')?.disabled === true,
      keyFieldBlank: document.querySelector('#provider-api-key')?.value === '',
      defaultPersonality: personality.data.version === 1,
      noPriorMessages: conversation.ok && conversation.data.messages.length === 0,
      sendRejected: attempt.ok === false && attempt.error.code === 'PROVIDER_UNCONFIGURED',
      noFabricatedReply: after.ok && after.data.messages.length === 0
    }
  })()`)
  if (!companionDefaults.providerUnconfigured || !companionDefaults.sendDisabled || !companionDefaults.testDisabled ||
    !companionDefaults.keyFieldBlank || !companionDefaults.defaultPersonality || !companionDefaults.noPriorMessages ||
    !companionDefaults.sendRejected || !companionDefaults.noFabricatedReply) {
    throw new Error('M5 did not remain offline without an explicitly configured provider.')
  }

  stage = 'cognitive core default-off and explicit local opt-in through the UI'
  const cognitiveDefaults = await activeClient.evaluate(`(async () => {
    const settings = await window.morrow.cognition.getSettings()
    const initial = await window.morrow.cognition.getFeelingState()
    const enabled = document.querySelector('#cognitive-enabled')
    const form = document.querySelector('#cognitive-settings-form')
    const disclosure = document.querySelector('#cognitive-settings-status')?.textContent ?? ''
    const select = document.querySelector('#conversation-select')
    if (!settings?.ok || !initial?.ok || !(enabled instanceof HTMLInputElement) || !(form instanceof HTMLFormElement) || !(select instanceof HTMLSelectElement)) {
      throw new Error('Cognitive IPC or first-run controls are unavailable.')
    }
    const untilReady = Date.now() + 7000
    while (Date.now() < untilReady && (enabled.disabled || !select.value)) await new Promise((resolve) => setTimeout(resolve, 50))
    const defaultOff = settings.data.available && settings.data.enabled === false && settings.data.updatedAt === null && enabled.checked === false
    const defaultState = initial.data.available && initial.data.eventCount === 0 && initial.data.recentEvents.length === 0 &&
      initial.data.state.revision === 0 && initial.data.state.sourceEventId === null &&
      Object.values(initial.data.state.values).every((value) => value === 0) &&
      initial.data.state.attention.explorationPriority === 0 && initial.data.state.attention.evidenceRefs.length === 0
    let confirmation = ''
    const originalConfirm = window.confirm
    window.confirm = (message) => { confirmation = String(message); return true }
    try {
      enabled.checked = true
      form.requestSubmit()
      const deadline = Date.now() + 7000
      let saved
      while (Date.now() < deadline) {
        saved = await window.morrow.cognition.getSettings()
        if (saved?.ok && saved.data.enabled && document.querySelector('#chat-feedback')?.textContent?.includes('本地认知辅助已启用')) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return {
        available: settings.data.available && initial.data.available,
        defaultOff,
        defaultState,
        optInSaved: saved?.ok === true && saved.data.enabled && enabled.checked,
        enableDisclosure: confirmation.includes('本地规则') && confirmation.includes('结构化意图/事件') &&
          confirmation.includes('保存到本机 SQLite') && confirmation.includes('可能增加 token 用量') &&
          confirmation.includes('本地计算不联网') && confirmation.includes('不代表 Morrow 有真实感受或意识') &&
          confirmation.includes('随时关闭或清除'),
        initialDisclosure: disclosure.includes('本地认知默认关闭') && disclosure.includes('关闭时不会运行分析') &&
          disclosure.includes('保存认知记录或注入状态提示') && disclosure.includes('不代表真实感受或意识'),
        conversationId: select.value
      }
    } finally {
      window.confirm = originalConfirm
    }
  })()`)
  if (!cognitiveDefaults.available || !cognitiveDefaults.defaultOff || !cognitiveDefaults.defaultState ||
    !cognitiveDefaults.optInSaved || !cognitiveDefaults.enableDisclosure || !cognitiveDefaults.initialDisclosure || !cognitiveDefaults.conversationId) {
    throw new Error('Cognitive defaults, consent disclosure, or UI opt-in did not match the first-run contract.')
  }
  smokeConversationId = cognitiveDefaults.conversationId

  stage = 'personality persistence fixture through the UI'
  const personalityFixture = await activeClient.evaluate(`(async () => {
    const rules = document.querySelector('#personality-rules')
    const form = document.querySelector('#personality-form')
    const panel = document.querySelector('.personality-panel')
    if (!(rules instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement) || !(panel instanceof HTMLDetailsElement)) throw new Error('Personality controls are unavailable.')
    panel.open = true
    const readyDeadline = Date.now() + 7000
    while (Date.now() < readyDeadline && document.querySelector('#personality-version')?.textContent !== '版本 1') {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (document.querySelector('#personality-version')?.textContent !== '版本 1') throw new Error('Initial personality profile did not load into the UI.')
    rules.value = ${JSON.stringify(personalityMarker)}
    form.requestSubmit()
    const deadline = Date.now() + 7000
    let profile
    while (Date.now() < deadline) {
      const result = await window.morrow.personality.get()
      const versionVisible = document.querySelector('#personality-version')?.textContent === '版本 2'
      const successVisible = document.querySelector('#chat-feedback')?.textContent?.includes('沟通风格已保存') === true
      if (result?.ok && result.data.version === 2 && result.data.systemRules === ${JSON.stringify(personalityMarker)} && versionVisible && successVisible) {
        profile = result.data
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return {
      saved: profile?.version === 2 && profile.systemRules === ${JSON.stringify(personalityMarker)},
      versionVisible: document.querySelector('#personality-version')?.textContent === '版本 2',
      successVisible: document.querySelector('#chat-feedback')?.textContent?.includes('沟通风格已保存') === true,
      versionText: document.querySelector('#personality-version')?.textContent ?? '',
      feedbackText: document.querySelector('#chat-feedback')?.textContent ?? ''
    }
  })()`)
  if (!personalityFixture.saved || !personalityFixture.versionVisible || !personalityFixture.successVisible) {
    throw new Error(`The UI did not persist the test personality version and show its success state: ${JSON.stringify(personalityFixture)}.`)
  }

  stage = 'M4 reminder feature gate and default opt-out'
  const reminderDefaults = await activeClient.evaluate(`(async () => {
    const statusNode = document.querySelector('#reminder-status')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !statusNode?.textContent?.includes('旗标关闭')) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const result = await window.morrow.reminders.getSnapshot()
    if (!result?.ok) throw new Error('Reminder snapshot IPC failed.')
    const save = await window.morrow.reminders.saveSettings({
      enabled: true,
      goalReviewEnabled: true,
      acceptConsent: true,
      maxPer24Hours: 3,
      cooldownMinutes: 120,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timeZone: 'Asia/Shanghai'
    })
    const status = document.querySelector('#reminder-status')
    return {
      featureDisabled: result.data.featureEnabled === false,
      defaultOptOut: result.data.settings.enabled === false && result.data.settings.goalReviewEnabled === false &&
        result.data.settings.consentStatus === 'never' && result.data.reminders.length === 0,
      settingsLocked: document.querySelector('#reminders-enabled')?.disabled === true &&
        document.querySelector('#goal-review-enabled')?.disabled === true,
      statusExplainsGate: status?.textContent?.includes('旗标关闭') === true,
      enableRejected: save.ok === false && save.error.code === 'FORBIDDEN'
    }
  })()`)
  if (!reminderDefaults.featureDisabled || !reminderDefaults.defaultOptOut || !reminderDefaults.settingsLocked ||
    !reminderDefaults.statusExplainsGate || !reminderDefaults.enableRejected) {
    throw new Error('M4 reminders were not held closed by the default feature flag and opt-out settings.')
  }

  stage = 'explicit memory save and renderer display'


  const saveResult = await activeClient.evaluate(`(async () => {
    const text = ${JSON.stringify(originalText)}
    const input = document.querySelector('#create-content')
    const form = document.querySelector('#create-form')
    if (!(input instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) throw new Error('Memory form is missing.')
    input.value = text
    form.requestSubmit()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const visible = [...document.querySelectorAll('.memory-content')].some((node) => node.textContent === text)
      if (visible) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const visible = [...document.querySelectorAll('.memory-content')].some((node) => node.textContent === text)
    const listed = await window.morrow.memories.list()
    if (!listed.ok || listed.data.length !== 1) throw new Error('Memory list IPC failed.')
    const record = listed.data[0]
    const history = await window.morrow.memories.history({ id: record.id })
    return {
      visible,
      fixedSource: record.sourceCategory === 'user_explicit_input',
      originalRetained: record.originalText === text && record.currentText === text,
      firstRevision: history.ok && history.data.length === 1 && history.data[0].previousRevision === null,
      escapedMarkup: document.querySelector('#memory-list img, #memory-list script') === null,
      id: record.id
    }
  })()`)
  if (!saveResult.visible || !saveResult.fixedSource || !saveResult.originalRetained || !saveResult.firstRevision || !saveResult.escapedMarkup) {
    throw new Error('Explicit save or safe rendering did not complete.')
  }

  stage = 'active-memory search'
  const searchResult = await activeClient.evaluate(`(async () => {
    const input = document.querySelector('#search-query')
    const form = document.querySelector('#search-form')
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('Search form is missing.')
    input.value = ${JSON.stringify(unique)}
    form.requestSubmit()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !document.querySelector('.memory-content')) await new Promise((resolve) => setTimeout(resolve, 50))
    const result = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    return result.ok && result.data.length === 1 && result.data[0].id === ${JSON.stringify(saveResult.id)}
  })()`)
  if (!searchResult) throw new Error('Active memory search failed.')

  stage = 'memory correction and lineage checks'
  const correctionResult = await activeClient.evaluate(`(async () => {
    const clear = document.querySelector('#clear-search')
    clear?.click()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && ![...document.querySelectorAll('.memory-card button')].some((button) => button.textContent === '更正')) await new Promise((resolve) => setTimeout(resolve, 50))
    window.confirm = () => true
    const card = document.querySelector('.memory-card')
    const correctionButton = [...card.querySelectorAll('button')].find((button) => button.textContent === '更正')
    correctionButton?.click()
    const form = card.querySelector('.correction-form')
    const field = form?.querySelector('textarea')
    if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLTextAreaElement)) throw new Error('Correction form is missing.')
    field.value = ${JSON.stringify(correctedText)}
    form.requestSubmit()
    const deadline2 = Date.now() + 7000
    while (Date.now() < deadline2 && document.querySelector('.memory-content')?.textContent !== ${JSON.stringify(correctedText)}) await new Promise((resolve) => setTimeout(resolve, 50))
    const listed = await window.morrow.memories.list()
    const history = await window.morrow.memories.history({ id: ${JSON.stringify(saveResult.id)} })
    return {
      visible: document.querySelector('.memory-content')?.textContent === ${JSON.stringify(correctedText)},
      retainedOriginal: listed.ok && listed.data[0]?.originalText === ${JSON.stringify(originalText)},
      historyLinked: history.ok && history.data.length === 2 && history.data[1].previousRevision === 1
    }
  })()`)
  if (!correctionResult.visible || !correctionResult.retainedOriginal || !correctionResult.historyLinked) {
    throw new Error('Correction or revision lineage did not complete.')
  }

  stage = 'visible revision history'
  const historyVisible = await activeClient.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.memory-card button')].find((item) => item.textContent === '查看修订谱系')
    button?.click()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !document.querySelector('.history-panel')) await new Promise((resolve) => setTimeout(resolve, 50))
    const panel = document.querySelector('.history-panel')
    return Boolean(panel && panel.textContent.includes('用户明确输入') && panel.textContent.includes(${JSON.stringify(originalText)}))
  })()`)
  if (!historyVisible) throw new Error('Revision history is not visible in the UI.')

  stage = 'revoke filter'
  const retractResult = await activeClient.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.memory-card button')].find((item) => item.textContent === '撤销')
    button?.click()
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && document.querySelector('.memory-card')?.dataset.status !== 'retracted') await new Promise((resolve) => setTimeout(resolve, 50))
    const search = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    return {
      visibleAsRetracted: document.querySelector('.memory-card')?.dataset.status === 'retracted',
      excludedFromSearch: search.ok && search.data.length === 0
    }
  })()`)
  if (!retractResult.visibleAsRetracted || !retractResult.excludedFromSearch) throw new Error('Retraction did not remove the memory from active search.')

  stage = 'explicit restore'
  const restoreResult = await activeClient.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.memory-card button')].find((item) => item.textContent === '恢复')
    button?.click()
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && document.querySelector('.memory-card')?.dataset.status !== 'active') await new Promise((resolve) => setTimeout(resolve, 50))
    const search = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    return document.querySelector('.memory-card')?.dataset.status === 'active' && search.ok && search.data.length === 1
  })()`)
  if (!restoreResult) throw new Error('Explicit restore did not return the memory to active search.')

  stage = 'hard deletion and deleted-data verification'
  const deleteResult = await activeClient.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.memory-card button')].find((item) => item.textContent === '删除')
    button?.click()
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && document.querySelector('.memory-card')) await new Promise((resolve) => setTimeout(resolve, 50))
    const list = await window.morrow.memories.list()
    const history = await window.morrow.memories.history({ id: ${JSON.stringify(saveResult.id)} })
    const search = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    return list.ok && list.data.length === 0 && !history.ok && history.error.code === 'NOT_FOUND' && search.ok && search.data.length === 0
  })()`)
  if (!deleteResult) throw new Error('Hard deletion did not remove the record and revision history.')

  stage = 'prepare restart fixture'
  const persistedSave = await activeClient.evaluate(`(async () => {
    const input = document.querySelector('#create-content')
    const form = document.querySelector('#create-form')
    if (!(input instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) throw new Error('Memory form is missing.')
    input.value = ${JSON.stringify(persistentText)}
    form.requestSubmit()
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && ![...document.querySelectorAll('.memory-content')].some((node) => node.textContent === ${JSON.stringify(persistentText)})) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const result = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    return result.ok && result.data.length === 0
  })()`)
  if (!persistedSave) throw new Error('Deleted memory reappeared before application restart.')

  stage = 'user goal creation, planning and approval rejection'
  const goalFlow = await activeClient.evaluate(`(async () => {
    const consent = document.querySelector('#goal-boundary')
    const form = document.querySelector('#goal-form')
    if (!(consent instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('Goal form is missing.')
    consent.checked = true
    form.requestSubmit()
    let deadline = Date.now() + 8000
    while (Date.now() < deadline && !document.querySelector('.goal-card')) await new Promise((resolve) => setTimeout(resolve, 50))
    const initial = await window.morrow.goals.list()
    if (!initial.ok || initial.data.length !== 1) return { goalCreated: false }
    const goal = initial.data[0].goal
    const reminderGoalSelect = document.querySelector('#reminder-goal')
    if (!(reminderGoalSelect instanceof HTMLSelectElement)) throw new Error('Reminder goal selector is missing.')
    const selectorDeadline = Date.now() + 5000
    while (Date.now() < selectorDeadline && ![...reminderGoalSelect.options].some((option) => option.value === goal.id)) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const reminderGoalSelectorUpdated = [...reminderGoalSelect.options].some((option) => option.value === goal.id)
    const goalCard = document.querySelector('.goal-card')
    const planButton = [...goalCard.querySelectorAll('button')].find((button) => button.textContent === '创建候选计划')
    planButton?.click()
    deadline = Date.now() + 7000
    while (Date.now() < deadline && !document.querySelector('.task-card[data-status="queued"]')) await new Promise((resolve) => setTimeout(resolve, 50))
    const planned = await window.morrow.goals.list()
    if (!planned.ok || planned.data[0]?.tasks[0]?.status !== 'queued') return { goalCreated: true, planQueued: false }
    const requestButton = [...document.querySelector('.goal-card').querySelectorAll('button')].find((button) => button.textContent === '查看并请求一次性授权')
    requestButton?.click()
    deadline = Date.now() + 7000
    while (Date.now() < deadline && !document.querySelector('.approval-challenge')) await new Promise((resolve) => setTimeout(resolve, 50))
    const awaiting = await window.morrow.goals.list()
    const challenge = awaiting.ok ? awaiting.data[0]?.tasks[0]?.approvalChallenge : null
    const challengeValid = Boolean(
      awaiting.ok && awaiting.data[0]?.tasks[0]?.status === 'awaiting_approval' &&
      challenge?.toolId === 'memory.count_active' && challenge.resourceScope === 'memory.active_count' &&
      challenge.risk === 'read-only' && challenge.singleUse && Object.keys(challenge.parameters).length === 0 &&
      challenge.expectedEffect.length > 0 && document.querySelector('.approval-challenge')
    )
    const rejectButton = [...document.querySelector('.goal-card').querySelectorAll('button')].find((button) => button.textContent === '拒绝本次授权')
    rejectButton?.click()
    deadline = Date.now() + 7000
    while (Date.now() < deadline && !document.querySelector('.task-card[data-status="cancelled"]')) await new Promise((resolve) => setTimeout(resolve, 50))
    const rejected = await window.morrow.goals.list()
    const task = rejected.ok ? rejected.data[0]?.tasks[0] : null
    const noExecution = Boolean(
      task?.status === 'cancelled' && task.action.resultCount === null &&
      !rejected.data[0].audit.some((entry) => entry.event === 'action_started') &&
      rejected.data[0].audit.some((entry) => entry.event === 'approval_rejected')
    )
    window.confirm = () => true
    const deleteButton = [...document.querySelector('.goal-card').querySelectorAll('button')].find((button) => button.textContent === '删除目标与审计记录')
    deleteButton?.click()
    deadline = Date.now() + 7000
    while (Date.now() < deadline && document.querySelector('.goal-card')) await new Promise((resolve) => setTimeout(resolve, 50))
    const selectorCleanupDeadline = Date.now() + 5000
    while (Date.now() < selectorCleanupDeadline && [...reminderGoalSelect.options].some((option) => option.value === goal.id)) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const reminderGoalSelectorCleared = ![...reminderGoalSelect.options].some((option) => option.value === goal.id)
    const deleted = await window.morrow.goals.list()
    return {
      goalCreated: goal.status === 'active' && goal.sourceCategory === 'user_explicit_input',
      reminderGoalSelectorUpdated,
      reminderGoalSelectorCleared,
      planQueued: planned.data[0]?.tasks[0]?.action.toolId === 'memory.count_active',
      challengeValid,
      noExecution,
      cascadeDeleted: deleted.ok && deleted.data.length === 0
    }
  })()`)
  if (!goalFlow.goalCreated || !goalFlow.reminderGoalSelectorUpdated || !goalFlow.reminderGoalSelectorCleared ||
    !goalFlow.planQueued || !goalFlow.challengeValid || !goalFlow.noExecution || !goalFlow.cascadeDeleted) {
    throw new Error('Goal lifecycle, approval rejection, or deletion verification failed.')
  }


  await activeClient.evaluate('window.close()').catch(() => undefined)
  await Promise.race([activeRun.exited, delay(10000)])
  if (activeRun.child.exitCode === null) throw new Error('Built application did not close cleanly for restart verification.')
  await stop(activeRun, activeClient)
  activeRun = undefined
  activeClient = undefined

  stage = 'seed persistent cognitive event before process restart'
  const seededCognitiveTurn = runSeeder('seed', smokeConversationId, cognitiveMarker)
  if (seededCognitiveTurn.conversationId !== smokeConversationId || seededCognitiveTurn.schemaVersion < 11 ||
    !seededCognitiveTurn.userText.includes(cognitiveMarker)) {
    throw new Error('The isolated cognitive event seed did not match its expected conversation/schema.')
  }
  const stagedCognition = runSeeder('inspect')
  const stagedObservationCount = stagedCognition.observations.find((row) => row.conversation_id === smokeConversationId)?.count ?? 0
  const stagedEventCount = stagedCognition.events.find((row) => row.conversation_id === smokeConversationId)?.count ?? 0
  if (stagedObservationCount !== 1 || stagedEventCount !== 1 || stagedCognition.state?.revision !== 1 || stagedCognition.state?.dirty !== 1) {
    throw new Error('The cognitive restart fixture was not staged as one dirty, replayable event.')
  }
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: seededCognitiveTurn.schemaVersion,
    conversationId: smokeConversationId,
    cognitiveMessage: seededCognitiveTurn.userText,
    persistentText,
    personalityMarker
  }), { mode: 0o600 })

  stage = 'application restart'
  const second = await start({ remindersEnabled: true })
  activeRun = second.run
  activeClient = second.client
  stage = 'post-restart persistence and deletion verification'
  const restartResult = await activeClient.evaluate(`(async () => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && ![...document.querySelectorAll('.memory-content')].some((node) => node.textContent === ${JSON.stringify(persistentText)})) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const list = await window.morrow.memories.list()
    const deletedSearch = await window.morrow.memories.search({ query: ${JSON.stringify(unique)} })
    const persistedSearch = await window.morrow.memories.search({ query: ${JSON.stringify(persistentText)} })
    const goals = await window.morrow.goals.list()
    const reminders = await window.morrow.reminders.getSnapshot()
    const cognitiveSettings = await window.morrow.cognition.getSettings()
    const cognitiveState = await window.morrow.cognition.getFeelingState()
    const cognitiveConversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(smokeConversationId)} })
    const seededMessage = cognitiveConversation.ok
      ? cognitiveConversation.data.messages.find((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)})
      : undefined
    return {
      persistedAfterRestart: list.ok && list.data.length === 1 && list.data[0].currentText === ${JSON.stringify(persistentText)} && persistedSearch.ok && persistedSearch.data.length === 1,
      deletedNotRestored: deletedSearch.ok && deletedSearch.data.length === 0,
      deletedGoalsNotRestored: goals.ok && goals.data.length === 0,
      featureFlagAloneDoesNotOptIn: reminders.ok && reminders.data.featureEnabled && reminders.data.settings.enabled === false &&
        reminders.data.settings.goalReviewEnabled === false && reminders.data.settings.consentStatus === 'never' &&
        reminders.data.reminders.length === 0,
      cognitiveOptInPersisted: cognitiveSettings.ok && cognitiveSettings.data.available && cognitiveSettings.data.enabled &&
        document.querySelector('#cognitive-enabled')?.checked === true && Boolean(cognitiveSettings.data.updatedAt),
      cognitiveStateReplayedAfterRestart: cognitiveState.ok && cognitiveState.data.available &&
        cognitiveState.data.eventCount === 1 && cognitiveState.data.state.revision === 1 &&
        cognitiveState.data.state.sourceEventId !== null && cognitiveState.data.state.values.valence > 0 &&
        cognitiveState.data.recentEvents.at(-1)?.type === 'positive_feedback',
      cognitiveObservationRestored: seededMessage?.role === 'user' && seededMessage.cognitiveObservations?.length === 1 &&
        seededMessage.cognitiveObservations[0]?.analysis.evidence.recordId === seededMessage.id
    }
  })()`)
  if (!restartResult.persistedAfterRestart || !restartResult.deletedNotRestored || !restartResult.deletedGoalsNotRestored ||
    !restartResult.featureFlagAloneDoesNotOptIn || !restartResult.cognitiveOptInPersisted ||
    !restartResult.cognitiveStateReplayedAfterRestart || !restartResult.cognitiveObservationRestored) {
    throw new Error('Persistent storage, M4 opt-in default, or cognitive replay/observation verification failed.')
  }

  stage = 'conversation deletion cascades associated cognitive data'
  const deletionSetup = await activeClient.evaluate(`(async () => {
    const select = document.querySelector('#conversation-select')
    const originalId = ${JSON.stringify(smokeConversationId)}
    const newButton = document.querySelector('#conversation-new')
    if (!(select instanceof HTMLSelectElement) || !(newButton instanceof HTMLButtonElement) || select.value !== originalId) return { created: false }
    newButton.click()
    const deadline = Date.now() + 7000
    while (Date.now() < deadline && (select.value === originalId || select.options.length < 2)) await new Promise((resolve) => setTimeout(resolve, 50))
    return { created: select.options.length === 2 && select.value !== originalId, conversationId: select.value }
  })()`)
  if (!deletionSetup.created || !deletionSetup.conversationId || deletionSetup.conversationId === smokeConversationId) {
    throw new Error('Could not create the isolated conversation-deletion smoke fixture.')
  }
  const deletedConversationSeed = runSeeder('seed', deletionSetup.conversationId, deletedConversationMarker)
  if (deletedConversationSeed.conversationId !== deletionSetup.conversationId || deletedConversationSeed.schemaVersion < 11) {
    throw new Error('The conversation-deletion cognitive fixture did not seed correctly.')
  }
  const conversationDeletion = await activeClient.evaluate(`(async () => {
    const originalId = ${JSON.stringify(smokeConversationId)}
    const deletedId = ${JSON.stringify(deletionSetup.conversationId)}
    const select = document.querySelector('#conversation-select')
    const button = document.querySelector('#conversation-delete')
    if (!(select instanceof HTMLSelectElement) || !(button instanceof HTMLButtonElement)) throw new Error('Conversation deletion controls are unavailable.')
    const stateBefore = await window.morrow.cognition.getFeelingState()
    const conversationBefore = await window.morrow.conversations.read({ conversationId: deletedId })
    let confirmation = ''
    const originalConfirm = window.confirm
    window.confirm = (message) => { confirmation = String(message); return true }
    try {
      button.click()
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !document.querySelector('#chat-feedback')?.textContent?.includes('对话及关联候选已从本地数据库删除')) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const stateAfter = await window.morrow.cognition.getFeelingState()
      const deletedConversation = await window.morrow.conversations.read({ conversationId: deletedId })
      const originalConversation = await window.morrow.conversations.read({ conversationId: originalId })
      const survivingObservation = originalConversation.ok
        ? originalConversation.data.messages.find((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)})
        : undefined
      return {
        confirmationExplainsCascade: confirmation.includes('关联的本地认知观察/感受事件') &&
          confirmation.includes('单独保存的记忆与人格设置不会删除'),
        deletedInUi: document.querySelector('#chat-feedback')?.textContent?.includes('对话及关联候选已从本地数据库删除') === true &&
          select.value === originalId && select.options.length === 1,
        deletedConversationAndMessages: !deletedConversation.ok && deletedConversation.error.code === 'NOT_FOUND' &&
          conversationBefore.ok && conversationBefore.data.messages.length === 3,
        cognitiveEventCascadeAndReplay: stateBefore.ok && stateBefore.data.eventCount === 2 && stateBefore.data.state.revision === 2 &&
          stateAfter.ok && stateAfter.data.eventCount === 1 && stateAfter.data.state.revision === 1 &&
          stateAfter.data.state.sourceEventId !== null && stateAfter.data.state.values.valence > 0,
        originalConversationAndObservationRetained: originalConversation.ok && originalConversation.data.messages.length === 3 &&
          survivingObservation?.cognitiveObservations?.length === 1
      }
    } finally {
      window.confirm = originalConfirm
    }
  })()`)
  if (!conversationDeletion.confirmationExplainsCascade || !conversationDeletion.deletedInUi ||
    !conversationDeletion.deletedConversationAndMessages || !conversationDeletion.cognitiveEventCascadeAndReplay ||
    !conversationDeletion.originalConversationAndObservationRetained) {
    throw new Error('Conversation deletion did not explain and verify the cognitive-data cascade.')
  }

  stage = 'disable cognition through the UI and verify no new state writes'
  const disabledCognition = await activeClient.evaluate(`(async () => {
    const toggle = document.querySelector('#cognitive-enabled')
    const form = document.querySelector('#cognitive-settings-form')
    if (!(toggle instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('Cognitive settings controls are unavailable.')
    toggle.checked = false
    form.requestSubmit()
    const deadline = Date.now() + 7000
    let settings
    while (Date.now() < deadline) {
      settings = await window.morrow.cognition.getSettings()
      if (settings?.ok && !settings.data.enabled && document.querySelector('#chat-feedback')?.textContent?.includes('本地认知辅助已关闭')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const state = await window.morrow.cognition.getFeelingState()
    const conversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(smokeConversationId)} })
    const source = conversation.ok ? conversation.data.messages.find((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)}) : undefined
    return {
      disabledPersisted: settings?.ok === true && !settings.data.enabled && Boolean(settings.data.updatedAt) && toggle.checked === false,
      stateUnchanged: state.ok && state.data.eventCount === 1 && state.data.state.revision === 1 && state.data.state.values.valence > 0,
      existingEvidenceRetained: source?.cognitiveObservations?.length === 1
    }
  })()`)
  if (!disabledCognition.disabledPersisted || !disabledCognition.stateUnchanged || !disabledCognition.existingEvidenceRetained) {
    throw new Error('Disabling cognition did not preserve existing data or persist the off setting.')
  }

  stage = 'failed cognitive clear reports error and rolls back'
  runSeeder('inject-clear-failure')
  const failedClear = await activeClient.evaluate(`(async () => {
    const button = document.querySelector('#cognitive-clear')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Cognitive clear control is unavailable.')
    let confirmation = ''
    const originalConfirm = window.confirm
    window.confirm = (message) => { confirmation = String(message); return true }
    try {
      button.click()
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !document.querySelector('#chat-feedback')?.textContent?.includes('本地数据暂不可用，请重试')) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const state = await window.morrow.cognition.getFeelingState()
      const conversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(smokeConversationId)} })
      const source = conversation.ok ? conversation.data.messages.find((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)}) : undefined
      return {
        confirmationExplainsRetainedData: confirmation.includes('对话、已保存记忆与人格设置不会删除') &&
          confirmation.includes('若认知功能仍启用，之后的对话可能重新产生认知记录'),
        safeErrorShown: document.querySelector('#chat-feedback')?.textContent === '本地数据暂不可用，请重试。',
        successNotShown: !document.querySelector('#chat-feedback')?.textContent?.includes('认知观察与感受历史已清空'),
        rollbackRetainedEvidence: state.ok && state.data.eventCount === 1 && state.data.state.revision === 1 &&
          state.data.state.values.valence > 0 && source?.cognitiveObservations?.length === 1
      }
    } finally {
      window.confirm = originalConfirm
    }
  })()`)
  if (!failedClear.confirmationExplainsRetainedData || !failedClear.safeErrorShown ||
    !failedClear.successNotShown || !failedClear.rollbackRetainedEvidence) {
    throw new Error('A failed cognitive clear was reported as successful or lost data.')
  }
  runSeeder('drop-clear-failure')

  stage = 'successful cognitive clear preserves conversation, memory, and personality'
  const clearedCognition = await activeClient.evaluate(`(async () => {
    const button = document.querySelector('#cognitive-clear')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Cognitive clear control is unavailable.')
    let confirmation = ''
    const originalConfirm = window.confirm
    window.confirm = (message) => { confirmation = String(message); return true }
    try {
      button.click()
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !document.querySelector('#chat-feedback')?.textContent?.includes('认知观察与感受历史已清空')) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const settings = await window.morrow.cognition.getSettings()
      const state = await window.morrow.cognition.getFeelingState()
      const conversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(smokeConversationId)} })
      const memories = await window.morrow.memories.list()
      const personality = await window.morrow.personality.get()
      return {
        confirmationExplainsClearScope: confirmation.includes('对话、已保存记忆与人格设置不会删除') &&
          confirmation.includes('若认知功能仍启用，之后的对话可能重新产生认知记录'),
        successShown: document.querySelector('#chat-feedback')?.textContent?.includes('认知观察与感受历史已清空') === true,
        disabledSettingPreserved: settings.ok && !settings.data.enabled && Boolean(settings.data.updatedAt),
        emptyBaseline: state.ok && state.data.eventCount === 0 && state.data.recentEvents.length === 0 &&
          state.data.state.revision === 0 && state.data.state.sourceEventId === null &&
          Object.values(state.data.state.values).every((value) => value === 0) &&
          state.data.state.attention.explorationPriority === 0 && state.data.state.attention.evidenceRefs.length === 0,
        conversationAndMessagesRetained: conversation.ok && conversation.data.messages.length === 3 &&
          conversation.data.messages.some((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)}) &&
          conversation.data.messages.every((message) => !message.cognitiveObservations?.length),
        memoryRetained: memories.ok && memories.data.length === 1 && memories.data[0].currentText === ${JSON.stringify(persistentText)},
        personalityRetained: personality.ok && personality.data.version === 2 && personality.data.systemRules === ${JSON.stringify(personalityMarker)}
      }
    } finally {
      window.confirm = originalConfirm
    }
  })()`)
  if (!clearedCognition.confirmationExplainsClearScope || !clearedCognition.successShown ||
    !clearedCognition.disabledSettingPreserved || !clearedCognition.emptyBaseline ||
    !clearedCognition.conversationAndMessagesRetained || !clearedCognition.memoryRetained || !clearedCognition.personalityRetained) {
    throw new Error('Cognitive history clear did not preserve the explicit user data boundary.')
  }

  stage = 'M4 explicit consent, immediate pause, and consent withdrawal'
  const reminderLifecycle = await activeClient.evaluate(`(async () => {
    const initial = await window.morrow.reminders.getSnapshot()
    if (!initial?.ok) throw new Error('Reminder snapshot IPC failed after restart.')
    const status = document.querySelector('#reminder-status')
    const enabled = document.querySelector('#reminders-enabled')
    const type = document.querySelector('#goal-review-enabled')
    const consent = document.querySelector('#reminders-consent')
    const form = document.querySelector('#reminder-settings-form')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (
      status?.textContent?.includes('正在读取') || !document.querySelector('#reminders-max-per-day')?.value ||
      !document.querySelector('#reminders-time-zone')?.value
    )) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!initial.data.featureEnabled) return { featureEnabled: false }
    if (!initial.data.notificationSupported) {
      return {
        featureEnabled: true,
        notificationSupported: false,
        unsupportedExplained: status?.textContent?.includes('不支持') === true,
        controlsLocked: enabled?.disabled === true && type?.disabled === true
      }
    }
    if (!enabled || !type || !consent || !form?.checkValidity() || enabled.disabled || type.disabled) {
      return { featureEnabled: true, notificationSupported: true, formReady: false }
    }
    enabled.checked = true
    type.checked = true
    consent.checked = true
    form.requestSubmit()
    const readSnapshot = async (predicate) => {
      const until = Date.now() + 5000
      let result
      while (Date.now() < until) {
        result = await window.morrow.reminders.getSnapshot()
        if (result?.ok && predicate(result.data)) return result.data
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return result?.ok ? result.data : undefined
    }
    const activated = await readSnapshot((value) => value.settings.enabled && value.settings.consentStatus === 'active')
    if (!activated) return { featureEnabled: true, notificationSupported: true, formReady: true, enabledByExplicitConsent: false }
    document.querySelector('#pause-reminders')?.click()
    const paused = await readSnapshot((value) => !value.settings.enabled)
    const pauseImmediate = !!paused && paused.settings.consentStatus === 'active' && paused.reminders.length === 0
    window.confirm = () => true
    document.querySelector('#withdraw-reminder-consent')?.click()
    const withdrawn = await readSnapshot((value) => value.settings.consentStatus === 'withdrawn')
    return {
      featureEnabled: true,
      notificationSupported: true,
      formReady: true,
      enabledByExplicitConsent: true,
      pauseImmediate,
      consentWithdrawn: !!withdrawn && !withdrawn.settings.enabled && !!withdrawn.settings.revokedAt,
      noPendingAfterWithdrawal: !!withdrawn && withdrawn.reminders.length === 0
    }
  })()`)
  if (!reminderLifecycle.featureEnabled) throw new Error('M4 release feature flag did not reach the opt-in test launch.')
  if (reminderLifecycle.notificationSupported) {
    if (!reminderLifecycle.formReady || !reminderLifecycle.enabledByExplicitConsent || !reminderLifecycle.pauseImmediate ||
      !reminderLifecycle.consentWithdrawn || !reminderLifecycle.noPendingAfterWithdrawal) {
      throw new Error('M4 explicit opt-in, immediate pause, or consent withdrawal failed.')
    }
  } else if (!reminderLifecycle.unsupportedExplained || !reminderLifecycle.controlsLocked) {
    throw new Error('M4 did not clearly disable reminders when native notifications are unavailable.')
  }

  await activeClient.evaluate('window.close()').catch(() => undefined)
  await Promise.race([activeRun.exited, delay(10000)])
  if (activeRun.child.exitCode === null) throw new Error('Built application did not close cleanly after reminder opt-out.')
  await stop(activeRun, activeClient)
  activeRun = undefined
  activeClient = undefined

  stage = 'M4 consent state after restarting with the feature flag off'
  const third = await start()
  activeRun = third.run
  activeClient = third.client
  const reminderAfterRestart = await activeClient.evaluate(`(async () => {
    const result = await window.morrow.reminders.getSnapshot()
    const settings = await window.morrow.cognition.getSettings()
    const feeling = await window.morrow.cognition.getFeelingState()
    const conversation = await window.morrow.conversations.read({ conversationId: ${JSON.stringify(smokeConversationId)} })
    const memories = await window.morrow.memories.list()
    const personality = await window.morrow.personality.get()
    const provider = await window.morrow.providers.get()
    if (!result?.ok || !settings?.ok || !feeling?.ok || !conversation?.ok || !memories?.ok || !personality?.ok || !provider?.ok) {
      throw new Error('Final restart persistence IPC failed.')
    }
    const messages = conversation.data.messages
    return {
      featureDisabled: result.data.featureEnabled === false,
      disabled: result.data.settings.enabled === false && result.data.settings.goalReviewEnabled === false,
      consentStatus: result.data.settings.consentStatus,
      noPending: result.data.reminders.length === 0,
      cognitionDisabledPersisted: settings.data.available && !settings.data.enabled && Boolean(settings.data.updatedAt) &&
        document.querySelector('#cognitive-enabled')?.checked === false,
      cognitionClearPersisted: feeling.data.available && feeling.data.eventCount === 0 && feeling.data.recentEvents.length === 0 &&
        feeling.data.state.revision === 0 && feeling.data.state.sourceEventId === null &&
        Object.values(feeling.data.state.values).every((value) => value === 0) &&
        feeling.data.state.attention.explorationPriority === 0 && feeling.data.state.attention.evidenceRefs.length === 0,
      conversationAndMessagesRetained: messages.length === 3 && messages.some((message) => message.body === ${JSON.stringify(seededCognitiveTurn.userText)}) &&
        messages.every((message) => !message.cognitiveObservations?.length),
      memoryRetained: memories.data.length === 1 && memories.data[0].currentText === ${JSON.stringify(persistentText)},
      personalityRetained: personality.data.version === 2 && personality.data.systemRules === ${JSON.stringify(personalityMarker)},
      providerUnconfigured: provider.data === null
    }
  })()`)
  const expectedConsentStatus = reminderLifecycle.notificationSupported ? 'withdrawn' : 'never'
  if (!reminderAfterRestart.featureDisabled || !reminderAfterRestart.disabled || !reminderAfterRestart.noPending ||
    reminderAfterRestart.consentStatus !== expectedConsentStatus || !reminderAfterRestart.cognitionDisabledPersisted ||
    !reminderAfterRestart.cognitionClearPersisted || !reminderAfterRestart.conversationAndMessagesRetained ||
    !reminderAfterRestart.memoryRetained || !reminderAfterRestart.personalityRetained || !reminderAfterRestart.providerUnconfigured) {
    throw new Error('M4 opt-out, cognitive-clear, or retained user data did not persist after the final restart.')
  }

  stage = 'M5 secure Provider credential save, restart persistence, and explicit deletion without network access'
  const providerStorage = await verifyProviderCredentialStorage(activeRun, activeClient)
  activeRun = undefined
  activeClient = undefined
  console.log(`Morrow smoke passed: ${installedExecutable ? 'installed Windows app' : 'built Electron app'}, default-off DeepSeek configuration, secure credential save/restart/delete (${providerStorage.storage}, no Provider requests), cognitive default-off/explicit opt-in and restart persistence, no fabricated reply, M1 memory lifecycle, M2 goal and approval safety, M4 reminder controls, local persistence, deletion, and restart verification.`)
} catch (error) {
  console.error(`Morrow smoke failed during ${stage}: ${error instanceof Error ? error.message : 'Unknown error'}.`)
  process.exitCode = 1
} finally {
  if (activeRun) await stop(activeRun, activeClient)
  if (!externalProfile) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
}
