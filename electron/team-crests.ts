import { net } from 'electron'
import type { Game365, TeamRef365 } from '../src/livescore-365'
import { crestKey, crestUrl, findCrestTeams, liveTeams, type CrestTeams } from '../src/team-crests'

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
const FETCH_TIMEOUT_MS = 8000
const MAX_IMAGE_BYTES = 200_000
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif)$/i
/** ~3–7 KB each: a few hundred crests stay well under a few MB. */
const MAX_CACHED = 500
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
}) {
  const images = new Map<string, Promise<string | null>>()
  const panels = new Map<string, PanelEntry>()
  const prefetchQueue: TeamRef365[] = []
  let prefetching = 0
  let serial = 0

  async function download(team: TeamRef365): Promise<string | null> {
    const response = await net.fetch(crestUrl(team, IMAGE_BASE_URL), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    // 404: the team has no crest. Kept as null so it isn't asked again.
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!IMAGE_TYPE.test(type)) return null
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0 || body.length > MAX_IMAGE_BYTES) return null
    return `data:${type.toLowerCase()};base64,${body.toString('base64')}`
  }

  function image(team: TeamRef365): Promise<string | null> {
    const key = crestKey(team)
    const cached = images.get(key)
    if (cached) return cached
    const pending = download(team).catch(() => {
      // A network error may pass: forget it so the next ask tries again.
      images.delete(key)
      return null
    })
    images.set(key, pending)
    if (images.size > MAX_CACHED) images.delete(images.keys().next().value as string)
    return pending
  }

  function pumpPrefetch() {
    while (prefetching < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
      const team = prefetchQueue.shift()!
      if (images.has(crestKey(team))) continue
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
      if (!images.has(crestKey(team))) prefetchQueue.push(team)
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
    try {
      teams = findCrestTeams(home, away, await options.listGames(), Date.now())
    } catch {
      teams = null
    }
    const current = panels.get(panelId)
    if (!current || current.token !== token) return
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
