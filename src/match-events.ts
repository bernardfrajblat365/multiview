/** `touchdown` and `field-goal`: American football (NFL), from 365Scores. */
export type AlertKind = 'goal' | 'penalty' | 'red' | 'yellow' | 'var' | 'touchdown' | 'field-goal'
export const ALERT_KINDS: readonly AlertKind[] = ['goal', 'penalty', 'red', 'yellow', 'var', 'touchdown', 'field-goal']

export type RawIncident = {
  id?: unknown
  type?: unknown
  subType?: unknown
  teamType?: unknown
  timestamp?: unknown
  time?: { duration?: unknown } | null
}

export type MatchIncident = {
  id: string
  kind: AlertKind
  team: 'home' | 'away' | 'match'
  minute: number
  ownGoal: boolean
  timestamp: number
  /** Extra detail shown in parentheses ("pênalti", "perdido", "gol anulado"); empty when none. */
  note: string
}

export type ScannerState = {
  seen: Set<string>
  attachedAt: number
  /** The feed showed the match being played while this scanner watched it. */
  live: boolean
  /** The end of the match was already reported. */
  ended: boolean
}

/** Incidents older than this at attach time are replayed history, never alerted. */
export const HISTORY_GRACE_MS = 90_000
const MAX_SEEN = 2000

const KIND_BY_TYPE: Record<string, AlertKind> = {
  GOAL: 'goal',
  PENALTY: 'penalty',
  RED_CARD: 'red',
  YELLOW_CARD: 'yellow',
}

/** Feed incident types that can alert; the scoreboard hook forwards only these. */
export const ALERT_INCIDENT_TYPES: readonly string[] = Object.keys(KIND_BY_TYPE)

export function classifyIncident(raw: RawIncident): MatchIncident | null {
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 200) return null
  if (typeof raw.type !== 'string') return null
  const kind = KIND_BY_TYPE[raw.type]
  if (!kind) return null
  const team = raw.teamType === 'HOME' ? 'home' : raw.teamType === 'AWAY' ? 'away' : 'match'
  const duration = Number(raw.time?.duration)
  const timestamp = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN
  return {
    id: raw.id,
    kind,
    team,
    minute: Number.isFinite(duration) && duration >= 0 ? Math.floor(duration / 60) + 1 : 0,
    ownGoal: typeof raw.subType === 'string' && /OWN/i.test(raw.subType),
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    note: '',
  }
}

export function createScannerState(now: number): ScannerState {
  return { seen: new Set(), attachedAt: now, live: false, ended: false }
}

/** Clock period of the William Hill feed once the match is over (also after extra time and penalties). */
export const FINISHED_PERIOD = 'GAME_FINISHED'
/** Feed incident at the final whistle; only trusted when the clock period can't be read. */
export const END_INCIDENT_TYPE = 'END_OF_MATCH'

/**
 * True once, the first time the feed says the match is over. A match that was already
 * over when the scanner attached replays its end from history and is never reported,
 * so opening a finished game doesn't close its panel right away.
 */
export function detectMatchEnd(state: ScannerState, period: string, endAt: number): boolean {
  if (state.ended) return false
  const finished = period === FINISHED_PERIOD || (!period && endAt > 0)
  if (!finished) {
    if (period && period !== 'NOT_STARTED') state.live = true
    return false
  }
  if (!state.live && !(endAt > 0 && endAt >= state.attachedAt - HISTORY_GRACE_MS)) return false
  state.ended = true
  return true
}

/**
 * Returns incidents that should alert. Every id is remembered so replays after a
 * reconnect never alert twice, and incidents that predate the attach moment
 * (the feed replays the match history on connect) are marked seen without alerting.
 */
export function filterNew(state: ScannerState, incidents: readonly RawIncident[]): { fresh: MatchIncident[]; ignored: number } {
  const fresh: MatchIncident[] = []
  let ignored = 0
  for (const raw of incidents) {
    const id = raw && typeof raw.id === 'string' ? raw.id : ''
    if (!id || state.seen.has(id)) continue
    state.seen.add(id)
    const incident = classifyIncident(raw)
    if (!incident) continue
    if (incident.timestamp > 0 && incident.timestamp < state.attachedAt - HISTORY_GRACE_MS) {
      ignored += 1
      continue
    }
    fresh.push(incident)
  }
  if (state.seen.size > MAX_SEEN) {
    state.seen = new Set([...state.seen].slice(-MAX_SEEN / 2))
  }
  return { fresh, ignored }
}

export function extractWilliamHillId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const id = String(value).replace(/^OB_EV/, '')
  return /^\d{1,12}$/.test(id) ? id : null
}

const KIND_LABELS: Record<AlertKind, string> = {
  goal: 'GOL',
  penalty: 'PÊNALTI',
  red: 'CARTÃO VERMELHO',
  yellow: 'CARTÃO AMARELO',
  var: 'VAR',
  touchdown: 'TOUCHDOWN',
  'field-goal': 'FIELD GOAL',
}

export function alertLabel(kind: AlertKind, teamName: string, minute: number): string {
  const parts = [KIND_LABELS[kind]]
  if (teamName) parts.push(teamName)
  if (minute > 0) parts.push(`${minute}'`)
  return parts.join(' · ')
}
