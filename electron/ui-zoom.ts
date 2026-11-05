/** Zoom of the overlay UI (panel buttons, toolbar), like a browser's Ctrl + / Ctrl - / Ctrl 0 and Ctrl + wheel. */
export type ZoomCommand = 'in' | 'out' | 'reset'

export const ZOOM_STEP = 0.5
export const ZOOM_LIMIT = 3

type ZoomKeyInput = Pick<Electron.Input, 'type' | 'key' | 'code' | 'control' | 'alt' | 'meta'>

/** On macOS the zoom keys use Cmd (meta) instead of Ctrl, like any Mac browser. */
export function zoomCommandOf(input: ZoomKeyInput, mac = false): ZoomCommand | null {
  const modifier = mac ? input.meta && !input.control : input.control && !input.meta
  if (!modifier || input.alt || input.type !== 'keyDown') return null
  const { key, code } = input
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 'in'
  if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'out'
  if (key === '0' || code === 'Numpad0') return 'reset'
  return null
}

export const WHEEL_ZOOM_GAP_MS = 30

/** Electron reports one Ctrl + wheel notch more than once; a short gap keeps it to one step per notch. */
export function createWheelZoomGate(gapMs = WHEEL_ZOOM_GAP_MS, now = () => Date.now()) {
  let last = -Infinity
  return () => {
    const at = now()
    if (at - last < gapMs) return false
    last = at
    return true
  }
}

export function nextZoomLevel(current: number, command: ZoomCommand) {
  if (command === 'reset') return 0
  const base = Number.isFinite(current) ? current : 0
  const level = base + (command === 'in' ? ZOOM_STEP : -ZOOM_STEP)
  return Math.max(-ZOOM_LIMIT, Math.min(ZOOM_LIMIT, level))
}
