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
  parseRedCards,
  DETAIL_TIMEOUT_MS,
  detailTimeoutMs,
  retryDelayMs,
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
  /** When the current run of failures started, for the "back" line. */
  failingSince: number
  lastPbpAt: number
  timer?: ReturnType<typeof setTimeout>
  stopped: boolean
}

const BASE_URL = process.env.QUADRA_365SCORES_URL ?? 'https://webws.365scores.com'
const COMMON_PARAMS = { appTypeId: '5', langId: '31', timezoneName: 'America/Sao_Paulo', userCountryId: '21' }
/** Games lists are large (a busy day passes 1 MB); the game detail has its own, shorter limit. */
const FETCH_TIMEOUT_MS = 8000
/** The API's CDN caches live responses for 3 s; polling faster only returns the same body. */
const POLL_MS = 3000
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

class HttpError extends Error {}

async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new HttpError(`HTTP ${response.status}`)
  return response.json()
}

/** "23/10/2026" in Brazil, the date the day schedule is asked for. */
function brazilDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')}`
}

/** Hour of the day in Brazil. */
function brazilHour(now: Date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now))
}

/** Until 4 a.m. a game that started last night is still on: ask for yesterday's schedule too. */
const LATE_NIGHT_HOUR = 4

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
      const now = new Date()
      const today = brazilDate(now)
      const startDate = brazilHour(now) < LATE_NIGHT_HOUR ? brazilDate(new Date(now.getTime() - 24 * 3600_000)) : today
      const [current, schedule] = await Promise.allSettled([
        fetchJson(apiUrl('/web/games/current/', { sports: '1' })),
        fetchJson(apiUrl('/web/games/allscores/', { sports: '1', startDate, endDate: today, showOdds: 'false' })),
      ])
      if (current.status === 'rejected' && schedule.status === 'rejected') throw current.reason
      const games = mergeGameLists(
        current.status === 'fulfilled' ? parseGameList(current.value) : [],
        schedule.status === 'fulfilled' ? parseGameList(schedule.value) : [],
      )
      if (schedule.status === 'rejected') logScanner(`365Scores: agenda do dia indisponível (${schedule.reason instanceof Error ? schedule.reason.message : 'erro'}); só os ${games.length} jogos ao vivo da lista curta`, '365')
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

  /** `fromCommentary`: the alert came from the live commentary, not from the game's events or score. */
  function emit(poller: Poller, incidents: MatchIncident[], fromCommentary = false) {
    for (const incident of dropRepeatedVar(poller.state, incidents)) {
      const teamName = incident.team === 'home' ? poller.home : incident.team === 'away' ? poller.away : ''
      logScanner(`[${poller.label}] ${incident.kind.toUpperCase()} ${incident.team} ${incident.minute}' ${teamName}${incident.note ? ` (${incident.note})` : ''}${fromCommentary ? ' · narração' : ''}`, '365')
      options.onEvent({
        panelIds: [...poller.panelIds],
        incident,
        teamName,
        score: poller.score,
        label: alertLabel(incident.kind, teamName, incident.minute),
      })
    }
  }

  function fail(poller: Poller, reason: string, kind: 'stall' | 'http') {
    if (poller.failures === 0) poller.failingSince = Date.now()
    poller.failures += 1
    const delay = retryDelayMs(poller.failures, kind)
    logScanner(`[${poller.label}] 365Scores falhou (${reason}); ${delay === 0 ? 'tentando de novo agora' : `tentando em ${Math.round(delay / 1000)} s`}`, '365')
    schedulePoll(poller, delay)
  }

  async function poll(poller: Poller) {
    poller.timer = undefined
    let raw: unknown
    const timeoutMs = detailTimeoutMs(poller.failures)
    try {
      raw = await fetchJson(apiUrl('/web/game/', { gameId: String(poller.gameId) }), timeoutMs)
    } catch (error) {
      if (poller.stopped) return
      const reason = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? `sem resposta em ${timeoutMs / 1000} s`
        : error instanceof Error ? error.message : 'erro'
      fail(poller, reason, error instanceof HttpError ? 'http' : 'stall')
      return
    }
    if (poller.stopped) return
    const detail = parseGameDetail(raw)
    if (!detail || detail.id !== poller.gameId) {
      fail(poller, 'resposta sem o jogo', 'http')
      return
    }
    if (poller.failures > 0) {
      const seconds = Math.round((Date.now() - poller.failingSince) / 1000)
      logScanner(`[${poller.label}] 365Scores voltou a responder após ${poller.failures} falha(s) (${seconds} s sem dados)`, '365')
    }
    poller.failures = 0
    if (!detail.events) {
      // Without events the red cards come from the red-card count, which only the games list carries.
      try {
        const reds = parseRedCards(await fetchJson(apiUrl('/web/games/', { games: String(poller.gameId) }), DETAIL_TIMEOUT_MS), poller.gameId)
        if (reds) {
          detail.home.redCards = reds.home
          detail.away.redCards = reds.away
        }
      } catch {
        // Keeps the last count: a failed read only delays a red card to the next round.
        detail.home.redCards = poller.state.homeRed
        detail.away.redCards = poller.state.awayRed
      }
      if (poller.stopped) return
    }
    poller.home = detail.home.name
    poller.away = detail.away.name
    poller.score = `${detail.home.score} - ${detail.away.score}`
    publishScore(poller)
    const coverage = detail.events ? 'events' : 'score'
    if (coverage !== poller.coverage) {
      poller.coverage = coverage
      for (const panelId of poller.panelIds) sendStatus(panelId, { status: 'linked', label: poller.label, coverage })
      logScanner(`[${poller.label}] 365Scores ${coverage === 'events' ? 'com lances (gols, cartões, VAR)' : 'sem lances por enquanto (gols pelo placar, vermelhos pela contagem)'}`, '365')
    }
    emit(poller, diffDetail(poller.state, detail, Date.now()))
    if (detail.pbpUrl && Date.now() - poller.lastPbpAt >= PBP_POLL_MS) {
      poller.lastPbpAt = Date.now()
      try {
        const messages = parsePbpFeed(await fetchJson(detail.pbpUrl, DETAIL_TIMEOUT_MS))
        if (!poller.stopped) emit(poller, diffPbp(poller.state, messages, detail), true)
      } catch {
        // The commentary is a bonus (penalty awarded, VAR): a failed read waits for the next round.
      }
    }
    if (detail.statusGroup === 4) {
      logScanner(`[${poller.label}] jogo encerrado (${poller.score}); 365Scores parou de consultar`, '365')
      poller.stopped = true
      return
    }
    schedulePoll(poller, POLL_MS)
  }

  function stopPoller(poller: Poller) {
    poller.stopped = true
    if (poller.timer) clearTimeout(poller.timer)
    pollers.delete(poller.gameId)
    logScanner(`[${poller.label}] 365Scores encerrado (nenhum painel usa este jogo)`, '365')
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
      poller = { gameId: game.id, label, panelIds: new Set(), state: createLiveState(), coverage: null, sentKey: '', home: '', away: '', score: '', failures: 0, failingSince: 0, lastPbpAt: 0, stopped: false }
      pollers.set(game.id, poller)
      schedulePoll(poller, 0)
    }
    poller.panelIds.add(panelId)
    sendStatus(panelId, { status: 'linked', label, coverage: poller.coverage })
    publishScore(poller, [panelId], true)
    logScanner(`[${panelId}] painel vinculado ao jogo "${label}" (365Scores ${game.id})`, '365')
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
      logScanner(`[${panelId}] 365Scores: ${result.candidates.length} jogo(s) possível(is) para "${current.title}"; aguardando escolha`, '365')
    } else {
      sendStatus(panelId, { status: 'none' })
      if (current.attempts < MAX_ATTEMPTS) current.retryTimer = setTimeout(() => void resolve(panelId), RETRY_MS)
      logScanner(`[${panelId}] 365Scores: nenhum jogo para "${current.title}"${current.attempts < MAX_ATTEMPTS ? '; tentando de novo em 2 min' : ''}`, '365')
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
    logScanner(`[${panelId}] 365Scores: usuário disse que nenhum jogo corresponde`, '365')
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
