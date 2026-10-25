// Sidebar navigation for the four product views. Views stay mounted in the
// DOM (hidden with the hidden attribute) so every existing init path, IPC
// listener and the automated smoke flows keep working; switching only toggles
// visibility and the accessible current-page marker.

export type ViewName = 'chat' | 'memory' | 'goals' | 'settings'

const VIEW_NAMES: readonly ViewName[] = ['chat', 'memory', 'goals', 'settings']

function isViewName(value: string): value is ViewName {
  return (VIEW_NAMES as readonly string[]).includes(value)
}

export function applyView(document_: Document, view: ViewName): void {
  for (const name of VIEW_NAMES) {
    const section = document_.querySelector<HTMLElement>(`.view[data-view="${name}"]`)
    if (!section) throw new Error(`Interface element unavailable: view ${name}`)
    section.hidden = name !== view
    section.classList.toggle('active', name === view)
    const navButton = document_.querySelector<HTMLButtonElement>(`.nav-item[data-view="${name}"]`)
    if (!navButton) throw new Error(`Interface element unavailable: nav ${name}`)
    navButton.classList.toggle('active', name === view)
    if (name === view) navButton.setAttribute('aria-current', 'page')
    else navButton.removeAttribute('aria-current')
  }
}

export function initializeShell(document_: Document = document): void {
  const navButtons = Array.from(document_.querySelectorAll<HTMLButtonElement>('.nav-item[data-view]'))
  const known = navButtons.filter((button) => isViewName(button.dataset.view ?? ''))
  if (known.length !== VIEW_NAMES.length) throw new Error('Interface element unavailable: navigation incomplete')
  for (const button of known) {
    button.addEventListener('click', () => {
      applyView(document_, button.dataset.view as ViewName)
    })
  }
  applyView(document_, 'chat')
}
