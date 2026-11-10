/**
 * Issue #74 P0: drive the real chat UI -> preload -> IPC -> ChatService ->
 * loopback SSE Provider and verify the rendered reply and persisted messages.
 * Acceptance only. The product still shows the native consent dialog; this
 * script enables MORROW_ACCEPTANCE_AUTO_CONSENT to make the smoke unattended.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const electron = process.env.MORROW_SMOKE_EXE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const packaged = Boolean(process.env.MORROW_SMOKE_EXE)
const appEntry = join(root, 'out', 'main', 'index.js')
const profile = process.env.MORROW_SMOKE_PROFILE || join(root, '.tmp', 'chat-ui-smoke-profile')
const reportPath = process.env.MORROW_SMOKE_REPORT || join(root, '.tmp', 'chat-ui-smoke-result.json')
if (!existsSync(electron) || (!packaged && !existsSync(appEntry))) throw new Error('Run npm run build first.')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createTcpServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => typeof address === 'object' && address ? resolvePort(address.port) : rejectPort(new Error('no port')))
    })
  })
}

async function startLoopback(port) {
  const requests = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push({ url: request.url, body: raw })
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      for (const piece of ['UI ', 'stream ', 'reply']) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      }
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen))
  return { server, requests }
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }

async function connect(port) {
  const deadline = Date.now() + 30000
  let page
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) break
      }
    } catch {}
    await delay(200)
  }
  if (!page) throw new Error('Renderer DevTools endpoint unavailable.')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error('CDP command failed.'))
    else request.resolve(message.result)
  })
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connection failed.')), { once: true })
  })
  return {
    evaluate(expression) {
      return new Promise((resolveResult, rejectResult) => {
        const id = ++nextId
        pending.set(id, { resolve: resolveResult, reject: rejectResult })
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      }).then((result) => {
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed.')
        return result.result?.value
      })
    },
    close() { socket.close() }
  }
}

const port = await freePort()
const debugPort = await freePort()
const loopback = await startLoopback(port)
const child = spawn(electron, [
  `--remote-debugging-port=${debugPort}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900',
  '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--no-sandbox',
  ...(packaged ? [] : [root])
], {
  cwd: root,
  env: {
    ...process.env,
    MORROW_SMOKE_DISABLE_SANDBOX: '1',
    MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX: '1',
    MORROW_ACCEPTANCE_AUTO_CONSENT: packaged ? '0' : '1'
  },
  stdio: ['ignore', 'ignore', 'pipe']
})
let stderr = ''
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) })
const result = { status: 'FAILED', checks: [] }
try {
  let client = await connect(debugPort)
  await client.evaluate(`new Promise((resolve) => { const start=Date.now(); const timer=setInterval(() => { if (document.body?.dataset.providerUiReady === 'true' || Date.now()-start > 20000) { clearInterval(timer); resolve(true) } }, 100) })`)
  const saved = await client.evaluate(`(async () => {
    const saved = await window.morrow.providers.save({
      providerId: 'local-openai',
      endpoint: ${JSON.stringify(`http://127.0.0.1:${port}/v1`)},
      model: 'ui-loopback',
      enabled: true
    })
    if (!saved.ok) return { ok: false, error: saved.error }
    return { ok: true }
  })()`)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  // The renderer re-reads provider state on load; reload and reconnect the
  // DevTools socket instead of reusing a socket the navigation destroys.
  try {
    await client.evaluate(`(() => { setTimeout(() => location.reload(), 0); return true })()`)
  } catch {}
  client.close()
  await delay(1500)
  client = await connect(debugPort)
  await client.evaluate(`new Promise((resolve) => { const start=Date.now(); const timer=setInterval(() => { if (document.body?.dataset.providerUiReady === 'true' || Date.now()-start > 20000) { clearInterval(timer); resolve(true) } }, 100) })`)
  const sent = await client.evaluate(`(async () => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline && document.querySelector('#chat-send')?.disabled) await new Promise((resolve) => setTimeout(resolve, 100))
    document.querySelector('[data-testid="nav-chat"]').click()
    const textarea = document.querySelector('[data-testid="chat-content"]')
    textarea.value = 'UI smoke message'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#chat-form').requestSubmit()
    const profiles = await window.morrow.providers.listProfiles()
    return { disabled: document.querySelector('#chat-send')?.disabled ?? null, chatState: document.querySelector('#chat-state')?.textContent, providerStatus: document.querySelector('#status-provider')?.textContent, profiles: profiles.ok ? profiles.data.map((p) => ({ id: p.id, enabled: p.enabled, sourceKind: p.sourceKind, isDefault: p.isDefault })) : profiles }
  })()`)
  assert.equal(sent.providerStatus, 'Local OpenAI · 已就绪', 'chat provider must be ready: ' + JSON.stringify(sent))
  let rendered = ''
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    rendered = await client.evaluate(`document.querySelector('#chat-messages')?.textContent ?? ''`)
    const chatState = await client.evaluate(`document.querySelector('#chat-state')?.textContent ?? ''`)
    if (rendered.includes('UI smoke message') && rendered.includes('UI stream reply') && chatState.includes('已完整保存')) break
    await delay(300)
  }
  assert.ok(rendered.includes('UI smoke message'), `user message not rendered: ${rendered.slice(-400)}`)
  assert.ok(rendered.includes('UI stream reply'), `assistant reply not rendered: ${rendered.slice(-400)}`)
  const persisted = await client.evaluate(`(async () => {
    const list = await window.morrow.conversations.list()
    if (!list.ok || !list.data[0]) return { ok: false }
    const read = await window.morrow.conversations.read({ conversationId: list.data[0].id })
    if (!read.ok) return { ok: false }
    return { ok: true, messages: read.data.messages.map((message) => ({ role: message.role, body: message.body })) }
  })()`)
  assert.equal(persisted.ok, true)
  assert.ok(persisted.messages.some((message) => message.role === 'user' && message.body === 'UI smoke message'))
  assert.ok(persisted.messages.some((message) => message.role === 'assistant' && message.body.includes('UI stream reply')))
  assert.equal(loopback.requests.length, 1)
  result.status = 'PASS'
  result.stderrTail = stderr.slice(-4000)
  result.checks.push('renderer input -> submit -> streamed assistant reply -> persisted conversation')
  result.requests = loopback.requests.length
  result.messages = persisted.messages.map((message) => message.role)
  client.close()
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error)
  result.stderr = stderr
} finally {
  child.kill()
  loopback.server.close()
  writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result))
  if (result.status !== 'PASS') process.exitCode = 1
}
