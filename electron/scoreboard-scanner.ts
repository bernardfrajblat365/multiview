import { BrowserWindow } from 'electron'
import {
  ALERT_INCIDENT_TYPES,
  createScannerState,
  detectMatchEnd,
  END_INCIDENT_TYPE,
  filterNew,
  type MatchIncident,
  type RawIncident,
  type ScannerState,
} from '../src/match-events'
import { logScanner } from './scanner-log'
import type { CrestTeams } from '../src/team-crests'

export type ScannerEvent = {
  eventId: string
  panelIds: string[]
  incident: MatchIncident
  teamName: string
  score: string
}

export type ScannerEnd = {
  eventId: string
  panelIds: string[]
  home: string
  away: string
  score: string
}

export type ScannerScore = {
  panelIds: string[]
  home: string
  away: string
  score: string
  /** 365Scores teams, for their crests; William Hill scores leave them out. */
  teams?: CrestTeams
}

type Scanner = {
  eventId: string
  label: string
  window: BrowserWindow
  panelIds: Set<string>
  state: ScannerState
  home: string
  away: string
  score: string
  /** Last home|away|score sent to the UI, so unchanged polls stay silent. */
  sentKey: string
  /** Score the board showed the last time it was in step with the goal alerts. */
  goalBaseline: string
  /** Score of the last goal alert while the board hasn't caught up with it yet, else null. */
  predictedScore: string | null
  hooked: boolean
  connected: boolean
  loadedAt: number
  lastMessageAt: number
  /** Page-side count of feed updates seen by the hook; resets to 0 on reload. */
  updates: number
  retries: number
  drainTimer: ReturnType<typeof setInterval>
  watchdogTimer: ReturnType<typeof setInterval>
  retryTimer?: ReturnType<typeof setTimeout>
  /** Goals whose scorer isn't known yet, by incident id. */
  scorers: Map<string, PendingScorer>
  destroyed: boolean
}

type PendingScorer = {
  incident: MatchIncident
  /** When the goal alert went out; the delays in the log count from here. */
  at: number
  lastFallbackAt: number
  fallbackBusy: boolean
}

const PARTITION = 'quadra-scoreboard'
const DRAIN_MS = 300
const WATCHDOG_MS = 15_000
const HOOK_GRACE_MS = 30_000
const SILENCE_RELOAD_MS = 10 * 60_000
const MAX_BACKOFF_MS = 60_000
/** A goal without a name from the line-up asks 365Scores after this, then again at this pace… */
const SCORER_FALLBACK_AFTER_MS = 5000
const SCORER_FALLBACK_EVERY_MS = 5000
/** …and the search for the scorer's name ends here. */
const SCORER_GIVE_UP_MS = 60_000
const ALLOWED_HOST = /(^|\.)(kwddw\.com|whcdn\.net|staticcache\.org)$/i

/**
 * Runs in the scoreboard page. Only reads the feed; it never sends anything out.
 * Every update replays the whole match (oldest first, ~500 items by the second half),
 * so only alert types are queued, once per id, or the newest ones would be cut off.
 */
