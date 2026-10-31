import { LIVE_DELAY_OPTIONS } from './alert-settings.ts'
import type { AlertKind } from './match-events.ts'

/** Thickness of the alert frame around the floating window's video, in px. */
export const PIP_FRAME = 3
export const PIP_BAR_MIN = 28
export const PIP_BAR_MAX = 120
export const PIP_MIN_WIDTH = 320
export const PIP_MIN_HEIGHT = 212
const PIP_VIDEO_WIDTH = 480
const PIP_MARGIN = 24
const PIP_GAP = 12
const MAX_URL_LENGTH = 4096
/** Crests travel as data URLs, so the state can be a few dozen KB. */
const MAX_STATE_BYTES = 64 * 1024

export type PipBounds = { x: number; y: number; width: number; height: number }

export type PipState = {
  panelId: string
  index: number
  url: string
  muted: boolean
  alertsOff: boolean
  title: string
  match: {
    home: string
    away: string
    score: { home: number; away: number } | null
    crests: { home: string | null; away: string | null }
    clock: { text: string; halftime: boolean } | null
  } | null
  alert: { kind: AlertKind; text: string; scorer: 'home' | 'away' | null; player: string } | null
  varReview: { icon: string; text: string } | null
  delay: { effective: number; own: number | null; defaultLabel: string; title: string; options: number[] } | null
  prompt: { candidates: { id: number; label: string; detail: string }[] } | null
  finished: { secondsLeft: number } | null
  bllTarget: boolean
}

export type PipCommand =
  | { type: 'mute' }
  | { type: 'alerts' }
  | { type: 'reload' }
  | { type: 'delay'; value: 'default' | number }
  | { type: 'url'; url: string }
  | { type: 'bllsport' }
  | { type: 'youtube' }
  | { type: 'zapping' }
  | { type: 'choose-match'; gameId: number | null }
  | { type: 'keep-open' }
  | { type: 'return' }

const SIMPLE_COMMANDS = new Set(['mute', 'alerts', 'reload', 'bllsport', 'youtube', 'zapping', 'keep-open', 'return'])

/** Validates a command coming from the floating window; anything unexpected is dropped. */
export function parsePipCommand(value: unknown): PipCommand | null {
  if (!value || typeof value !== 'object') return null
  const command = value as { type?: unknown; value?: unknown; url?: unknown; gameId?: unknown }
  if (typeof command.type !== 'string') return null
  if (SIMPLE_COMMANDS.has(command.type)) return { type: command.type } as PipCommand
  if (command.type === 'delay') {
    if (command.value === 'default') return { type: 'delay', value: 'default' }
    if (typeof command.value === 'number' && LIVE_DELAY_OPTIONS.includes(command.value)) return { type: 'delay', value: command.value }
    return null
  }
  if (command.type === 'url') {
    if (typeof command.url !== 'string' || command.url.length > MAX_URL_LENGTH) return null
    return { type: 'url', url: command.url }
  }
  if (command.type === 'choose-match') {
    if (command.gameId === null) return { type: 'choose-match', gameId: null }
    if (typeof command.gameId === 'number' && Number.isSafeInteger(command.gameId) && command.gameId > 0) return { type: 'choose-match', gameId: command.gameId }
  }
  return null
}

/** The state is only forwarded to the window showing that panel, and only when it is a reasonably small object. */
export function isValidPipState(value: unknown, panelId: string | null): value is PipState {
  if (!value || typeof value !== 'object' || panelId === null) return false
  if ((value as { panelId?: unknown }).panelId !== panelId) return false
  try {
    return JSON.stringify(value).length <= MAX_STATE_BYTES
  } catch {
    return false
  }
}

export function clampPipBar(height: number) {
  return Math.min(PIP_BAR_MAX, Math.max(PIP_BAR_MIN, Math.round(height)))
}

/** Where the panel's view sits inside the floating window: under the bar, inside the alert frame. */
export function pipViewBounds(size: { width: number; height: number }, barHeight: number): PipBounds {
  const bar = clampPipBar(barHeight)
  return {
    x: PIP_FRAME,
    y: bar,
    width: Math.max(1, size.width - 2 * PIP_FRAME),
    height: Math.max(1, size.height - bar - PIP_FRAME),
  }
}

/** Window size that gives a 16:9 video under a bar of this height. */
export function pipWindowSize(videoWidth: number, barHeight: number) {
  const width = Math.round(videoWidth) + 2 * PIP_FRAME
  return { width, height: Math.round((videoWidth * 9) / 16) + clampPipBar(barHeight) + PIP_FRAME }
}

/**
 * First position of a window: the work area's bottom-right corner, never larger than half of it. Further windows (slot 1, 2, …)
 * stack upward, then continue in the next column to the left.
 */
export function defaultPipBounds(workArea: PipBounds, barHeight = PIP_BAR_MIN + 4, slot = 0): PipBounds {
  let videoWidth = PIP_VIDEO_WIDTH
  let size = pipWindowSize(videoWidth, barHeight)
  while ((size.width > workArea.width / 2 || size.height > workArea.height / 2) && videoWidth > PIP_MIN_WIDTH) {
    videoWidth = Math.max(PIP_MIN_WIDTH - 2 * PIP_FRAME, videoWidth - 40)
    size = pipWindowSize(videoWidth, barHeight)
  }
  const rows = Math.max(1, Math.floor((workArea.height - PIP_MARGIN) / (size.height + PIP_GAP)))
  const row = slot % rows
  const column = Math.floor(slot / rows)
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - size.width - PIP_MARGIN - column * (size.width + PIP_GAP)),
    y: workArea.y + workArea.height - size.height - PIP_MARGIN - row * (size.height + PIP_GAP),
    width: size.width,
    height: size.height,
  }
}
