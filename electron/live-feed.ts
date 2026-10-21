import { BrowserWindow, session } from 'electron'
import {
  IncidentTracker,
  collectFeedUpdates,
  decodeFeedFrame,
  type AlertKind,
  type AlertTeam,
  type FeedUpdates,
  type PanelAlert,
} from './feed-protocol'

export type FeedAlertPayload = {
  panelId: string
  kind: AlertKind
  team: AlertTeam
  label: string
  incidentId: string
}

export type FeedManager = {
  attach: (panelId: string, eventId: string) => void
  detach: (panelId: string) => void
  dispose: () => void
}

type FeedManagerOptions = {
  onAlert: (alert: FeedAlertPayload) => void
  maxFeeds?: number
  scoreboardUrlTemplate?: string
  stallMs?: number
}

type FeedSession = {
  eventId: string
  window: BrowserWindow
  tracker: IncidentTracker
  panelIds: Set<string>
  lastFrameAt: number
  lastDataAt: number
  frameCount: number
  dataCount: number
  alertCount: number
  baselined: boolean
  lastLoggedScore: string | null
  stallTimer?: ReturnType<typeof setInterval>
  scorePollTimer?: ReturnType<typeof setInterval>
  reloadAttempts: number
  reloadTimer?: ReturnType<typeof setTimeout>
  diffusionRequestIds: Set<string>
  disposed: boolean
}

const DEFAULT_SCOREBOARD =
  'https://score.kwddw.com/scoreboards/app/football/index.html?eventId={eventId}&sport=football&locale=pt-pt'
const DEFAULT_MAX_FEEDS = 18
const DEFAULT_STALL_MS = 60_000
/** Reload when only keepalives arrive and score/incidents go quiet (zombie WS). */
const DEFAULT_DATA_STALL_MS = 90_000
/** One-line status for all active feeds so quiet matches still look "alive". */
const SCAN_STATUS_MS = 20_000
/** DOM score backup poll — catches goals within ~1s even if a WS frame was missed. */
const SCORE_POLL_MS = 1_000

/** Read the main football scoreboard score from the visible page text ("1 - 0"). */
const READ_SCOREBOARD_SCORE_SCRIPT = `(() => {
  const text = (document.body && document.body.innerText) || ''
  const match = text.match(/(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})/)
  if (!match) return null
  const home = Number(match[1])
  const away = Number(match[2])
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
})()`

function feedStamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Prefixed live-feed console helper so terminal lines show local wall-clock time. */
export function logLiveFeed(level: 'info' | 'warn', message: string, ...args: unknown[]): void {
  const line = `[${feedStamp()}] [live-feed] ${message}`
  if (level === 'warn') console.warn(line, ...args)
  else console.info(line, ...args)
}
const DIFFUSION_RE = /score\.kwddw\.com\/diffusion/i
const EVENT_ID_RE = /^\d{5,12}$/

function normalizeEventId(value: string) {
  const trimmed = value.trim()
  return EVENT_ID_RE.test(trimmed) ? trimmed : null
}

function resolveScoreboardUrl(template: string, eventId: string) {
  if (template.includes('{eventId}')) return template.replaceAll('{eventId}', eventId)
  const url = new URL(template)
  url.searchParams.set('eventId', eventId)
  return url.toString()
}

function allowedScoreboardOrigin(template: string) {
  try {
    return new URL(template.replaceAll('{eventId}', '0')).origin
  } catch {
    return 'https://score.kwddw.com'
  }
}

