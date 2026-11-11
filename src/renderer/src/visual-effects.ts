/**
 * Interface-museum visual effects. These are presentation-only: the selected
 * effect is stored in localStorage and never changes IPC, data or consent.
 */
const EFFECTS = ['none', 'perspective', 'holo', 'brutal', 'collage', 'plasma'] as const
type Effect = typeof EFFECTS[number]
const LABELS: Record<Effect, string> = {
  none: '原生深色',
  perspective: '3D 透视',
  holo: '全息边框',
  brutal: '粗野主义',
  collage: '纸片拼贴',
  plasma: '等离子'
}
const STORAGE_KEY = 'morrow.visual-effect'

function isEffect(value: string | null | undefined): value is Effect {
  return typeof value === 'string' && (EFFECTS as readonly string[]).includes(value)
}

function apply(effect: Effect): void {
  document.body.dataset.effect = effect
  document.documentElement.dataset.effect = effect
  const status = document.querySelector<HTMLElement>('#effect-status')
  if (status) status.textContent = LABELS[effect]
  const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle')
  sidebarToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open')
    sidebarToggle.setAttribute('aria-expanded', String(open))
  })
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open')
      sidebarToggle?.setAttribute('aria-expanded', 'false')
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-effect]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.effect === effect))
    button.classList.toggle('active', button.dataset.effect === effect)
  })
}

export function initializeVisualEffects(): void {
  let stored: string | null = null
  try { stored = window.localStorage.getItem(STORAGE_KEY) } catch { /* private mode */ }
  apply(isEffect(stored) ? stored : 'none')
  const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle')
  sidebarToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open')
    sidebarToggle.setAttribute('aria-expanded', String(open))
  })
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open')
      sidebarToggle?.setAttribute('aria-expanded', 'false')
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-effect]').forEach((button) => {
    button.addEventListener('click', () => {
      const effect = button.dataset.effect
      if (!isEffect(effect)) return
      apply(effect)
      try { window.localStorage.setItem(STORAGE_KEY, effect) } catch { /* private mode */ }
    })
  })
  document.addEventListener('pointermove', (event) => {
    if (document.body.dataset.effect !== 'perspective') return
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.panel, .inspector, .provider-panel, .effect-card')
    if (!target) return
    const rect = target.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
    target.style.setProperty('--tilt-x', `${(-y * 2.2).toFixed(2)}deg`)
    target.style.setProperty('--tilt-y', `${(x * 2.6).toFixed(2)}deg`)
  })
  document.addEventListener('pointerout', (event) => {
    if (document.body.dataset.effect !== 'perspective') return
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.panel, .inspector, .provider-panel, .effect-card')
    if (!target) return
    target.style.removeProperty('--tilt-x')
    target.style.removeProperty('--tilt-y')
  })
}
