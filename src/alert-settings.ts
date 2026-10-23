import { ALERT_KINDS, type AlertKind } from './match-events.ts'

export type AlertSettings = {
  soundId: string
  kinds: Record<AlertKind, boolean>
  /** Promote the panel with a goal to a highlight for 45 s (3+ panels). */
  autoHighlight: boolean
  /** Seconds a score change waits before showing on the panel; null hides the score. */
  scoreDelaySec: number | null
}

export const SCORE_DELAY_OPTIONS: readonly number[] = [0, 10, 20, 30, 45, 60]
/** Per-panel delay for YouTube lives, which run 20 s to 2 min behind the 365Scores data. */
export const LIVE_DELAY_OPTIONS: readonly number[] = [0, 10, 20, 30, 45, 60, 90, 120]

const STORAGE_KEY = 'quadra:alert-settings'

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  soundId: 'apito-arbitro',
  kinds: { goal: true, penalty: true, red: true, yellow: false, var: true },
  autoHighlight: true,
  scoreDelaySec: 0,
}

export function parseAlertSettings(raw: string | null, validSoundIds: readonly string[]): AlertSettings {
  const next: AlertSettings = { soundId: DEFAULT_ALERT_SETTINGS.soundId, kinds: { ...DEFAULT_ALERT_SETTINGS.kinds }, autoHighlight: DEFAULT_ALERT_SETTINGS.autoHighlight, scoreDelaySec: DEFAULT_ALERT_SETTINGS.scoreDelaySec }
  if (!raw) return next
  try {
    const parsed = JSON.parse(raw) as Partial<AlertSettings> | null
    if (parsed && typeof parsed.soundId === 'string' && validSoundIds.includes(parsed.soundId)) next.soundId = parsed.soundId
    if (typeof parsed?.autoHighlight === 'boolean') next.autoHighlight = parsed.autoHighlight
    if (parsed?.scoreDelaySec === null) next.scoreDelaySec = null
    else if (typeof parsed?.scoreDelaySec === 'number' && SCORE_DELAY_OPTIONS.includes(parsed.scoreDelaySec)) next.scoreDelaySec = parsed.scoreDelaySec
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
