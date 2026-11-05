/**
 * Product shell atmosphere: a small orbital presence canvas, view mastheads,
 * settings index and the light/dark theme switch. The data views themselves
 * remain the existing DOM and IPC paths; this module only adds presentation.
 */

interface Node3D {
  x: number
  y: number
  z: number
}

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function createPresence(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d')
  if (!context) return () => undefined
  const nodes: Node3D[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  const count = 150
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * index
    nodes.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  let rotation = 0.4
  let frame = 0
  let visible = true
  let dragging = false
  let lastX = 0

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const box = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(box.width * ratio))
    canvas.height = Math.max(1, Math.round(box.height * ratio))
    if (reducedMotion()) draw()
  }

  const draw = (): void => {
    const width = canvas.width
    const height = canvas.height
    if (width === 0 || height === 0) return
    const styles = getComputedStyle(document.documentElement)
    const ink = styles.getPropertyValue('--ink').trim() || '#edf3ff'
    const accent = styles.getPropertyValue('--accent').trim() || '#7be7ff'
    const accent2 = styles.getPropertyValue('--accent-2').trim() || '#a78bfa'
    const muted = styles.getPropertyValue('--muted').trim() || '#8595ae'
    context.clearRect(0, 0, width, height)
    const cx = width * 0.5
    const cy = height * 0.52
    const scale = Math.min(width, height) * 0.36
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const projected = nodes.map((node) => {
      const x = node.x * cos - node.z * sin
      const z = node.x * sin + node.z * cos
      const perspective = 1 / (1.7 - z * 0.5)
      return { x: cx + x * scale * perspective, y: cy + node.y * scale * perspective, z, perspective }
    })
    context.lineWidth = Math.max(0.6, width / 1400)
    for (let a = 0; a < projected.length; a += 1) {
      for (let b = a + 1; b < projected.length; b += 1) {
        const first = projected[a]!
        const second = projected[b]!
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        if (distance > scale * 0.18) continue
        const alpha = (1 - distance / (scale * 0.18)) * 0.14 * Math.min(first.perspective, second.perspective)
        context.strokeStyle = `${accent}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
        context.beginPath()
        context.moveTo(first.x, first.y)
        context.lineTo(second.x, second.y)
        context.stroke()
      }
    }
    for (const node of projected) {
      const size = Math.max(0.7, 1.8 * node.perspective)
      context.beginPath()
      context.arc(node.x, node.y, size, 0, Math.PI * 2)
      context.fillStyle = node.z > 0.45 ? accent2 : node.z < -0.35 ? muted : ink
      context.globalAlpha = 0.35 + (node.z + 1) * 0.28
      context.fill()
      context.globalAlpha = 1
    }
    context.strokeStyle = `${accent}33`
    context.lineWidth = 1
    context.beginPath()
    context.ellipse(cx, cy, scale * 1.18, scale * 0.34, -0.18, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.ellipse(cx, cy, scale * 0.78, scale * 1.05, 0.35, 0, Math.PI * 2)
    context.strokeStyle = `${accent2}26`
    context.stroke()
  }

  const loop = (): void => {
    if (!visible) {
      frame = 0
      return
    }
    if (reducedMotion()) {
      draw()
      frame = 0
      return
    }
    if (!dragging) rotation += 0.0022
    draw()
    frame = requestAnimationFrame(loop)
  }

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true
    lastX = event.clientX
    canvas.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    rotation += (event.clientX - lastX) * 0.008
    lastX = event.clientX
    if (reducedMotion()) draw()
  }
  const onPointerUp = (): void => { dragging = false }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        if (visible && frame === 0) loop()
      }, { threshold: 0.05 })
    : null
  observer?.observe(canvas)
  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null
  resizeObserver?.observe(canvas)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  resize()
  loop()
  return () => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
    resizeObserver?.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
  }
}

function buildPresenceHero(): void {
  const chatView = document.querySelector<HTMLElement>('.view[data-view="chat"]')
  if (!chatView || chatView.querySelector('.presence-hero')) return
  const hero = document.createElement('section')
  hero.className = 'presence-hero'
  hero.innerHTML = `
    <div class="presence-copy">
      <p class="eyebrow"><span class="tick"></span>MORROW · LOCAL COMPANION</p>
      <h1>把对话，<br><span class="outline">留在本机</span><span class="lime">.</span></h1>
      <p class="presence-lead">一个会记得你、也会承认不确定的伴侣。人格、记忆与关系都保存在这台电脑；每次云端发送都由你逐次确认。</p>
      <div class="presence-tags">
        <span>本机优先</span><span>逐次授权</span><span>可追溯</span><span>可撤回</span>
      </div>
    </div>
    <div class="presence-art" aria-hidden="true">
      <canvas id="presence-canvas" class="presence-canvas"></canvas>
      <span class="presence-label label-a">MEMORY</span>
      <span class="presence-label label-b">PERSONALITY</span>
      <span class="presence-label label-c">RELATIONSHIP</span>
      <span class="presence-note">DRAG TO ORBIT</span>
    </div>`
  chatView.prepend(hero)
  const canvas = hero.querySelector<HTMLCanvasElement>('#presence-canvas')
  if (canvas) createPresence(canvas)
}

function buildMastheads(): void {
  const specs: Array<{ view: string; index: string; title: string; description: string }> = [
    { view: 'memory', index: '02 / MEMORY', title: '记忆不是聊天记录', description: '每条记忆都有来源、敏感级与修订链。你决定什么留下，也决定什么被撤回。' },
    { view: 'goals', index: '03 / AGENCY', title: '目标需要你的授权', description: '候选、目标、计划与执行分开确认。Morrow 不会替你决定，也不会偷偷执行。' },
    { view: 'settings', index: '04 / CONTROL', title: '把连接与边界放在桌面上', description: 'Provider、认知计算与本地备份都在这里；所有密钥只进入 OS 安全存储。' }
  ]
  for (const spec of specs) {
    const view = document.querySelector<HTMLElement>(`.view[data-view="${spec.view}"]`)
    if (!view || view.querySelector('.view-masthead')) continue
    const header = document.createElement('header')
    header.className = 'view-masthead'
    header.innerHTML = `<p class="eyebrow">${spec.index}</p><h1>${spec.title}</h1><p>${spec.description}</p>`
    view.prepend(header)
  }
}

function buildSettingsIndex(): void {
  const settings = document.querySelector<HTMLElement>('.view[data-view="settings"]')
  if (!settings || settings.querySelector('.settings-index')) return
  const index = document.createElement('nav')
  index.className = 'settings-index'
  index.setAttribute('aria-label', '设置分区')
  const links = [
    ['#provider-profiles-card', '模型接入'],
    ['#provider-card', '官方连接'],
    ['#local-provider-card', '本地模型'],
    ['#cognitive-settings-form', '认知计算'],
    ['#backup-section', '备份恢复']
  ]
  for (const [href, label] of links as Array<[string, string]>) {
    const link = document.createElement('a')
    link.href = href
    link.textContent = label
    index.append(link)
  }
  const masthead = settings.querySelector(".view-masthead")
  if (masthead) masthead.after(index)
  else settings.prepend(index)
}

function buildThemeToggle(): void {
  const foot = document.querySelector<HTMLElement>('.sidebar-foot')
  if (!foot || foot.querySelector('#theme-toggle')) return
  const stored = localStorage.getItem('morrow-theme')
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'theme-toggle'
  button.className = 'theme-toggle'
  const paint = (): void => {
    const light = document.documentElement.dataset.theme === 'light'
    button.textContent = light ? '深空主题' : '纸面主题'
    button.setAttribute('aria-label', light ? '切换到深空主题' : '切换到纸面主题')
  }
  button.addEventListener('click', () => {
    const light = document.documentElement.dataset.theme === 'light'
    document.documentElement.dataset.theme = light ? 'dark' : 'light'
    localStorage.setItem('morrow-theme', document.documentElement.dataset.theme)
    paint()
  })
  foot.prepend(button)
  paint()
}

function indexNavigation(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item[data-view]').forEach((button, index) => {
    if (button.querySelector('.nav-index')) return
    const marker = document.createElement('span')
    marker.className = 'nav-index'
    marker.textContent = String(index + 1).padStart(2, '0')
    button.prepend(marker)
  })
}

export function initializePresence(): void {
  buildPresenceHero()
  buildMastheads()
  buildSettingsIndex()
  buildThemeToggle()
  indexNavigation()
}
