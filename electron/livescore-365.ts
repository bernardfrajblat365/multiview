import { net } from 'electron'
import {
  candidateOf,
  createLiveState,
  diffDetail,
  diffPbp,
  dropRepeatedVar,
  matchGame,
  mergeGameLists,
  parseGameDetail,
  parseGameList,
  parsePbpFeed,
  sourceKeyOf,
  type Game365,
  type LiveMatchStatus,
  type LiveState,
} from '../src/livescore-365'
import { alertLabel, type MatchIncident } from '../src/match-events'
import { logScanner } from './scanner-log'
import type { ScannerScore } from './scoreboard-scanner'

export type LiveEvent = { panelIds: string[]; incident: MatchIncident; teamName: string; score: string; label: string }

type PanelLink = {
  /** YouTube video id, or the player path of a BLL panel without a William Hill feed. */
  sourceKey: string
  title: string
  gameId: number | null
  candidates: Game365[]
  attempts: number
  retryTimer?: ReturnType<typeof setTimeout>
  /** Bumped on every new resolve so a late list response for an old title is dropped. */
  token: number
}

type Poller = {
  gameId: number
  label: string
  panelIds: Set<string>
  state: LiveState
  coverage: 'events' | 'score' | null
  sentKey: string
  home: string
  away: string
  score: string
  failures: number
  lastPbpAt: number
  timer?: ReturnType<typeof setTimeout>
  stopped: boolean
}

const BASE_URL = process.env.QUADRA_365SCORES_URL ?? 'https://webws.365scores.com'
const COMMON_PARAMS = { appTypeId: '5', langId: '31', timezoneName: 'America/Sao_Paulo', userCountryId: '21' }
const FETCH_TIMEOUT_MS = 8000
/** The API's CDN caches live responses for 3 s; polling faster only returns the same body. */
const POLL_MS = 3000
const MAX_BACKOFF_MS = 60_000
/** The commentary is cached up to 15 s upstream; every 5 s is enough to catch a penalty or a VAR call early. */
const PBP_POLL_MS = 5000
const LIST_CACHE_MS = 30_000
/** A game missing from today's list may start later or be named differently: look again a few times. */
const RETRY_MS = 120_000
const MAX_ATTEMPTS = 5

function apiUrl(path: string, params: Record<string, string>) {
  const url = new URL(path, BASE_URL)
  url.search = new URLSearchParams({ ...COMMON_PARAMS, ...params }).toString()
  return url.toString()
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** "23/10/2026" in Brazil, the date the day schedule is asked for. */
function brazilDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')}`
}