export function createFeedManager(options: FeedManagerOptions): FeedManager {
  const maxFeeds = options.maxFeeds ?? DEFAULT_MAX_FEEDS
  const scoreboardTemplate =
    options.scoreboardUrlTemplate ??
    process.env.QUADRA_FEED_SCOREBOARD_URL ??
    DEFAULT_SCOREBOARD
  const stallMs =
    options.stallMs ??
    (Number(process.env.QUADRA_FEED_STALL_MS) > 0
      ? Number(process.env.QUADRA_FEED_STALL_MS)
      : DEFAULT_STALL_MS)
  const dataStallMs =
    Number(process.env.QUADRA_FEED_DATA_STALL_MS) > 0
      ? Number(process.env.QUADRA_FEED_DATA_STALL_MS)
      : DEFAULT_DATA_STALL_MS
  const allowedOrigin = allowedScoreboardOrigin(scoreboardTemplate)

  const sessions = new Map<string, FeedSession>()
  const panelToEvent = new Map<string, string>()
  let disposed = false
  let statusTimer: ReturnType<typeof setInterval> | undefined

  const emitAlerts = (session: FeedSession, alerts: PanelAlert[]) => {
    if (!alerts.length) return
    session.alertCount += alerts.length
    for (const panelId of session.panelIds) {
      for (const alert of alerts) {
        logLiveFeed(
          'info',
          `alert panel=${panelId} event=${session.eventId} kind=${alert.kind} id=${alert.incidentId}`,
        )
        options.onAlert({
          panelId,
          kind: alert.kind,
          team: alert.team,
          label: alert.label,
          incidentId: alert.incidentId,
        })
      }
    }
  }

  const logScanStatus = () => {
    if (disposed || sessions.size === 0) return
    const nowTick = Date.now()
    const parts: string[] = []
    for (const session of sessions.values()) {
      const dataAge = Math.round((nowTick - session.lastDataAt) / 1000)
      const score = session.lastLoggedScore ?? (session.baselined ? '?' : 'wait')
      parts.push(
        `${session.eventId}=${score} data=${dataAge}s frames=${session.frameCount} alerts=${session.alertCount}`,
      )
    }
    logLiveFeed('info', `scanning ${sessions.size} feed(s) | ${parts.join(' | ')}`)
  }

  const ensureStatusTimer = () => {
    if (statusTimer || disposed) return
    statusTimer = setInterval(() => logScanStatus(), SCAN_STATUS_MS)
  }

  const stopStatusTimerIfIdle = () => {
    if (sessions.size > 0 || !statusTimer) return
    clearInterval(statusTimer)
    statusTimer = undefined
  }

  const ingestUpdates = (session: FeedSession, updates: FeedUpdates, source: 'ws' | 'poll') => {
    if (session.disposed) return
    if (!updates.incidents.length && !updates.score) return
    session.lastDataAt = Date.now()
    session.dataCount += 1
    if (!session.baselined) {
      logLiveFeed(
        'info',
        `baseline event=${session.eventId} incidents=${updates.incidents.length} score=${
          updates.score ? `${updates.score.home}-${updates.score.away}` : 'none'
        } via=${source}`,
      )
      session.baselined = true
      if (updates.score) {
        session.lastLoggedScore = `${updates.score.home}-${updates.score.away}`
      }
    } else if (updates.score) {
      const key = `${updates.score.home}-${updates.score.away}`
      if (session.lastLoggedScore !== key) {
        logLiveFeed('info', `score event=${session.eventId} ${key} via=${source}`)
        session.lastLoggedScore = key
      }
    }
    const alerts = session.tracker.ingest(updates)
    emitAlerts(session, alerts)
  }

  const handleFrame = (session: FeedSession, payloadData: string) => {
    if (session.disposed) return
    session.lastFrameAt = Date.now()
    session.frameCount += 1
    const decoded = decodeFeedFrame(payloadData)
    if (!decoded) return
    const updates = collectFeedUpdates(decoded, session.eventId)
    ingestUpdates(session, updates, 'ws')
  }

  const pollScoreboardScore = async (session: FeedSession) => {
    if (session.disposed || session.window.isDestroyed()) return
    const raw = await session.window.webContents
      .executeJavaScript(READ_SCOREBOARD_SCORE_SCRIPT, true)
      .catch(() => null)
    if (session.disposed || !raw || typeof raw !== 'object') return
    const home = Number((raw as { home?: unknown }).home)
    const away = Number((raw as { away?: unknown }).away)
    if (!Number.isFinite(home) || !Number.isFinite(away)) return
    const key = `${home}-${away}`
    if (session.lastLoggedScore === key) {
      // DOM still matches last known score — connection is alive enough to refresh data age.
      session.lastDataAt = Date.now()
      return
    }
    // Ignore stale DOM that lags behind WS (would look like a score drop / false VAR).
    if (session.lastLoggedScore) {
      const [prevHome, prevAway] = session.lastLoggedScore.split('-').map(Number)
      if (
        Number.isFinite(prevHome) &&
        Number.isFinite(prevAway) &&
        (home < prevHome || away < prevAway)
      ) {
        return
      }
    }
    ingestUpdates(session, { incidents: [], score: { home, away } }, 'poll')
  }

  const destroySession = (eventId: string) => {
    const sessionState = sessions.get(eventId)
    if (!sessionState) return
    sessionState.disposed = true
    if (sessionState.stallTimer) clearInterval(sessionState.stallTimer)
    if (sessionState.scorePollTimer) clearInterval(sessionState.scorePollTimer)
    if (sessionState.reloadTimer) clearTimeout(sessionState.reloadTimer)
    try {
      if (!sessionState.window.isDestroyed()) {
        const { debugger: dbg } = sessionState.window.webContents
        if (dbg.isAttached()) dbg.detach()
        sessionState.window.destroy()
      }
    } catch {
      // ignore teardown races
    }
    sessions.delete(eventId)
    stopStatusTimerIfIdle()
  }

  const scheduleReload = (session: FeedSession, reason: string) => {
    if (session.disposed || session.reloadTimer) return
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(session.reloadAttempts, 4))
    session.reloadAttempts += 1
    logLiveFeed('warn', `reload ${session.eventId} after ${reason} in ${delay}ms`)
    session.reloadTimer = setTimeout(() => {
      session.reloadTimer = undefined
      if (session.disposed || session.window.isDestroyed()) return
      // New page load creates a new Diffusion WS; drop stale CDP request ids so frames
      // are not filtered out before Network.webSocketCreated arrives.
      session.diffusionRequestIds.clear()
      void session.window.loadURL(resolveScoreboardUrl(scoreboardTemplate, session.eventId)).catch(() => {})
    }, delay)
  }

  const attachDebugger = (session: FeedSession) => {
    const contents = session.window.webContents
    const dbg = contents.debugger
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3')
      } catch (error) {
        logLiveFeed('warn', 'debugger attach failed', error)
        return
      }
    }

    // Network.enable often hangs before first navigation; fire-and-forget so frames still arrive.
    void dbg.sendCommand('Network.enable', {
      maxResourceBufferSize: 5_000_000,
      maxTotalBufferSize: 20_000_000,
    }).catch(() => {})

    dbg.removeAllListeners('message')
    dbg.on('message', (_event, method, params) => {
      if (session.disposed) return
      if (method === 'Network.webSocketCreated') {
        const url = typeof params.url === 'string' ? params.url : ''
        const requestId = typeof params.requestId === 'string' ? params.requestId : ''
        if (requestId && DIFFUSION_RE.test(url)) {
          session.diffusionRequestIds.add(requestId)
          logLiveFeed('info', `ws connected event=${session.eventId}`)
        }
        return
      }
      if (method === 'Network.webSocketFrameReceived') {
        // Do not drop frames by stale CDP requestId after reload — topic filter in
        // collectFeedUpdates already ignores other events. Quiet matches must keep listening.
        const payload = params.response?.payloadData
        if (typeof payload !== 'string' || !payload) return
        // Text/JSON keepalives are short; binary CBOR frames are base64 and larger.
        if (payload.length < 40) return
        handleFrame(session, payload)
      }
    })
  }

  const createSession = (eventId: string): FeedSession | null => {
    if (sessions.size >= maxFeeds) {
      logLiveFeed('warn', `max feeds (${maxFeeds}) reached; skipping ${eventId}`)
      return null
    }

    const feedSession = session.fromPartition('quadra-feed')
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 420,
      height: 720,
      webPreferences: {
        session: feedSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    win.setMenuBarVisibility(false)
    win.webContents.audioMuted = true
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      try {
        if (new URL(url).origin !== allowedOrigin) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })

    const now = Date.now()
    const state: FeedSession = {
      eventId,
      window: win,
      tracker: new IncidentTracker(),
      panelIds: new Set(),
      lastFrameAt: now,
      lastDataAt: now,
      frameCount: 0,
      dataCount: 0,
      alertCount: 0,
      baselined: false,
      lastLoggedScore: null,
      reloadAttempts: 0,
      diffusionRequestIds: new Set(),
      disposed: false,
    }
    logLiveFeed('info', `session created event=${eventId} (scanning)`)

    win.webContents.on('did-finish-load', () => {
      state.reloadAttempts = 0
      state.lastFrameAt = Date.now()
      state.diffusionRequestIds.clear()
      // Keep lastDataAt after baseline so a no-op reload still triggers data-stall soon.
      if (!state.baselined) state.lastDataAt = Date.now()
      logLiveFeed('info', `scoreboard loaded event=${eventId}`)
    })
    win.webContents.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      scheduleReload(state, `did-fail-load:${errorCode}`)
    })
    win.webContents.on('render-process-gone', () => {
      scheduleReload(state, 'render-process-gone')
    })
    win.on('closed', () => {
      if (!state.disposed) destroySession(eventId)
    })

    attachDebugger(state)
    state.stallTimer = setInterval(() => {
      if (state.disposed) return
      const nowTick = Date.now()
      const ageFrames = nowTick - state.lastFrameAt
      const ageData = nowTick - state.lastDataAt
      if (ageFrames >= stallMs) {
        scheduleReload(state, 'stall')
        return
      }
      if (state.baselined && ageData >= dataStallMs) {
        scheduleReload(state, 'data-stall')
      }
    }, Math.min(15_000, stallMs, dataStallMs))
    state.scorePollTimer = setInterval(() => {
      void pollScoreboardScore(state)
    }, SCORE_POLL_MS)

    sessions.set(eventId, state)
    ensureStatusTimer()
    void win.loadURL(resolveScoreboardUrl(scoreboardTemplate, eventId)).catch(() => {})
    return state
  }

  const attach = (panelId: string, rawEventId: string) => {
    if (disposed) return
    const eventId = normalizeEventId(rawEventId)
    if (!eventId) return

    const previous = panelToEvent.get(panelId)
    if (previous === eventId) {
      sessions.get(eventId)?.panelIds.add(panelId)
      return
    }
    if (previous) detach(panelId)

    let sessionState = sessions.get(eventId)
    if (!sessionState) {
      sessionState = createSession(eventId) ?? undefined
      if (!sessionState) return
    }
    sessionState.panelIds.add(panelId)
    panelToEvent.set(panelId, eventId)
  }

  const detach = (panelId: string) => {
    const eventId = panelToEvent.get(panelId)
    if (!eventId) return
    panelToEvent.delete(panelId)
    const sessionState = sessions.get(eventId)
    if (!sessionState) return
    sessionState.panelIds.delete(panelId)
    if (sessionState.panelIds.size === 0) destroySession(eventId)
  }

  const dispose = () => {
    disposed = true
    if (statusTimer) {
      clearInterval(statusTimer)
      statusTimer = undefined
    }
    for (const eventId of [...sessions.keys()]) destroySession(eventId)
    panelToEvent.clear()
  }

  return { attach, detach, dispose }
}
