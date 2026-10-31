import type { Game365, TeamRef365 } from '../src/livescore-365'
import { crestKey, crestTeamsOf, crestUrl, findLinkedGame, liveTeams, type CrestTeams } from '../src/team-crests'
import { hasImage, loadImage } from './image-cache'

/** Crests as data URLs, in the feed's home/away order; null where a team has none. */
export type PanelCrests = { panelId: string; home: string | null; away: string | null }

type PanelEntry = {
  /** Feed names the crests were asked for; a new pair starts over. */
  key: string
  attempts: number
  token: number
  retryTimer?: ReturnType<typeof setTimeout>
}

const IMAGE_BASE_URL = process.env.QUADRA_365SCORES_IMAGE_URL
const PREFETCH_LIMIT = 120
/** Prefetch runs behind the crests a panel asked for, a few at a time. */
const PREFETCH_CONCURRENCY = 4
/** A William Hill game missing from 365Scores may show up in a later list (or never): look a few more times. */
const RETRY_MS = 120_000
const MAX_ATTEMPTS = 3

/**
 * Team crests from the 365Scores CDN for the match label. Never holds up the label:
 * names and score go out as before, crests follow as soon as they are downloaded.
 */
export function createTeamCrests(options: {
  listGames: () => Promise<Game365[]>
  onCrests: (crests: PanelCrests) => void
  /** The 365Scores game found for a panel by its William Hill names (`gameId` null: gone), for the info drawer. */
  onGame?: (game: { panelId: string; gameId: number | null; reversed: boolean }) => void
}) {
  const panels = new Map<string, PanelEntry>()
  const prefetchQueue: TeamRef365[] = []
  let prefetching = 0
  let serial = 0

  /** Crests and player photos share one image cache; a crest is keyed by team and image version. */
  function image(team: TeamRef365): Promise<string | null> {
    return loadImage(`crest:${crestKey(team)}`, crestUrl(team, IMAGE_BASE_URL))
  }

  function pumpPrefetch() {
    while (prefetching < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
      const team = prefetchQueue.shift()!
      if (hasImage(`crest:${crestKey(team)}`)) continue
      prefetching += 1
      void image(team).finally(() => {
        prefetching -= 1
        pumpPrefetch()
      })
    }
  }

  /** Called with every fresh 365Scores games list: downloads the crests of the games being played. */
  function prefetch(games: readonly Game365[]) {
    for (const team of liveTeams(games, PREFETCH_LIMIT)) {
      if (!hasImage(`crest:${crestKey(team)}`)) prefetchQueue.push(team)
    }
    prefetchQueue.splice(PREFETCH_LIMIT)
    pumpPrefetch()
  }

  /** Fetches the games list ahead of time (a BLL player is loading), so its crests are likely ready when its names arrive. */
  function warm() {
    void options.listGames().catch(() => {})
  }

  async function send(panelId: string, token: number, teams: CrestTeams) {
    const [home, away] = await Promise.all([image(teams.home), image(teams.away)])
    if (panels.get(panelId)?.token !== token || (!home && !away)) return
    options.onCrests({ panelId, home, away })
  }

  async function resolve(panelId: string, home: string, away: string) {
    const entry = panels.get(panelId)
    if (!entry) return
    const token = entry.token
    entry.attempts += 1
    let teams: CrestTeams | null = null
    let linked: ReturnType<typeof findLinkedGame> = null
    try {
      linked = findLinkedGame(home, away, await options.listGames(), Date.now())
      teams = linked ? crestTeamsOf(linked) : null
    } catch {
      linked = null
    }
    const current = panels.get(panelId)
    if (!current || current.token !== token) return
    if (linked) options.onGame?.({ panelId, gameId: linked.game.id, reversed: linked.reversed })
    if (teams) {
      await send(panelId, token, teams)
    } else if (current.attempts < MAX_ATTEMPTS) {
      current.retryTimer = setTimeout(() => void resolve(panelId, home, away), RETRY_MS)
    }
  }

  /**
   * The panels' match names (and, from 365Scores, the teams themselves). Names already
   * handled are ignored, so calling this with every score update costs nothing.
   */
  function show(panelIds: readonly string[], home: string, away: string, teams?: CrestTeams) {
    if (!home || !away) return
    const key = `${home}|${away}`
    for (const panelId of panelIds) {
      if (panels.get(panelId)?.key === key) continue
      // Other teams: the old crests go at once, the new ones follow.
      clear(panelId)
      const entry: PanelEntry = { key, attempts: 0, token: ++serial }
      panels.set(panelId, entry)
      if (teams) void send(panelId, entry.token, teams)
      else void resolve(panelId, home, away)
    }
  }

  /** The panel left its match: drops its crests (`notify`: tells the UI too). */
  function clear(panelId: string, notify = true) {
    const entry = panels.get(panelId)
    if (!entry) return
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    panels.delete(panelId)
    options.onGame?.({ panelId, gameId: null, reversed: false })
    if (notify) options.onCrests({ panelId, home: null, away: null })
  }

  /** Windows closing: forgets every panel (downloaded crests stay cached). */
  function reset() {
    for (const entry of panels.values()) if (entry.retryTimer) clearTimeout(entry.retryTimer)
    panels.clear()
    prefetchQueue.length = 0
  }

  return { show, clear, prefetch, warm, reset }
}
