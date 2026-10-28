/** Part of the match the clock is in. Breaks and penalties have no running time. */
export type ClockPeriod =
  | 'first'
  | 'half-time'
  | 'second'
  | 'extra-break'
  | 'extra-first'
  | 'extra-half-time'
  | 'extra-second'
  | 'penalties'

/**
 * One reading of the match clock. `elapsed` counts the whole match (the second half starts at 45:00),
 * read at `at` (ms); while `running` it keeps going from there. `breakStartedAt` is when the
 * half-time break began, for its countdown; null when unknown (e.g. linked during the break).
 */
export type MatchClock = {
  period: ClockPeriod
  elapsed: number | null
  running: boolean
  at: number
  breakStartedAt: number | null
}

/** What the label shows: a short tag ("2T", "Intervalo") and the time ("67:12", "45+2:13", countdown). */
export type ClockView = { tag: string; time: string; paused: boolean; title: string }

/** Half-time lasts 15 minutes: the break counts down from its start. */
export const HALF_TIME_MS = 15 * 60_000

/** Where each period starts and where its regular time ends (s): past the end is added time. */
const PERIOD_SPAN: Partial<Record<ClockPeriod, [number, number]>> = {
  first: [0, 45 * 60],
  second: [45 * 60, 90 * 60],
  'extra-first': [90 * 60, 105 * 60],
  'extra-second': [105 * 60, 120 * 60],
}

const RUNNING_PERIODS = new Set<ClockPeriod>(['first', 'second', 'extra-first', 'extra-second'])

export function isRunningPeriod(period: ClockPeriod) {
  return RUNNING_PERIODS.has(period)
}

const WH_PERIODS: Record<string, ClockPeriod> = {
  FIRST_HALF: 'first',
  HALF_TIME: 'half-time',
  SECOND_HALF: 'second',
  EXTRA_TIME_NOT_STARTED: 'extra-break',
  FIRST_HALF_EXTRA_TIME: 'extra-first',
  EXTRA_TIME_HALF_TIME: 'extra-half-time',
  HALF_TIME_EXTRA_TIME: 'extra-half-time',
  SECOND_HALF_EXTRA_TIME: 'extra-second',
  PENALTIES_NOT_STARTED: 'penalties',
  PENALTY_SHOOTOUT_NOT_STARTED: 'penalties',
  PENALTIES: 'penalties',
}

/** William Hill clock period (`WH.scoreboard.statistics.getPeriod()`). Not started, finished and STOP_GAME have none. */
export function whClockPeriod(raw: string): ClockPeriod | null {
  return WH_PERIODS[raw] ?? null
}

/** Feed incidents that mark the half-time whistle; their timestamp starts the break countdown. */
export const HALF_TIME_INCIDENTS = ['STOP_1_ST_HALF', 'HALF_TIME']

/**
 * 365Scores game status (`statusId`, with `statusText` in Portuguese as a fallback):
 * 6 first half and 7 half-time were read on live games; the rest comes from the text.
 */
export function clockPeriod365(statusId: number, statusText: string): ClockPeriod | null {
  if (statusId === 6) return 'first'
  if (statusId === 7) return 'half-time'
  const text = statusText
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  if (/penalt|disputa/.test(text)) return 'penalties'
  if (/prorrog|extra/.test(text)) {
    if (/interv|pausa/.test(text)) return 'extra-half-time'
    if (/segund|2/.test(text)) return 'extra-second'
    if (/prime|1/.test(text)) return 'extra-first'
    return null
  }
  if (/interv/.test(text)) return 'half-time'
  if (/segundo tempo|2o tempo|2. tempo/.test(text)) return 'second'
  if (/primeiro tempo|1o tempo|1. tempo/.test(text)) return 'first'
  return null
}

/**
 * Some feeds may restart the count in each half: an elapsed time below the period's start
 * is taken as counted from that start.
 */
export function normalizeElapsed(period: ClockPeriod, elapsed: number) {
  const span = PERIOD_SPAN[period]
  if (!span || elapsed >= span[0]) return elapsed
  return span[0] + elapsed
}

/** Match time (s) at `when`, or null when the clock has none. Never earlier than the start of its period. */
export function clockElapsedAt(clock: MatchClock, when: number): number | null {
  if (clock.elapsed === null) return null
  const moved = clock.running ? (when - clock.at) / 1000 : 0
  const start = PERIOD_SPAN[clock.period]?.[0] ?? 0
  return Math.max(start, clock.elapsed + moved)
}