const hookScript = `(() => {
  if (window.__quadraHooked) return true
  const S = window.WH && window.WH.scoreboard
  if (!S) return false
  const names = ['commentaries', 'animations', 'penalties', 'statistics']
  const types = new Set(${JSON.stringify(ALERT_INCIDENT_TYPES)})
  let wrapped = 0
  window.__quadraQueue = window.__quadraQueue || []
  window.__quadraSeen = window.__quadraSeen || new Set()
  window.__quadraShirts = window.__quadraShirts || {}
  for (const name of names) {
    const mod = S[name]
    if (!mod || typeof mod.acceptIncident !== 'function' || mod.__quadraWrapped) continue
    const original = mod.acceptIncident
    mod.acceptIncident = function (incidents) {
      try {
        window.__quadraUpdates = (window.__quadraUpdates || 0) + 1
        if (Array.isArray(incidents)) {
          for (const item of incidents) {
            if (item && item.type === ${JSON.stringify(END_INCIDENT_TYPE)} && !window.__quadraEndAt) window.__quadraEndAt = Date.parse(item.timestamp) || Date.now()
            // The shirt number may only show up on a later replay of the same goal.
            if (item && item.type === 'GOAL' && item.data && item.data.PLAYER) window.__quadraShirts[item.id] = item.data.PLAYER
            if (!item || !types.has(item.type) || window.__quadraSeen.has(item.id)) continue
            window.__quadraSeen.add(item.id)
            if (window.__quadraQueue.length < 400) {
              const named = (item.scorer && item.scorer.name) || (item.player && item.player.name) || ''
              window.__quadraQueue.push({ id: item.id, type: item.type, subType: item.subType, teamType: item.teamType, timestamp: item.timestamp, time: { duration: item.time && item.time.duration }, shirt: item.data && item.data.PLAYER, playerName: String(named).slice(0, 80) })
            }
          }
        }
      } catch (e) {}
      return original.apply(this, arguments)
    }
    mod.__quadraWrapped = true
    wrapped += 1
  }
  // Goal lists of the line-up carry the scorer's name, sometimes after the goal itself.
  const lineups = S.lineups
  if (lineups && typeof lineups.addEvents === 'function' && !lineups.__quadraWrapped) {
    const original = lineups.addEvents
    window.__quadraScorers = window.__quadraScorers || {}
    lineups.addEvents = function (type, events) {
      try {
        if (type === 'goals' && Array.isArray(events)) {
          for (const event of events) {
            const who = event && ((event.scorer && event.scorer.name) || (event.player && event.player.name))
            if (who && event.incidentId) window.__quadraScorers[event.incidentId] = String(who).slice(0, 80)
          }
        }
      } catch (e) {}
      return original.apply(this, arguments)
    }
    lineups.__quadraWrapped = true
  }
  if (wrapped > 0) window.__quadraHooked = true
  return wrapped > 0
})()`

/** Names for pending goals: the line-up goal list first, then the shirt number looked up in the line-up. */
const scorerScript = (items: Array<{ id: string; team: string; shirt: number }>) => `((items) => {
  const out = {}
  const lineups = window.WH && window.WH.scoreboard && window.WH.scoreboard.lineups
  const listed = window.__quadraScorers || {}
  const shirts = window.__quadraShirts || {}
  for (const item of items) {
    let name = listed[item.id] || ''
    const shirt = Number(item.shirt || shirts[item.id]) || 0
    if (!name && shirt && lineups && typeof lineups.getPlayerName === 'function') {
      try { name = lineups.getPlayerName(item.team, shirt) || '' } catch (e) {}
    }
    if (name) out[item.id] = String(name).slice(0, 80)
  }
  return out
})(${JSON.stringify(items)})`

const drainScript = `(() => {
  const queue = window.__quadraQueue || []
  window.__quadraQueue = []
  const lines = (document.body ? document.body.innerText : '').split('\\n').map((line) => line.trim()).filter(Boolean)
  const scoreIndex = lines.findIndex((line) => /^\\d+\\s*-\\s*\\d+$/.test(line))
  const D = window.WH && window.WH.scoreboard && window.WH.scoreboard.diffusion
  const stats = window.WH && window.WH.scoreboard && window.WH.scoreboard.statistics
  let period = ''
  try { period = stats && typeof stats.getPeriod === 'function' ? String(stats.getPeriod() || '') : '' } catch (e) {}
  return {
    hooked: Boolean(window.__quadraHooked),
    connected: Boolean(D && D.isConnected),
    updates: window.__quadraUpdates || 0,
    period: /^[A-Z_]{1,40}$/.test(period) ? period : '',
    endAt: Number(window.__quadraEndAt) || 0,
    queue,
    home: scoreIndex > 0 ? lines[scoreIndex - 1].slice(0, 80) : '',
    away: scoreIndex >= 0 && lines[scoreIndex + 1] ? lines[scoreIndex + 1].slice(0, 80) : '',
    score: scoreIndex >= 0 ? lines[scoreIndex].replace(/\\s+/g, ' ') : '',
  }
})()`

function scoreboardUrl(eventId: string) {
  const base = process.env.QUADRA_SCOREBOARD_URL ?? 'https://score.kwddw.com/scoreboards/app/football/index.html'
  const url = new URL(base)
  url.searchParams.set('eventId', eventId)
  url.searchParams.set('sport', 'football')
  url.searchParams.set('locale', 'pt-pt')
  return url.toString()
}

function isAllowedScoreboardUrl(value: string) {
  try {
    const url = new URL(value)
    if (process.env.QUADRA_SCOREBOARD_URL && url.origin === new URL(process.env.QUADRA_SCOREBOARD_URL).origin) return true
    return url.protocol === 'https:' && ALLOWED_HOST.test(url.hostname)
  } catch {
    return false
  }
}

