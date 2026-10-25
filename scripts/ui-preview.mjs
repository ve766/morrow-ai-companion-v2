// Drives the built Electron application through its real renderer UI over the
// DevTools protocol and captures PNG screenshots of the user-visible panels.
//
// The app runs against an isolated profile (redirected APPDATA/USERPROFILE),
// all data is synthetic, and nothing leaves the machine: no provider is
// configured, no network request is possible. Output: docs/screenshots/*.png
// plus docs/screenshots/index.html.
//
// Usage: node scripts/ui-preview.mjs [electronBinary] [appRoot]

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const electronBinary = process.argv[2] ?? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const appRoot = process.argv[3] ?? root
const outputDirectory = join(root, 'docs', 'screenshots')

const profile = mkdtempSync(join(tmpdir(), 'morrow-ui-preview-'))
const appData = join(profile, 'AppData', 'Roaming')
mkdirSync(appData, { recursive: true })

const environment = {
  ...process.env,
  APPDATA: appData,
  LOCALAPPDATA: join(profile, 'AppData', 'Local'),
  USERPROFILE: profile,
  HOME: profile,
}
delete environment.ELECTRON_RENDERER_URL
for (const key of Object.keys(environment)) {
  if (/^(ZO_|.*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION))/i.test(key)) delete environment[key]
}

const port = 13000 + Math.floor(Math.random() * 20000)
const child = spawn(electronBinary, ['.', `--remote-debugging-port=${port}`, '--no-first-run', '--disable-gpu'], {
  cwd: appRoot,
  env: environment,
  stdio: 'ignore'
})

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function findPage() {
  const deadline = Date.now() + 30000
  let lastError = 'DevTools endpoint did not become available.'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited during launch (${child.exitCode}).`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page.webSocketDebuggerUrl
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(`Could not attach to the renderer: ${lastError}`)
}

function connectDebugger(url) {
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
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  return new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error('DevTools websocket timed out.')), 10000)
    socket.addEventListener('open', () => {
      clearTimeout(timeout)
      resolveOpen({
        async send(method, params = {}) {
          const id = ++nextId
          const result = await new Promise((resolveResult, rejectResult) => {
            const requestTimeout = setTimeout(() => {
              pending.delete(id)
              rejectResult(new Error(`CDP ${method} timed out.`))
            }, 20000)
            pending.set(id, { resolve: resolveResult, reject: rejectResult, timeout: requestTimeout })
            socket.send(JSON.stringify({ id, method, params }))
          })
          return result
        },
        async evaluate(expression) {
          const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (result.exceptionDetails) {
            const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Renderer evaluation failed.'
            throw new Error(detail)
          }
          return result.result?.value
        },
        async screenshot(path, clip) {
          const params = { format: 'png', captureBeyondViewport: true }
          if (clip) params.clip = { ...clip, scale: 2 }
          const data = await this.send('Page.captureScreenshot', params)
          writeFileSync(path, Buffer.from(data.data, 'base64'))
        },
        close() {
          if (socket.readyState === WebSocket.OPEN) socket.close()
        }
      })
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      rejectOpen(new Error('DevTools websocket failed.'))
    }, { once: true })
  })
}

async function elementClip(client, selector) {
  const box = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height }
  })()`)
  return box
}

async function screenshotPanel(client, name, selector) {
  const clip = await elementClip(client, selector)
  if (!clip || clip.width === 0) {
    console.error(`[ui-preview] panel not visible: ${selector}`)
    return
  }
  await client.screenshot(join(outputDirectory, `${name}.png`), clip)
  console.log(`[ui-preview] captured ${name}.png`)
}

