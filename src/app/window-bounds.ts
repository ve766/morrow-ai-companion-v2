/** Pure bounds recovery so a saved off-screen position can never hide the app. */
export interface WindowRect { x: number; y: number; width: number; height: number }

export const MIN_WINDOW_WIDTH = 880
export const MIN_WINDOW_HEIGHT = 600

function isFiniteRect(value: unknown): value is WindowRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as WindowRect
  return [rect.x, rect.y, rect.width, rect.height].every((number) => Number.isFinite(number))
}

function intersection(a: WindowRect, b: WindowRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

/**
 * Keeps a saved rectangle only when a meaningful part is inside a current
 * work area. Otherwise centers a default-sized window on the primary display.
 */
export function normalizeWindowBounds(saved: unknown, workAreas: WindowRect[], primary: WindowRect): WindowRect {
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(primary.width, 1100))
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(primary.height, 760))
  if (!isFiniteRect(saved) || workAreas.length === 0) {
    return { x: Math.round(primary.x + (primary.width - width) / 2), y: Math.round(primary.y + (primary.height - height) / 2), width, height }
  }
  const candidate: WindowRect = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(Math.round(saved.width), Math.max(MIN_WINDOW_WIDTH, ...workAreas.map((area) => area.width)))),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(Math.round(saved.height), Math.max(MIN_WINDOW_HEIGHT, ...workAreas.map((area) => area.height))))
  }
  const visibleArea = Math.max(...workAreas.map((area) => intersection(candidate, area)))
  const minimumVisible = 160 * 160
  if (visibleArea < minimumVisible) {
    return { x: Math.round(primary.x + (primary.width - width) / 2), y: Math.round(primary.y + (primary.height - height) / 2), width, height }
  }
  const display = workAreas.slice().sort((left, right) => intersection(candidate, right) - intersection(candidate, left))[0]!
  return {
    x: Math.max(display.x, Math.min(candidate.x, display.x + display.width - candidate.width)),
    y: Math.max(display.y, Math.min(candidate.y, display.y + display.height - candidate.height)),
    width: candidate.width,
    height: candidate.height
  }
}
