import { ALERT_KINDS, type AlertKind } from './match-events.ts'

export type AlertSettings = {
  /** Sound of every alert except goals. */
  soundId: string
  goalSoundId: string
  kinds: Record<AlertKind, boolean>
  /** Promote the panel with a goal to a highlight for `autoHighlightSec` (3+ panels). */
  autoHighlight: boolean
  /** How long a goal keeps its panel highlighted. */
  autoHighlightSec: number
  /** Seconds a score change waits before showing on the panel; null hides the score. */
  scoreDelaySec: number | null
  /** Seconds after the William Hill feed reports the end of a match before its panel closes; null keeps it open. */
  closeFinishedSec: number | null
}

export const AUTO_HIGHLIGHT_OPTIONS: readonly number[] = [15, 30, 45, 60, 90, 120, 180]
export const CLOSE_FINISHED_OPTIONS: readonly number[] = [0, 30, 60, 120, 300]
export const SCORE_DELAY_OPTIONS: readonly number[] = [0, 10, 20, 30, 45, 60]
/** Per-panel delay for YouTube lives, which run 20 s to 2 min behind the 365Scores data. */
export const LIVE_DELAY_OPTIONS: readonly number[] = [0, 10, 20, 30, 45, 60, 90, 120]

const STORAGE_KEY = 'quadra:alert-settings'

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  soundId: 'apito-arbitro',
  goalSoundId: 'gol-torcida',
  kinds: { goal: true, penalty: true, red: true, yellow: false, var: true },
  autoHighlight: true,
  autoHighlightSec: 45,
  scoreDelaySec: 0,
  closeFinishedSec: 60,
}

export function parseAlertSettings(raw: string | null, validSoundIds: readonly string[]): AlertSettings {
  const next: AlertSettings = { soundId: DEFAULT_ALERT_SETTINGS.soundId, goalSoundId: DEFAULT_ALERT_SETTINGS.goalSoundId, kinds: { ...DEFAULT_ALERT_SETTINGS.kinds }, autoHighlight: DEFAULT_ALERT_SETTINGS.autoHighlight, autoHighlightSec: DEFAULT_ALERT_SETTINGS.autoHighlightSec, scoreDelaySec: DEFAULT_ALERT_SETTINGS.scoreDelaySec, closeFinishedSec: DEFAULT_ALERT_SETTINGS.closeFinishedSec }
  if (!raw) return next
  try {
    const parsed = JSON.parse(raw) as Partial<AlertSettings> | null
    if (parsed && typeof parsed.soundId === 'string' && validSoundIds.includes(parsed.soundId)) next.soundId = parsed.soundId
    // Settings saved before the goal had its own sound keep playing the one sound the user picked.
    if (parsed && typeof parsed.goalSoundId === 'string' && validSoundIds.includes(parsed.goalSoundId)) next.goalSoundId = parsed.goalSoundId
    else if (parsed && parsed.goalSoundId === undefined && typeof parsed.soundId === 'string' && validSoundIds.includes(parsed.soundId)) next.goalSoundId = parsed.soundId
    if (typeof parsed?.autoHighlight === 'boolean') next.autoHighlight = parsed.autoHighlight
    if (typeof parsed?.autoHighlightSec === 'number' && AUTO_HIGHLIGHT_OPTIONS.includes(parsed.autoHighlightSec)) next.autoHighlightSec = parsed.autoHighlightSec
    if (parsed?.scoreDelaySec === null) next.scoreDelaySec = null
    else if (typeof parsed?.scoreDelaySec === 'number' && SCORE_DELAY_OPTIONS.includes(parsed.scoreDelaySec)) next.scoreDelaySec = parsed.scoreDelaySec
    if (parsed?.closeFinishedSec === null) next.closeFinishedSec = null
    else if (typeof parsed?.closeFinishedSec === 'number' && CLOSE_FINISHED_OPTIONS.includes(parsed.closeFinishedSec)) next.closeFinishedSec = parsed.closeFinishedSec
    for (const kind of ALERT_KINDS) {
      if (typeof parsed?.kinds?.[kind] === 'boolean') next.kinds[kind] = parsed.kinds[kind]
    }
  } catch {
    /* corrupt value: keep defaults */
  }
  return next
}

export function loadAlertSettings(validSoundIds: readonly string[]): AlertSettings {
  try {
    return parseAlertSettings(localStorage.getItem(STORAGE_KEY), validSoundIds)
  } catch {
    return parseAlertSettings(null, validSoundIds)
  }
}

export function saveAlertSettings(settings: AlertSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable: preferences last only for this session */
  }
}