export function createLiveScoreLinker(options: {
  onEvent: (event: LiveEvent) => void
  onScore: (score: ScannerScore) => void
  onStatus: (status: LiveMatchStatus) => void
}) {
  const links = new Map<string, PanelLink>()
  const pollers = new Map<number, Poller>()
  let listCache: { at: number; games: Game365[] } | null = null
  let listPending: Promise<Game365[]> | null = null
  let serial = 0

  /** Live games plus today's schedule: the live list alone stops at 100 games. */
  function listGames(): Promise<Game365[]> {
    if (listCache && Date.now() - listCache.at < LIST_CACHE_MS) return Promise.resolve(listCache.games)
    listPending ??= (async () => {
      const today = brazilDate(new Date())
      const [current, schedule] = await Promise.allSettled([
        fetchJson(apiUrl('/web/games/current/', { sports: '1' })),
        fetchJson(apiUrl('/web/games/allscores/', { sports: '1', startDate: today, endDate: today, showOdds: 'false' })),
      ])
      if (current.status === 'rejected' && schedule.status === 'rejected') throw current.reason
      const games = mergeGameLists(
        current.status === 'fulfilled' ? parseGameList(current.value) : [],
        schedule.status === 'fulfilled' ? parseGameList(schedule.value) : [],
      )
      listCache = { at: Date.now(), games }
      return games
    })().finally(() => { listPending = null })
    return listPending
  }

  function sendStatus(panelId: string, status: Omit<LiveMatchStatus, 'panelId'>) {
    options.onStatus({ panelId, ...status })
  }

  function publishScore(poller: Poller, panelIds: string[] = [...poller.panelIds], force = false) {
    if (!poller.score || panelIds.length === 0) return
    const key = `${poller.home}|${poller.away}|${poller.score}`
    if (!force && key === poller.sentKey) return
    poller.sentKey = key
    options.onScore({ panelIds, home: poller.home, away: poller.away, score: poller.score })
  }

  function schedulePoll(poller: Poller, delay: number) {
    if (poller.stopped) return
    poller.timer = setTimeout(() => void poll(poller), delay)
  }

  function emit(poller: Poller, incidents: MatchIncident[], source: string) {
    for (const incident of dropRepeatedVar(poller.state, incidents)) {
      const teamName = incident.team === 'home' ? poller.home : incident.team === 'away' ? poller.away : ''
      logScanner(`[${poller.label}] ${incident.kind.toUpperCase()} ${incident.team} ${incident.minute}' ${teamName}${incident.note ? ` (${incident.note})` : ''} [${source}]`)
      options.onEvent({
        panelIds: [...poller.panelIds],
        incident,
        teamName,
        score: poller.score,
        label: alertLabel(incident.kind, teamName, incident.minute),
      })
    }
  }

  async function poll(poller: Poller) {
    poller.timer = undefined
    let raw: unknown
    try {
      raw = await fetchJson(apiUrl('/web/game/', { gameId: String(poller.gameId) }))
    } catch (error) {
      if (poller.stopped) return
      poller.failures += 1
      const delay = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(poller.failures, 5))
      logScanner(`[${poller.label}] 365Scores falhou (${error instanceof Error ? error.message : 'erro'}); tentando em ${Math.round(delay / 1000)} s`)
      schedulePoll(poller, delay)
      return
    }
    if (poller.stopped) return
    const detail = parseGameDetail(raw)
    if (!detail || detail.id !== poller.gameId) {
      poller.failures += 1
      schedulePoll(poller, Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(poller.failures, 5)))
      return
    }
    poller.failures = 0
    poller.home = detail.home.name
    poller.away = detail.away.name
    poller.score = `${detail.home.score} - ${detail.away.score}`
    publishScore(poller)
    const coverage = detail.events ? 'events' : 'score'
    if (coverage !== poller.coverage) {
      poller.coverage = coverage
      for (const panelId of poller.panelIds) sendStatus(panelId, { status: 'linked', label: poller.label, coverage })
      logScanner(`[${poller.label}] 365Scores ${coverage === 'events' ? 'com lances (gols, cartões, VAR)' : 'só placar (liga sem lances)'}`)
    }
    emit(poller, diffDetail(poller.state, detail), '365')
    if (detail.pbpUrl && Date.now() - poller.lastPbpAt >= PBP_POLL_MS) {
      poller.lastPbpAt = Date.now()
      try {
        const messages = parsePbpFeed(await fetchJson(detail.pbpUrl))
        if (!poller.stopped) emit(poller, diffPbp(poller.state, messages, detail), '365 narração')
      } catch {
        // The commentary is a bonus (penalty awarded, VAR): a failed read waits for the next round.
      }
    }
    if (detail.statusGroup === 4) {
      logScanner(`[${poller.label}] jogo encerrado (${poller.score}); 365Scores parou de consultar`)
      poller.stopped = true
      return
    }
    schedulePoll(poller, POLL_MS)
  }

  function stopPoller(poller: Poller) {
    poller.stopped = true
    if (poller.timer) clearTimeout(poller.timer)
    pollers.delete(poller.gameId)
    logScanner(`[${poller.label}] 365Scores encerrado (nenhum painel usa este jogo)`)
  }

  function unlink(panelId: string) {
    const link = links.get(panelId)
    if (!link) return
    if (link.retryTimer) clearTimeout(link.retryTimer)
    links.delete(panelId)
    if (link.gameId === null) return
    const poller = pollers.get(link.gameId)
    if (!poller) return
    poller.panelIds.delete(panelId)
    if (poller.panelIds.size === 0) stopPoller(poller)
  }

  function link(panelId: string, game: Game365) {
    const entry = links.get(panelId)
    if (!entry) return
    entry.gameId = game.id
    entry.candidates = []
    const label = `${game.home} x ${game.away}`
    let poller = pollers.get(game.id)
    if (!poller) {
      poller = { gameId: game.id, label, panelIds: new Set(), state: createLiveState(), coverage: null, sentKey: '', home: '', away: '', score: '', failures: 0, lastPbpAt: 0, stopped: false }
      pollers.set(game.id, poller)
      schedulePoll(poller, 0)
    }
    poller.panelIds.add(panelId)
    sendStatus(panelId, { status: 'linked', label, coverage: poller.coverage })
    publishScore(poller, [panelId], true)
    logScanner(`[${panelId}] painel vinculado ao jogo "${label}" (365Scores ${game.id})`)
  }

  async function resolve(panelId: string) {
    const entry = links.get(panelId)
    if (!entry) return
    const token = ++serial
    entry.token = token
    entry.attempts += 1
    sendStatus(panelId, { status: 'searching' })
    let games: Game365[]
    try {
      games = await listGames()
    } catch {
      games = []
    }
    const current = links.get(panelId)
    if (!current || current.token !== token) return
    const result = matchGame(current.title, games, Date.now())
    if (result.status === 'matched') {
      link(panelId, result.game)
    } else if (result.status === 'ambiguous') {
      current.candidates = result.candidates
      sendStatus(panelId, { status: 'ambiguous', candidates: result.candidates.map(candidateOf) })
      logScanner(`[${panelId}] 365Scores: ${result.candidates.length} jogo(s) possível(is) para "${current.title}"; aguardando escolha`)
    } else {
      sendStatus(panelId, { status: 'none' })
      if (current.attempts < MAX_ATTEMPTS) current.retryTimer = setTimeout(() => void resolve(panelId), RETRY_MS)
      logScanner(`[${panelId}] 365Scores: nenhum jogo para "${current.title}"${current.attempts < MAX_ATTEMPTS ? '; tentando de novo em 2 min' : ''}`)
    }
  }

  /**
   * Called with every title of a YouTube watch page, and with the match name of a BLL player
   * that has no William Hill feed; a new video/player or a title that names other teams starts over.
   */
  function consider(panelId: string, url: string, title: string) {
    const sourceKey = sourceKeyOf(url)
    const existing = links.get(panelId)
    if (existing && existing.sourceKey === sourceKey && (existing.gameId !== null || existing.title === title)) return
    unlink(panelId)
    if (!sourceKey || !matchTitle(title)) {
      sendStatus(panelId, { status: 'off' })
      return
    }
    links.set(panelId, { sourceKey, title, gameId: null, candidates: [], attempts: 0, token: 0 })
    void resolve(panelId)
  }

  /** The user picked one of the candidates, or `null` for "none of these". */
  function choose(panelId: string, gameId: number | null) {
    const entry = links.get(panelId)
    if (!entry || entry.gameId !== null) return
    const game = gameId === null ? undefined : entry.candidates.find((candidate) => candidate.id === gameId)
    if (game) {
      link(panelId, game)
      return
    }
    if (gameId !== null) return
    entry.candidates = []
    entry.attempts = MAX_ATTEMPTS
    sendStatus(panelId, { status: 'off' })
    logScanner(`[${panelId}] 365Scores: usuário disse que nenhum jogo corresponde`)
  }

  function detach(panelId: string) {
    if (!links.has(panelId)) return
    unlink(panelId)
    sendStatus(panelId, { status: 'off' })
  }

  function destroyAll() {
    for (const panelId of [...links.keys()]) unlink(panelId)
    for (const poller of [...pollers.values()]) stopPoller(poller)
  }

  return { consider, choose, detach, destroyAll, size: () => pollers.size }
}

/** Cheap pre-check so pages without "A x B" in the title never hit the API. */
function matchTitle(title: string) {
  return /\S\s+(?:x|×|vs\.?|v)\s+\S/i.test(title)
}
