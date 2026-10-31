import { matchGame, teamSimilarity, type Game365, type TeamRef365 } from './livescore-365.ts'

/** 365Scores image CDN: public, no login, cached for a year. */
export const CREST_BASE_URL = 'https://imagecache.365scores.com'
/**
 * Small PNG, sized for the label. No default image (`d_…`): a team without a crest
 * answers 404 instead of a generic shield, so the label simply shows no crest.
 */
const CREST_TRANSFORM = 'f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2'

export type CrestTeams = { home: TeamRef365; away: TeamRef365 }

export function crestUrl(team: TeamRef365, base = CREST_BASE_URL) {
  return `${base.replace(/\/+$/, '')}/image/upload/${CREST_TRANSFORM}/v${team.imageVersion}/Competitors/${team.id}`
}

/** Same team and crest version, same image. */
export function crestKey(team: TeamRef365) {
  return `${team.id}:${team.imageVersion}`
}

function bestSimilarity(name: string, variants: readonly string[]) {
  return Math.max(0, ...variants.map((variant) => teamSimilarity(name, variant)))
}

/**
 * The 365Scores game that clearly has both teams named by another feed (William Hill). `reversed`: the feed's
 * home team is the away team in 365Scores. Unclear → null: no game beats the wrong one.
 */
export function findLinkedGame(home: string, away: string, games: readonly Game365[], now: number): { game: Game365; reversed: boolean } | null {
  if (!home || !away) return null
  const result = matchGame(`${home} x ${away}`, games, now)
  if (result.status !== 'matched') return null
  const game = result.game
  const straight = Math.min(bestSimilarity(home, game.homeNames), bestSimilarity(away, game.awayNames))
  const reversed = Math.min(bestSimilarity(home, game.awayNames), bestSimilarity(away, game.homeNames))
  return { game, reversed: reversed > straight }
}

/** Crests of a linked game, in the feed's home/away order; null when the API left out a team's ids. */
export function crestTeamsOf(linked: { game: Game365; reversed: boolean }): CrestTeams | null {
  const { homeTeam, awayTeam } = linked.game
  if (!homeTeam || !awayTeam) return null
  return linked.reversed ? { home: awayTeam, away: homeTeam } : { home: homeTeam, away: awayTeam }
}

/**
 * Crests for a game named by another feed (William Hill): the 365Scores game that
 * clearly has both teams, returned in the feed's home/away order. Unclear → null:
 * no crest beats the wrong one.
 */
export function findCrestTeams(home: string, away: string, games: readonly Game365[], now: number): CrestTeams | null {
  const linked = findLinkedGame(home, away, games, now)
  return linked ? crestTeamsOf(linked) : null
}

/** Teams of the games being played now, most likely to be opened next; each crest once, up to `limit`. */
export function liveTeams(games: readonly Game365[], limit: number): TeamRef365[] {
  const teams = new Map<string, TeamRef365>()
  for (const game of games) {
    if (game.statusGroup !== 3) continue
    for (const team of [game.homeTeam, game.awayTeam]) {
      if (team && teams.size < limit) teams.set(crestKey(team), team)
    }
  }
  return [...teams.values()]
}
