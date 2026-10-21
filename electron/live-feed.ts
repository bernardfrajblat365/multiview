import { BrowserWindow, session } from 'electron'
import {
  IncidentTracker,
  collectFeedUpdates,
  decodeFeedFrame,
  type AlertKind,
  type AlertTeam,
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
  stallTimer?: ReturnType<typeof setInterval>
  reloadAttempts: number
  reloadTimer?: ReturnType<typeof setTimeout>
  diffusionRequestIds: Set<string>
  disposed: boolean
}

const DEFAULT_SCOREBOARD =
  'https://score.kwddw.com/scoreboards/app/football/index.html?eventId={eventId}&sport=football&locale=pt-pt'
const DEFAULT_MAX_FEEDS = 18
const DEFAULT_STALL_MS = 60_000
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
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS
  const allowedOrigin = allowedScoreboardOrigin(scoreboardTemplate)

  const sessions = new Map<string, FeedSession>()
  const panelToEvent = new Map<string, string>()
  let disposed = false

  const emitAlerts = (session: FeedSession, alerts: PanelAlert[]) => {
    if (!alerts.length) return
    for (const panelId of session.panelIds) {
      for (const alert of alerts) {
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

  const handleFrame = (session: FeedSession, payloadData: string) => {
    if (session.disposed) return
    session.lastFrameAt = Date.now()
    const decoded = decodeFeedFrame(payloadData)
    if (!decoded) return
    const updates = collectFeedUpdates(decoded, session.eventId)
    if (!updates.incidents.length && !updates.score) return
    const alerts = session.tracker.ingest(updates)
    emitAlerts(session, alerts)
  }

  const destroySession = (eventId: string) => {
    const sessionState = sessions.get(eventId)
    if (!sessionState) return
    sessionState.disposed = true
    if (sessionState.stallTimer) clearInterval(sessionState.stallTimer)
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
  }

  const scheduleReload = (session: FeedSession, reason: string) => {
    if (session.disposed || session.reloadTimer) return
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(session.reloadAttempts, 4))
    session.reloadAttempts += 1
    console.warn(`[live-feed] reload ${session.eventId} after ${reason} in ${delay}ms`)
    session.reloadTimer = setTimeout(() => {
      session.reloadTimer = undefined
      if (session.disposed || session.window.isDestroyed()) return
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
        console.warn('[live-feed] debugger attach failed', error)
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
        if (requestId && DIFFUSION_RE.test(url)) session.diffusionRequestIds.add(requestId)
        return
      }
      if (method === 'Network.webSocketFrameReceived') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : ''
        if (session.diffusionRequestIds.size && requestId && !session.diffusionRequestIds.has(requestId)) {
          return
        }
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
      console.warn(`[live-feed] max feeds (${maxFeeds}) reached; skipping ${eventId}`)
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

    const state: FeedSession = {
      eventId,
      window: win,
      tracker: new IncidentTracker(),
      panelIds: new Set(),
      lastFrameAt: Date.now(),
      reloadAttempts: 0,
      diffusionRequestIds: new Set(),
      disposed: false,
    }

    win.webContents.on('did-finish-load', () => {
      state.reloadAttempts = 0
      state.lastFrameAt = Date.now()
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
      if (Date.now() - state.lastFrameAt < stallMs) return
      scheduleReload(state, 'stall')
    }, Math.min(15_000, stallMs))

    sessions.set(eventId, state)
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
    for (const eventId of [...sessions.keys()]) destroySession(eventId)
    panelToEvent.clear()
  }

  return { attach, detach, dispose }
}
