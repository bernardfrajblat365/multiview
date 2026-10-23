import type { MatchScore } from './match-label.ts'

type TimedScore = { at: number; score: MatchScore }

/**
 * Scores received from the feed for one panel. The feed usually runs ahead of the
 * video, so changes can be held back by a user-chosen delay to avoid spoilers.
 */
export type ScoreTimeline = { entries: TimedScore[] }

const MAX_ENTRIES = 8

export function createScoreTimeline(): ScoreTimeline {
  return { entries: [] }
}

function sameScore(a: MatchScore, b: MatchScore) {
  return a.home === b.home && a.away === b.away
}

/**
 * Records a score read at `now`. Repeats are ignored. The first score of a panel
 * is the match state when it was opened, not a fresh event, so it shows at once.
 */
export function pushScore(timeline: ScoreTimeline, now: number, score: MatchScore) {
  const last = timeline.entries.at(-1)
  if (last && sameScore(last.score, score)) return false
  timeline.entries.push({ at: last ? now : Number.NEGATIVE_INFINITY, score })
  if (timeline.entries.length > MAX_ENTRIES) timeline.entries.splice(0, timeline.entries.length - MAX_ENTRIES)
  return true
}

/** The newest score whose delay has elapsed. */
export function visibleScore(timeline: ScoreTimeline, now: number, delayMs: number): MatchScore | null {
  for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
    const entry = timeline.entries[index]
    if (entry.at + delayMs <= now) return entry.score
  }
  return null
}

/** When the visible score will next change, or null when nothing is pending. */
export function nextScoreChangeAt(timeline: ScoreTimeline, now: number, delayMs: number): number | null {
  let next: number | null = null
  for (const entry of timeline.entries) {
    const due = entry.at + delayMs
    if (due > now && (next === null || due < next)) next = due
  }
  return next
}
