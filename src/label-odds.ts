import { formatOdd, type Moneyline } from './match-info.ts'

/**
 * 1X2 odds of one panel's game, for the label under each team name. Odds swing on a goal, so they wait for the
 * same delay as the score (⏱): an odd that moved would spoil a goal the video hasn't shown yet.
 */
type TimedOdds = { at: number; odds: Moneyline | null }
export type OddsTimeline = { entries: TimedOdds[] }

const MAX_ENTRIES = 8
/** Live games: the API caches the odds for 30 s. */
export const LABEL_ODDS_POLL_MS = 30_000
/** Game without open odds (not covered, or the result is already decided): ask again much later. */
export const LABEL_ODDS_IDLE_MS = 120_000
export const LABEL_ODDS_STORAGE_KEY = 'quadra:label-odds'

export function createOddsTimeline(): OddsTimeline {
  return { entries: [] }
}

function sameOdds(a: Moneyline | null, b: Moneyline | null) {
  if (!a || !b) return a === b
  const same = (x: Moneyline['home'] | null, y: Moneyline['home'] | null) => (!x || !y ? x === y : x.rate === y.rate && x.trend === y.trend)
  return same(a.home, b.home) && same(a.draw, b.draw) && same(a.away, b.away)
}

/** Records odds read at `now` (null: the game has no open odds any more). Like the score, the first reading shows at once. */
export function pushOdds(timeline: OddsTimeline, now: number, odds: Moneyline | null) {
  const last = timeline.entries.at(-1)
  if (last ? sameOdds(last.odds, odds) : odds === null) return false
  timeline.entries.push({ at: last ? now : Number.NEGATIVE_INFINITY, odds })
  if (timeline.entries.length > MAX_ENTRIES) timeline.entries.splice(0, timeline.entries.length - MAX_ENTRIES)
  return true
}

/** The newest odds whose delay has elapsed. */
export function visibleOdds(timeline: OddsTimeline, now: number, delayMs: number): Moneyline | null {
  for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
    const entry = timeline.entries[index]
    if (entry.at + delayMs <= now) return entry.odds
  }
  return null
}

/** When the visible odds will next change, or null when nothing is pending. */
export function nextOddsChangeAt(timeline: OddsTimeline, now: number, delayMs: number): number | null {
  let next: number | null = null
  for (const entry of timeline.entries) {
    const due = entry.at + delayMs
    if (due > now && (next === null || due < next)) next = due
  }
  return next
}

/** Odds in the label's team order: the label follows the title, which may list the teams the other way round than the feed. */
export function orientOdds(odds: Moneyline, reversed: boolean): Moneyline {
  return reversed ? { home: odds.away, draw: odds.draw, away: odds.home } : odds
}

/** Text under each name and under the score ("3,76", "X 1,73"); the arrow is drawn apart. */
export function labelOddsText(odds: Moneyline) {
  return { home: formatOdd(odds.home.rate), draw: odds.draw ? `X ${formatOdd(odds.draw.rate)}` : '', away: formatOdd(odds.away.rate) }
}

/** "1 3,76 · X 1,73 · 2 4,77", for the label's aria-label. */
export function oddsSpoken(odds: Moneyline) {
  return [`1 ${formatOdd(odds.home.rate)}`, odds.draw ? `X ${formatOdd(odds.draw.rate)}` : '', `2 ${formatOdd(odds.away.rate)}`].filter(Boolean).join(' · ')
}

/** Saved choice of the ⋯ menu; on unless turned off. */
export function loadLabelOddsSetting(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(LABEL_ODDS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveLabelOddsSetting(storage: Pick<Storage, 'setItem'> | null, on: boolean) {
  try {
    storage?.setItem(LABEL_ODDS_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private mode or storage blocked: the choice lasts for this session only.
  }
}
