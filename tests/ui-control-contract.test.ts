import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Control {
  id: string
  selector: string
  ipc: string
  ipcKey?: string
  preload: string
  renderer: string
}

const contract = JSON.parse(readFileSync('docs/ui/control-contract.json', 'utf8')) as { controls: Control[] }
const html = readFileSync('src/renderer/index.html', 'utf8')
const contracts = readFileSync('src/shared/contracts.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const ipc = readFileSync('src/app/ipc.ts', 'utf8')

describe('UI control contract', () => {
  it('declares stable selectors that exist in the current renderer', () => {
    for (const control of contract.controls) {
      const testId = control.selector.match(/data-testid="([^"]+)"/)?.[1]
      const id = control.selector.startsWith('#') ? control.selector.slice(1) : null
      const present = testId ? html.includes(`data-testid="${testId}"`) : id ? html.includes(`id="${id}"`) : false
      expect(present, `${control.id} selector ${control.selector}`).toBe(true)
    }
  })

  it('keeps every declared IPC channel in the contract, preload and main handler', () => {
    for (const control of contract.controls) {
      if (control.ipc === 'none') continue
      expect(contracts, `${control.id} contracts.ts`).toContain(control.ipc)
      if (control.ipcKey) {
        expect(preload, `${control.id} preload`).toContain(`IPC_CHANNELS.${control.ipcKey}`)
        expect(ipc, `${control.id} ipc handler`).toContain(`IPC_CHANNELS.${control.ipcKey}`)
      }
    }
  })

  it('covers the critical conversation, provider, memory, personality and presentation controls', () => {
    const ids = new Set(contract.controls.map((control) => control.id))
    for (const required of ['chat-content', 'chat-send', 'chat-cancel', 'conversation-new', 'conversation-select', 'provider-profile-save', 'provider-profile-test', 'personality-save', 'memory-create-submit', 'effect-perspective', 'effect-holo', 'effect-brutal', 'effect-collage', 'effect-plasma']) {
      expect(ids.has(required), required).toBe(true)
    }
  })
})
