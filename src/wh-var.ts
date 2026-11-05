import type { MatchIncident } from './match-events'
import type { VarReview } from './livescore-365'

/**
 * VAR for William Hill panels. The William Hill feed has no VAR incident, so a BLL panel with a
 * William Hill feed borrows only the VAR (review in progress and decisions) from the same game on
 * 365Scores, found by the feed's team names. Goals, cards and penalties keep coming from William Hill.
 */

type Side = MatchIncident['team']

/** A William Hill goal alerted on a panel, in the feed's home/away order. */
export type WhGoal = { team: 'home' | 'away'; minute: number; at: number }

/** A disallowed goal only undoes a William Hill goal of the same team this close in match minutes… */
export const WH_GOAL_MATCH_MINUTES = 3
/** …alerted at most this long ago (the VAR decides in a few minutes). */
export const WH_GOAL_MATCH_MS = 10 * 60_000
const MAX_GOALS = 20

export function flipSide<T extends Side | null>(team: T): T {
  return (team === 'home' ? 'away' : team === 'away' ? 'home' : team) as T
}

/** "2 - 1" → "1 - 2"; anything else is left as is. */
export function flipScore(score: string): string {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(score)
  return match ? `${match[2]} - ${match[1]}` : score
}

/**
 * The 365Scores alerts a William Hill panel takes: VAR only, turned to the feed's home/away
 * order (`reversed`: the feed's home team is 365Scores' away team).
 */
export function varOnly(incidents: readonly MatchIncident[], reversed: boolean): MatchIncident[] {
  return incidents
    .filter((incident) => incident.kind === 'var')
    .map((incident) => (reversed ? { ...incident, team: flipSide(incident.team) } : incident))
}

export function orientReview<T extends VarReview>(review: T | null, reversed: boolean): T | null {
  return review && reversed ? { ...review, team: flipSide(review.team) } : review
}

/** Remembers a William Hill goal of a panel (recent ones only). */
export function recordWhGoal(goals: readonly WhGoal[], goal: WhGoal): WhGoal[] {
  return [...goals.filter((entry) => goal.at - entry.at <= WH_GOAL_MATCH_MS), goal].slice(-MAX_GOALS)
}

/**
 * A 365Scores "gol anulado" (already in the feed's order) undoes the goal highlight only when it is
 * about a William Hill goal the panel just alerted: same team, near the same minute. Otherwise
 * (a goal William Hill never counted, or the other team's goal on screen) the highlight stays.
 */
export function cancelsWhGoal(goals: readonly WhGoal[], incident: MatchIncident, now: number): boolean {
  if (incident.kind !== 'var' || incident.note !== 'gol anulado') return false
  if (incident.team !== 'home' && incident.team !== 'away') return false
  return goals.some((goal) =>
    goal.team === incident.team
    && now - goal.at <= WH_GOAL_MATCH_MS
    && (incident.minute <= 0 || goal.minute <= 0 || Math.abs(goal.minute - incident.minute) <= WH_GOAL_MATCH_MINUTES))
}