export function createScoreboardScanners(options: {
  onEvent: (event: ScannerEvent) => void
  onScore?: (score: ScannerScore) => void
  /** The feed says the match is over; reported once per match. */
  onEnd?: (end: ScannerEnd) => void
  /** Fallback for goals the line-up gives no name for (365Scores). Null when it can't tell. */
  findScorer?: (query: { home: string; away: string; team: 'home' | 'away'; minute: number }) => Promise<string | null>
}) {
  const scanners = new Map<string, Scanner>()
  const panelToEvent = new Map<string, string>()

  function load(scanner: Scanner) {
    scanner.hooked = false
    scanner.connected = false
    scanner.loadedAt = Date.now()
    void scanner.window.loadURL(scoreboardUrl(scanner.eventId)).catch(() => {})
  }

  function scheduleReload(scanner: Scanner, reason: string) {
    if (scanner.destroyed || scanner.retryTimer) return
    const delay = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(scanner.retries, 4))
    scanner.retries += 1
    logScanner(`[${scanner.label}] ${reason}; reconectando em ${Math.round(delay / 1000)} s`, 'wh')
    scanner.retryTimer = setTimeout(() => {
      scanner.retryTimer = undefined
      if (!scanner.destroyed && !scanner.window.isDestroyed()) load(scanner)
    }, delay)
  }

  function publishScore(scanner: Scanner, panelIds: string[] = [...scanner.panelIds], force = false) {
    if (!scanner.score || panelIds.length === 0) return
    const key = `${scanner.home}|${scanner.away}|${scanner.score}`
    if (!force && key === scanner.sentKey) return
    scanner.sentKey = key
    options.onScore?.({ panelIds, home: scanner.home, away: scanner.away, score: scanner.score })
  }

  async function drain(scanner: Scanner) {
    if (scanner.destroyed || scanner.window.isDestroyed() || scanner.window.webContents.isLoading()) return
    const contents = scanner.window.webContents
    if (!scanner.hooked) {
      const ok = await contents.executeJavaScript(hookScript).catch(() => false)
      if (ok === true) {
        scanner.hooked = true
        scanner.retries = 0
        logScanner(`[${scanner.label}] scanner conectado (feed WH ${scanner.eventId})`, 'wh')
      }
    }
    const result = await contents.executeJavaScript(drainScript).catch(() => null) as {
      connected?: boolean
      updates?: number
      period?: string
      endAt?: number
      queue?: RawIncident[]
      home?: string
      away?: string
      score?: string
    } | null
    if (!result || scanner.destroyed) return
    scanner.connected = Boolean(result.connected)
    if (result.home) scanner.home = result.home
    if (result.away) scanner.away = result.away
    if (result.score) scanner.score = result.score
    publishScore(scanner)
    // Any feed update counts as alive, not only alert types, so quiet spells don't force reloads.
    const updates = Number(result.updates) || 0
    if (updates !== scanner.updates) {
      scanner.updates = updates
      scanner.lastMessageAt = Date.now()
    }
    const queue = Array.isArray(result.queue) ? result.queue : []
    if (queue.length > 0) emitIncidents(scanner, queue)
    syncGoalBaseline(scanner)
    await resolveScorers(scanner)
    const period = typeof result.period === 'string' ? result.period : ''
    if (detectMatchEnd(scanner.state, period, Number(result.endAt) || 0)) {
      logScanner(`[${scanner.label}] fim de jogo${period ? ` (${period})` : ''} ${scanner.score}`.trim(), 'wh')
      options.onEnd?.({ eventId: scanner.eventId, panelIds: [...scanner.panelIds], home: scanner.home, away: scanner.away, score: scanner.score })
    }
  }

  function emitIncidents(scanner: Scanner, queue: RawIncident[]) {
    const { fresh, ignored } = filterNew(scanner.state, queue)
    if (ignored > 0) logScanner(`[${scanner.label}] ${ignored} lance(s) do histórico ignorado(s)`, 'wh')
    for (const incident of fresh) sendIncident(scanner, incident, goalScore(scanner, incident))
  }

  /**
   * Looks for the name of every goal still without one: the line-up of the feed first (checked on each
   * pass), 365Scores if that hasn't answered after a few seconds. Only logs for now: the alerts don't wait for it.
   */
  async function resolveScorers(scanner: Scanner) {
    if (scanner.scorers.size === 0 || scanner.destroyed || scanner.window.isDestroyed()) return
    const now = Date.now()
    const items = [...scanner.scorers.entries()].map(([id, pending]) => ({ id, team: pending.incident.team.toUpperCase(), shirt: pending.incident.shirt ?? 0 }))
    const names = await scanner.window.webContents.executeJavaScript(scorerScript(items)).catch(() => null) as Record<string, string> | null
    for (const [id, pending] of [...scanner.scorers]) {
      const name = names?.[id]
      const waited = ((Date.now() - pending.at) / 1000).toFixed(1)
      if (typeof name === 'string' && name) {
        scanner.scorers.delete(id)
        logScanner(`[${scanner.label}] nome do gol ${pending.incident.minute}' ${teamOf(scanner, pending.incident)}: ${name} (escalação WH, ${waited} s depois do alerta)`, 'wh')
      } else if (now - pending.at >= SCORER_GIVE_UP_MS) {
        scanner.scorers.delete(id)
        const shirt = pending.incident.shirt ? `camisa ${pending.incident.shirt}` : 'sem camisa no feed'
        logScanner(`[${scanner.label}] sem nome para o gol ${pending.incident.minute}' ${teamOf(scanner, pending.incident)} (${shirt}; WH sem escalação; 365Scores não achou)`, 'wh')
      } else if (!pending.fallbackBusy && now - pending.at >= SCORER_FALLBACK_AFTER_MS && now - pending.lastFallbackAt >= SCORER_FALLBACK_EVERY_MS) {
        void askFallback(scanner, id, pending)
      }
    }
  }

  async function askFallback(scanner: Scanner, id: string, pending: PendingScorer) {
    const side = pending.incident.team
    if (!options.findScorer || side === 'match' || !scanner.home || !scanner.away) return
    pending.fallbackBusy = true
    pending.lastFallbackAt = Date.now()
    try {
      const name = await options.findScorer({ home: scanner.home, away: scanner.away, team: side, minute: pending.incident.minute })
      // The line-up may have answered while 365Scores was thinking: then it is already logged and gone.
      if (name && scanner.scorers.delete(id)) {
        const waited = ((Date.now() - pending.at) / 1000).toFixed(1)
        logScanner(`[${scanner.label}] nome do gol ${pending.incident.minute}' ${teamOf(scanner, pending.incident)}: ${name} (365Scores, ${waited} s depois do alerta)`, 'wh')
      }
    } catch {
      // 365Scores down or slow: the next round tries again until the time is up.
    } finally {
      pending.fallbackBusy = false
    }
  }

  function teamOf(scanner: Scanner, incident: MatchIncident) {
    return incident.team === 'home' ? scanner.home : incident.team === 'away' ? scanner.away : ''
  }

  /**
   * The feed can announce a goal before the board's text shows it. If the board hasn't moved,
   * the alert goes out at once with the last score plus this goal instead of waiting.
   */
  function goalScore(scanner: Scanner, incident: MatchIncident) {
    if (incident.kind !== 'goal') return scanner.score
    if (scanner.score !== scanner.goalBaseline) return scanner.score
    const base = /^(\d+)\s*-\s*(\d+)$/.exec(scanner.predictedScore ?? scanner.score)
    if (!base || incident.ownGoal || incident.team === 'match') return scanner.score
    const home = Number(base[1]) + (incident.team === 'home' ? 1 : 0)
    const away = Number(base[2]) + (incident.team === 'away' ? 1 : 0)
    scanner.predictedScore = `${home} - ${away}`
    return scanner.predictedScore
  }

  /** Once the board moves, it has caught up: later goals are predicted from it again. */
  function syncGoalBaseline(scanner: Scanner) {
    if (scanner.score === scanner.goalBaseline) return
    scanner.goalBaseline = scanner.score
    scanner.predictedScore = null
  }

  function sendIncident(scanner: Scanner, incident: MatchIncident, score: string) {
    const teamName = incident.team === 'home' ? scanner.home : incident.team === 'away' ? scanner.away : ''
    // Feed timestamp vs. now: includes the feed's own delay and any clock skew, so treat it as approximate.
    const lag = incident.timestamp > 0 ? ` (feed→app ~${Math.max(0, (Date.now() - incident.timestamp) / 1000).toFixed(1)} s)` : ''
    const who = incident.kind === 'goal' ? (incident.player ? ` — ${incident.player}` : incident.shirt ? ` — camisa ${incident.shirt}` : '') : ''
    logScanner(`[${scanner.label}] ${incident.kind.toUpperCase()} ${incident.team} ${incident.minute}' ${teamName}${who}${lag}`.trim(), 'wh')
    if (incident.kind === 'goal' && !incident.player && incident.team !== 'match') {
      scanner.scorers.set(incident.id, { incident, at: Date.now(), lastFallbackAt: 0, fallbackBusy: false })
    }
    options.onEvent({
      eventId: scanner.eventId,
      panelIds: [...scanner.panelIds],
      incident,
      teamName,
      score,
    })
  }

  function watchdog(scanner: Scanner) {
    if (scanner.destroyed || scanner.window.isDestroyed()) return
    const now = Date.now()
    if (scanner.window.webContents.isLoading()) return
    if (!scanner.hooked && now - scanner.loadedAt > HOOK_GRACE_MS) {
      scheduleReload(scanner, 'hook do feed ausente')
    } else if (scanner.hooked && !scanner.connected && now - scanner.loadedAt > HOOK_GRACE_MS) {
      scheduleReload(scanner, 'feed desconectado')
    } else if (scanner.hooked && scanner.lastMessageAt && now - scanner.lastMessageAt > SILENCE_RELOAD_MS) {
      scanner.lastMessageAt = now
      scheduleReload(scanner, 'sem lances há 10 min')
    }
  }

  function create(eventId: string, label: string): Scanner {
    const window = new BrowserWindow({
      show: false,
      width: 420,
      height: 700,
      skipTaskbar: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'user-gesture-required',
      },
    })
    const contents = window.webContents
    contents.setAudioMuted(true)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedScoreboardUrl(url)) event.preventDefault()
    })
    const scanner: Scanner = {
      eventId,
      label,
      window,
      panelIds: new Set(),
      state: createScannerState(Date.now()),
      home: '',
      away: '',
      score: '',
      sentKey: '',
      goalBaseline: '',
      predictedScore: null,
      hooked: false,
      connected: false,
      loadedAt: Date.now(),
      lastMessageAt: 0,
      updates: 0,
      retries: 0,
      scorers: new Map(),
      drainTimer: setInterval(() => void drain(scanner), DRAIN_MS),
      watchdogTimer: setInterval(() => watchdog(scanner), WATCHDOG_MS),
      destroyed: false,
    }
    contents.on('render-process-gone', (_event, details) => scheduleReload(scanner, `renderer encerrou (${details.reason})`))
    contents.on('unresponsive', () => scheduleReload(scanner, 'renderer sem resposta'))
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) scheduleReload(scanner, `falha ao carregar (${errorDescription})`)
    })
    window.on('closed', () => {
      scanner.destroyed = true
    })
    load(scanner)
    return scanner
  }

  function destroy(scanner: Scanner) {
    scanner.destroyed = true
    clearInterval(scanner.drainTimer)
    clearInterval(scanner.watchdogTimer)
    if (scanner.retryTimer) clearTimeout(scanner.retryTimer)
    if (!scanner.window.isDestroyed()) scanner.window.destroy()
    scanners.delete(scanner.eventId)
    logScanner(`[${scanner.label}] scanner encerrado (nenhum painel usa este jogo)`, 'wh')
  }

  function detach(panelId: string) {
    const eventId = panelToEvent.get(panelId)
    if (!eventId) return
    panelToEvent.delete(panelId)
    const scanner = scanners.get(eventId)
    if (!scanner) return
    scanner.panelIds.delete(panelId)
    if (scanner.panelIds.size === 0) destroy(scanner)
  }

  function attach(panelId: string, eventId: string, label: string) {
    if (panelToEvent.get(panelId) === eventId) return
    detach(panelId)
    let scanner = scanners.get(eventId)
    if (!scanner) {
      scanner = create(eventId, label)
      scanners.set(eventId, scanner)
    }
    scanner.panelIds.add(panelId)
    panelToEvent.set(panelId, eventId)
    // A panel joining a running scanner gets the current score right away.
    publishScore(scanner, [panelId], true)
    logScanner(`[${panelId}] painel vinculado ao jogo "${label}" (WH ${eventId})`, 'wh')
  }

  function destroyAll() {
    for (const scanner of [...scanners.values()]) destroy(scanner)
    panelToEvent.clear()
  }

  return { attach, detach, destroyAll, size: () => scanners.size }
}