let client
try {
  mkdirSync(outputDirectory, { recursive: true })
  const page = await findPage()
  client = await connectDebugger(page)
  await client.send('Page.enable')
  await client.send('Runtime.enable')

  // The window opens hidden until ready-to-show; bring it up and size it.
  await client.evaluate('document.readyState')
  await delay(1500)

  const diagnostics = await client.evaluate(`(async () => {
    const href = location.href
    const hasBridge = typeof window.morrow === 'object'
    let listResult = 'skipped'
    try {
      const r = await window.morrow.memories.list()
      listResult = JSON.stringify(r).slice(0, 120)
    } catch (error) { listResult = 'threw ' + error.message }
    const runtimeStatus = document.querySelector('#runtime-status')?.textContent ?? 'missing'
    const feedback = document.querySelector('#feedback')
    const pageOwnState = { runtimeStatus, feedbackVisible: feedback ? !feedback.hidden : null, feedbackText: feedback?.textContent.slice(0, 80) ?? '' }
    const memoryCount = document.querySelectorAll('#memory-list .memory-card').length
    return { href, hasBridge, listResult, pageOwnState, memoryCount }
  })()`)
  console.log('[ui-preview] diagnostics:', JSON.stringify(diagnostics))

  // Seed a realistic, fully local memory lifecycle through the real bridge so
  // the timeline shows genuine persisted data (created → corrected → retracted
  // → explicitly restored), then drive the real refresh control.
  await client.evaluate(`(async () => {
    const unwrap = (result) => { if (!result.ok) throw new Error(result.error.code); return result.data }
    const first = unwrap(await window.morrow.memories.create({ content: '用户偏好在总结里先给结论，再给依据。', sensitivity: 'personal' }))
    unwrap(await window.morrow.memories.correct({ id: first.id, content: '用户偏好：先给结论，再给依据，并标注不确定的部分。' }))
    unwrap(await window.morrow.memories.revoke({ id: first.id }))
    unwrap(await window.morrow.memories.restore({ id: first.id }))
    unwrap(await window.morrow.memories.create({ content: '项目里的关键里程碑日期需要与用户逐条确认。', sensitivity: 'sensitive' }))
    return true
  })()`)

  // A goal with its audit evidence (goal_created) through the real service.
  await client.evaluate(`(async () => {
    const unwrap = (result) => { if (!result.ok) throw new Error(result.error.code); return result.data }
    unwrap(await window.morrow.goals.create({
      intent: '核对本机当前有效记忆数量',
      successCriterion: 'active_memory_count_matches_database',
      constraints: '只读取当前有效记忆数量，不修改或删除数据，不访问网络。',
      acceptedBoundary: true
    }))
    return true
  })()`)

  // Drive the real UI refresh controls.
  await client.evaluate(`(() => {
    document.querySelector('#refresh-memories')?.click()
    document.querySelector('#refresh-goals')?.click()
    return true
  })()`)
  await delay(1200)

  // Expand one memory's revision timeline through its real button.
  await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('#memory-list button')]
    const lineage = buttons.find((button) => button.textContent.includes('修订谱系'))
    lineage?.click()
    return Boolean(lineage)
  })()`)
  await delay(400)

  // Chat: send a message without a provider so the honest offline state shows.
  await client.evaluate(`(() => {
    const input = document.querySelector('#chat-content')
    const form = document.querySelector('#chat-form')
    if (input && form) {
      input.value = '帮我总结今天的进展'
      form.requestSubmit()
    }
    return Boolean(input && form)
  })()`)
  await delay(1500)

  // Capture panels.
  async function captureView(name, view, selector) {
    await client.evaluate(`(() => {
      const button = document.querySelector('.nav-item[data-view="${view}"]')
      button?.click()
      return Boolean(button)
    })()`)
    await delay(400)
    await screenshotPanel(client, name, selector)
  }

  await client.evaluate(`(() => {
    document.querySelector('.nav-item[data-view="chat"]')?.click()
    return true
  })()`)
  await delay(400)
  await client.screenshot(join(outputDirectory, '01-chat-home.png'))
  console.log('[ui-preview] captured 01-chat-home.png')
  await screenshotPanel(client, '02-chat-panel', '.view[data-view="chat"]')
  await captureView('03-memory-view', 'memory', '#memory-view')
  await captureView('04-goals-view', 'goals', '#goals-view')
  await captureView('05-settings-view', 'settings', '#settings-view')

  // Simple gallery.
  const panels = [
    ['01-chat-home.png', '首页即对话：启动后直接进入聊天视图，左侧导航切换'],
    ['02-chat-panel.png', '对话视图：本地对话、逐次授权发送、记忆候选审阅、沟通风格；Provider 配置已移至“设置”'],
    ['03-memory-view.png', '记忆与来源：显式保存 + 审阅列表（来源/修订谱系/撤销/恢复/删除）'],
    ['04-goals-view.png', '目标与提醒：授权流程 + 进度证据账本 + 默认关闭的本地提醒'],
    ['05-settings-view.png', '设置与备份：Provider 密钥（仅安全存储）、认知开关（默认关）、本地备份/恢复']
  ]
  const gallery = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Morrow UI 预览（实际构建）</title>
<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1c1c1c}
h1{font-size:20px}li{margin:18px 0}img{max-width:100%;border:1px solid #ccc;border-radius:8px}
.note{background:#f6f6f6;border-left:4px solid #888;padding:10px 14px;font-size:14px}</style></head>
<body><h1>Morrow UI 预览 — 来自实际构建的桌面应用</h1>
<p class="note">截图由 <code>scripts/ui-preview.mjs</code> 驱动真实 Electron 构建（隔离 profile、合成数据、未配置 Provider、零网络）生成。
对话为本地离线状态截图；Provider 授权对话框与备份文件选择对话框为系统原生弹窗，无法在此自动驱动，列为人工验收。</p>
<ul>${panels.map(([file, label]) => `<li><div>${label}</div><img src="${file}" alt="${label}"></li>`).join('\n')}</ul>
</body></html>`
  writeFileSync(join(outputDirectory, 'index.html'), gallery)
  console.log('[ui-preview] wrote docs/screenshots/index.html')

  await client.evaluate('window.close()')
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(8000)])
  if (child.exitCode === null) child.kill()
} catch (error) {
  console.error(`[ui-preview] failed: ${error instanceof Error ? error.message : String(error)}`)
  if (client) try { client.close() } catch { /* already closed */ }
  if (child.exitCode === null) child.kill()
  process.exitCode = 1
} finally {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* best effort */ }
}