/** True when `next` says nothing `previous` wouldn't show anyway (same period and state, time within `toleranceSec`). */
export function sameClock(previous: MatchClock | null, next: MatchClock, toleranceSec = 2) {
  if (!previous) return false
  if (previous.period !== next.period || previous.running !== next.running || previous.breakStartedAt !== next.breakStartedAt) return false
  if (previous.elapsed === null || next.elapsed === null) return previous.elapsed === next.elapsed
  const expected = clockElapsedAt(previous, next.at) ?? 0
  return Math.abs(expected - next.elapsed) <= toleranceSec
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function minutesSeconds(totalSec: number) {
  const whole = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(whole / 60)}:${twoDigits(whole % 60)}`
}

/** "67:12" in regular time; in added time the clock keeps running past the end: "45+2:13". */
export function formatMatchTime(period: ClockPeriod, elapsed: number) {
  const span = PERIOD_SPAN[period]
  if (span && elapsed >= span[1]) return `${span[1] / 60}+${minutesSeconds(elapsed - span[1])}`
  return minutesSeconds(elapsed)
}

const TAGS: Record<ClockPeriod, { tag: string; title: string }> = {
  first: { tag: '1T', title: '1º tempo' },
  'half-time': { tag: 'Intervalo', title: 'Intervalo' },
  second: { tag: '2T', title: '2º tempo' },
  'extra-break': { tag: 'Intervalo', title: 'Intervalo antes da prorrogação' },
  'extra-first': { tag: 'Prorr.', title: '1º tempo da prorrogação' },
  'extra-half-time': { tag: 'Intervalo', title: 'Intervalo da prorrogação' },
  'extra-second': { tag: 'Prorr.', title: '2º tempo da prorrogação' },
  penalties: { tag: 'Pênaltis', title: 'Disputa de pênaltis' },
}

/** What the label shows at `when` (already shifted back by the panel's delay). */
export function clockView(clock: MatchClock, when: number): ClockView {
  const { tag, title } = TAGS[clock.period]
  if (clock.period === 'half-time') {
    // Counts down the 15 minutes of the break; past them (or with an unknown start) only "Intervalo".
    const left = clock.breakStartedAt === null ? 0 : HALF_TIME_MS - (when - clock.breakStartedAt)
    const time = left > 0 ? minutesSeconds(Math.ceil(left / 1000)) : ''
    return { tag, time, paused: true, title: time ? `${title}: faltam ${time} para os 15 minutos` : title }
  }
  if (!isRunningPeriod(clock.period)) return { tag, time: '', paused: true, title }
  const elapsed = clockElapsedAt(clock, when)
  const time = elapsed === null ? '' : formatMatchTime(clock.period, elapsed)
  return { tag, time, paused: !clock.running, title: clock.running ? title : `${title} (relógio parado)` }
}

type TimedClock = { from: number; clock: MatchClock | null }

/** Clock readings of one panel, held back by the same delay as its score. */
export type ClockTimeline = { entries: TimedClock[] }

const MAX_ENTRIES = 8

export function createClockTimeline(): ClockTimeline {
  return { entries: [] }
}

/** Records a reading received at `now` (null: no clock any more). The first one shows at once, like the first score. */
export function pushClock(timeline: ClockTimeline, now: number, clock: MatchClock | null) {
  const last = timeline.entries.at(-1)
  timeline.entries.push({ from: last ? now : Number.NEGATIVE_INFINITY, clock })
  if (timeline.entries.length > MAX_ENTRIES) timeline.entries.splice(0, timeline.entries.length - MAX_ENTRIES)
}

/** The newest reading whose delay has elapsed. */
export function visibleClock(timeline: ClockTimeline, now: number, delayMs: number): MatchClock | null {
  for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
    const entry = timeline.entries[index]
    if (entry.from + delayMs <= now) return entry.clock
  }
  return null
}

/** When the visible reading will next change, or null when nothing is pending. */
export function nextClockChangeAt(timeline: ClockTimeline, now: number, delayMs: number): number | null {
  let next: number | null = null
  for (const entry of timeline.entries) {
    const due = entry.from + delayMs
    if (due > now && (next === null || due < next)) next = due
  }
  return next
}
