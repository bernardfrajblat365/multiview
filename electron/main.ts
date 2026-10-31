import { app, BaseWindow, BrowserWindow, components, dialog, ipcMain, net, session, WebContentsView } from 'electron'
import electronUpdater from 'electron-updater'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBllEvents, type BllEventsResult } from '../src/bll-batch'
import { bllEventIdOf, createBllEndTracker, parseBllSituations, type BllPanelGame } from '../src/bll-end'
import type { Bounds, LayoutPayload, PanelPayload } from '../src/layout'
import { alertLabel, extractWilliamHillId } from '../src/match-events'
import { sportOfBllName } from '../src/livescore-365'
import { monitorHtml } from './monitor-html'
import { prepareProtectedPlayback } from './protected-playback'
import { createLiveScoreLinker } from './livescore-365'
import { createTeamCrests } from './team-crests'
import { createScoreboardScanners, type ScannerClock, type ScannerScore } from './scoreboard-scanner'
import {
  createLoadPacer,
  PLAYBACK_CHECK_INTERVAL_MS,
  PLAYBACK_MAX_RETRIES,
  PLAYBACK_TIMEOUT_MS,
  PLAYER_LOAD_SPACING_MS,
  playbackProbeScript,
} from './player-start'
import { getScannerLogBacklog, logScanner, onScannerLog } from './scanner-log'
import { listYoutubeLives, resolveYoutubeChannel } from './youtube-search'
import { isYoutubeWatchUrl, YOUTUBE_AD_URL_PATTERNS, YOUTUBE_WORLD, youtubeAdSkipScript, youtubePlayerCss } from './youtube-player'
import { createAutoUpdateController } from './update'
import { fetchGitHubReleaseNotes } from './release-notes'
import { createUiMessageBox } from './ui-dialog'
import { createWheelZoomGate, nextZoomLevel, type ZoomCommand, zoomCommandOf } from './ui-zoom'

const { autoUpdater } = electronUpdater

type NormVideoRect = { x: number; y: number; width: number; height: number }
type SlotViewState = {
  view: WebContentsView
  url: string
  cursorCssKey?: string
  cursorRevision: number
  videoRect?: NormVideoRect | null
  videoPollTimer?: ReturnType<typeof setInterval>
  loadTimer?: ReturnType<typeof setTimeout>
  playbackTimer?: ReturnType<typeof setInterval>
  playbackRetries: number
}

const VIDEO_RECT_POLL_MS = 1500
const VIDEO_RECT_WORLD = 1002
const MAX_PANEL_TITLE_LENGTH = 160
const measureVideoRectScript = `(() => {
  const videos = Array.from(document.querySelectorAll('video'))
    .filter((video) => {
      const style = window.getComputedStyle(video)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = video.getBoundingClientRect()
      return rect.width > 8 && rect.height > 8
    })
  if (!videos.length) return null
  let best = videos[0]
  let bestArea = 0
  for (const video of videos) {
    const rect = video.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area > bestArea) {
      best = video
      bestArea = area
    }
  }
  const box = best.getBoundingClientRect()
  const vw = window.innerWidth || 1
  const vh = window.innerHeight || 1
  const mediaW = best.videoWidth || 0
  const mediaH = best.videoHeight || 0
  let contentX = box.left
  let contentY = box.top
  let contentW = box.width
  let contentH = box.height
  if (mediaW > 0 && mediaH > 0 && box.width > 0 && box.height > 0) {
    const mediaAspect = mediaW / mediaH
    const boxAspect = box.width / box.height
    if (boxAspect > mediaAspect) {
      contentH = box.height
      contentW = box.height * mediaAspect
      contentX = box.left + (box.width - contentW) / 2
      contentY = box.top
    } else {
      contentW = box.width
      contentH = box.width / mediaAspect
      contentX = box.left
      contentY = box.top + (box.height - contentH) / 2
    }
  }
  return {
    x: contentX / vw,
    y: contentY / vh,
    width: contentW / vw,
    height: contentH / vh,
  }
})()`

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const appIconPath = isDev
  ? join(process.cwd(), 'public', 'quadra.ico')
  : join(__dirname, '../renderer/quadra.ico')
const electronUserAgent =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
const videoContainCss = `
  video {
    object-fit: contain !important;
    object-position: center center !important;
    background: #000 !important;
  }
`
const sportsPlayerCss = `
  html, body, #app {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
    box-sizing: border-box !important;
  }
  #app > div,
  #app > div > div {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #app .rowOpenvidu,
  #app .rowAnt,
  #app .rowFlash,
  #app .rowMS,
  #app #frameVideo {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #app .rowOpenvidu > .col-md-12,
  #app .rowAnt > .col-md-12,
  #app .rowFlash > .col-md-12,
  #app .rowMS > .col-md-12 {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #subscriber,
  #playFlash,
  #frameVideo {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #subscriber video,
  #remoteVideo,
  #flashPlayVideo,
  #msPlayVideo,
  #msPlayVideoBackup {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    border: 0 !important;
    box-sizing: border-box !important;
    object-fit: contain !important;
    object-position: center center !important;
    background: #000 !important;
    vertical-align: top !important;
  }
`

type SportsCatalogId = 'weddbets' | 'bllsport'
type SportsCatalogTarget = { id: string; label: string }

type SportsCatalog = {
  id: SportsCatalogId
  name: string
  homeUrl: string
  window: BrowserWindow | null
  target: SportsCatalogTarget | null
}

let mainWindow: BaseWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayReady = false
let quadraSession: Electron.Session | null = null
let shuttingDown = false
let cursorHidden = false
let visiblePanelIds = new Set<string>()
let fullscreenPrioritySyncPending = false
let autoUpdateController: ReturnType<typeof createAutoUpdateController> | null = null

/** Update prompts are drawn by the overlay in Quadra's style; the native box is only the fallback. */
const uiMessageBox = createUiMessageBox({
  send: (request) => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayReady) return false
    overlayWindow.webContents.send('quadra:ui-dialog', request)
    return true
  },
  fallback: (options) => dialog.showMessageBox(options),
})

const sportsCatalogs: Record<SportsCatalogId, SportsCatalog> = {
  weddbets: {
    id: 'weddbets',
    name: 'WeddBets',
    homeUrl: process.env.QUADRA_WEDDBETS_URL ?? 'https://www.weddbets.com/',
    window: null,
    target: null,
  },
  bllsport: {
    id: 'bllsport',
    name: 'BLL',
    homeUrl: process.env.QUADRA_BLLSPORT_URL ?? 'https://www.bllsport.com/',
    window: null,
    target: null,
  },
}

const slotViews = new Map<string, SlotViewState>()
let monitorWindow: BrowserWindow | null = null
const MATCH_DETECT_INTERVAL_MS = 2000
const MATCH_DETECT_ATTEMPTS = 30
/** Read-only: pulls the William Hill event id and match name out of the BLL player's Vue state. */
const detectMatchScript = `(() => {
  const root = document.querySelector('#app')
  const find = (vm) => {
    if (!vm) return null
    if (vm.$options && vm.$options.name === 'ViewEvento') return vm
    for (const child of vm.$children || []) { const hit = find(child); if (hit) return hit }
    return null
  }
  const vm = find(root && root.__vue__)
  const evento = vm && vm.item && vm.item.evento
  if (!evento) return null
  return { id: evento.williamHillId == null ? null : String(evento.williamHillId), nome: String(evento.nome || '') }
})()`
/** Read-only: copies id, name, competition, time and status of each listed game from the BLL home list, finished ones (`itensEncerrados`) included. */
const listEventsScript = `(() => {
  const root = document.querySelector('#app')
  const find = (vm) => {
    if (!vm) return null
    if (vm.$options && vm.$options.name === 'ListEventosHome2') return vm
    for (const child of vm.$children || []) { const hit = find(child); if (hit) return hit }
    return null
  }
  const vm = find(root && root.__vue__)
  if (!vm || !Array.isArray(vm.itens)) return null
  const time = (item) => {
    try { return typeof vm.formatarHora === 'function' ? String(vm.formatarHora(item)) : '' } catch { return '' }
  }
  return vm.itens.concat(Array.isArray(vm.itensEncerrados) ? vm.itensEncerrados : []).map((item) => ({
    id: String(item._id || ''),
    name: String(item.nome || ''),
    competition: String(item.competicao || ''),
    time: time(item),
    situation: Number(item.situacao),
  }))
})()`
const scanners = createScoreboardScanners({
  onEvent: ({ panelIds, incident, teamName, score }) => {
    const label = alertLabel(incident.kind, teamName, incident.minute)
    for (const panelId of panelIds) {
      overlayWindow?.webContents.send('quadra:match-event', {
        panelId,
        kind: incident.kind,
        teamName,
        minute: incident.minute,
        score,
        ownGoal: incident.ownGoal,
        team: incident.team,
        note: incident.note,
        label,
        eventId: incident.id,
        player: incident.player,
      })
    }
  },
  onScorer: sendMatchScorer,
  onScore: sendMatchScore,
  onClock: sendMatchClock,
  onEnd: sendMatchEnded,
  findScorer: (query) => liveScores.findScorer(query),
})
/** YouTube panels and BLL players without a William Hill feed: links the panel to a 365Scores game by the teams in its title, then polls that game. */
const liveScores = createLiveScoreLinker({
  onEvent: ({ panelIds, incident, teamName, score, label }) => {
    for (const panelId of panelIds) {
      overlayWindow?.webContents.send('quadra:match-event', {
        panelId,
        kind: incident.kind,
        teamName,
        minute: incident.minute,
        score,
        ownGoal: incident.ownGoal,
        team: incident.team,
        note: incident.note,
        label,
        eventId: incident.id,
        player: incident.player,
      })
    }
  },
  onScorer: sendMatchScorer,
  onScore: sendMatchScore,
  onClock: sendMatchClock,
  onStatus: (status) => {
    // Unlinked (other video, no match): its crests go with it.
    if (status.status === 'off') teamCrests.clear(status.panelId)
    overlayWindow?.webContents.send('quadra:live-match', status)
  },
  onEnd: sendMatchEnded,
  onVar: ({ panelIds, review }) => {
    for (const panelId of panelIds) overlayWindow?.webContents.send('quadra:live-var', { panelId, review })
  },
  onList: (games) => teamCrests.prefetch(games),
})
/** Crests for the match label, from 365Scores; they follow the names and score, never hold them up. */
const teamCrests = createTeamCrests({
  listGames: () => liveScores.listGames(),
  onCrests: (crests) => overlayWindow?.webContents.send('quadra:match-crests', crests),
})

function sendMatchScorer({ panelIds, incidentId, player }: { panelIds: string[]; incidentId: string; player: string }) {
  for (const panelId of panelIds) overlayWindow?.webContents.send('quadra:match-scorer', { panelId, eventId: incidentId, player })
}

function sendMatchEnded({ panelIds }: { panelIds: string[] }) {
  for (const panelId of panelIds) overlayWindow?.webContents.send('quadra:match-ended', { panelId })
}

function sendMatchClock({ panelIds, clock }: ScannerClock) {
  for (const panelId of panelIds) overlayWindow?.webContents.send('quadra:match-clock', { panelId, clock })
}

function sendMatchScore({ panelIds, home, away, score, teams }: ScannerScore) {
  for (const panelId of panelIds) {
    overlayWindow?.webContents.send('quadra:match-score', { panelId, home, away, score })
  }
  teamCrests.show(panelIds, home, away, teams)
}
const testUserDataPath = process.env.QUADRA_TEST_USER_DATA
if (testUserDataPath) app.setPath('userData', testUserDataPath)

function isAllowedRemoteUrl(url: string) {
  return /^https?:\/\//i.test(url) && url.length <= 4096
}

function isUiSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return event.sender === overlayWindow?.webContents
}

function shouldKeepFullscreenPriority() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return false
  if (!mainWindow.isFullScreen() || mainWindow.isMinimized()) return false
  return mainWindow.isFocused() || Boolean(
    overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused(),
  )
}

function reconcileFullscreenPriority() {
  fullscreenPrioritySyncPending = false
  const keepPriority = shouldKeepFullscreenPriority()
  const windows = [mainWindow, overlayWindow].filter((window): window is BaseWindow | BrowserWindow => Boolean(window && !window.isDestroyed()))
  if (!windows.some((window) => window.isAlwaysOnTop() !== keepPriority)) return
  // Windows can restore the owned overlay's priority without restoring its parent.
  if (keepPriority && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setAlwaysOnTop(false, 'screen-saver')
  }
  for (const window of windows) {
    if (window.isAlwaysOnTop() === keepPriority) continue
    window.setAlwaysOnTop(keepPriority, 'screen-saver')
  }
}

function scheduleFullscreenPrioritySync() {
  if (fullscreenPrioritySyncPending) return
  fullscreenPrioritySyncPending = true
  setImmediate(reconcileFullscreenPriority)
}

function watchFullscreenPriority(window: BaseWindow | BrowserWindow) {
  window.on('always-on-top-changed', scheduleFullscreenPrioritySync)
  window.on('focus', scheduleFullscreenPrioritySync)
  window.on('blur', scheduleFullscreenPrioritySync)
  window.on('enter-full-screen', scheduleFullscreenPrioritySync)
  window.on('leave-full-screen', scheduleFullscreenPrioritySync)
  window.on('minimize', scheduleFullscreenPrioritySync)
  window.on('restore', scheduleFullscreenPrioritySync)
}

function setNativeFullscreen(on: boolean) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen() === on) return
  mainWindow.setFullScreen(on)
}

/** Overlay or panel players: where Ctrl + / Ctrl - / Ctrl + wheel zoom the overlay UI. */
function isUiZoomSource(contents: Electron.WebContents) {
  if (overlayWindow && !overlayWindow.isDestroyed() && contents === overlayWindow.webContents) return true
  for (const state of slotViews.values()) if (state.view.webContents === contents) return true
  return false
}

// Only the overlay zooms (buttons, toolbar); applyLayout scales the panel bounds back, so
// the grid and the players keep their size. The panel pages themselves never zoom.
function zoomOverlay(command: ZoomCommand) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const contents = overlayWindow.webContents
  const level = nextZoomLevel(contents.getZoomLevel(), command)
  if (level === contents.getZoomLevel()) return
  contents.setZoomLevel(level)
  contents.send('quadra:request-layout')
}

const wheelZoomGate = createWheelZoomGate()

function zoomOverlayByWheel(direction: 'in' | 'out') {
  if (wheelZoomGate()) zoomOverlay(direction)
}

// Ctrl + / Ctrl - / Ctrl 0. Chromium only zooms out natively here because the app has no
// menu with the zoom-in accelerator; with panels open the keys reach the focused player.
function handleZoomInput(event: Electron.Event, input: Electron.Input, contents: Electron.WebContents) {
  const command = zoomCommandOf(input)
  if (!command || !isUiZoomSource(contents)) return false
  event.preventDefault()
  zoomOverlay(command)
  return true
}

function handleBeforeInput(event: Electron.Event, input: Electron.Input, contents: Electron.WebContents) {
  if (handleZoomInput(event, input, contents)) return
  if (input.type !== 'keyDown' || (input.key !== 'Escape' && input.code !== 'Escape')) return
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFullScreen()) return
  event.preventDefault()
  setNativeFullscreen(false)
}

function installNativeFullscreenHandlers() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => handleBeforeInput(event, input, contents))
  })
  app.on('browser-window-focus', scheduleFullscreenPrioritySync)
  app.on('browser-window-blur', scheduleFullscreenPrioritySync)
}

function getSportsCatalog(id: SportsCatalogId) {
  return sportsCatalogs[id]
}

function normalizeSportsPlayerUrl(catalog: SportsCatalog, value: string) {
  try {
    const url = new URL(value, catalog.homeUrl)
    const home = new URL(catalog.homeUrl)
    if (url.origin !== home.origin || !/^\/view\/[^/]+\/?$/i.test(url.pathname)) return null
    url.searchParams.set('view', 'clean')
    return url.toString()
  } catch {
    return null
  }
}

function matchSportsPlayerUrl(value: string) {
  for (const catalog of Object.values(sportsCatalogs)) {
    const playerUrl = normalizeSportsPlayerUrl(catalog, value)
    if (playerUrl) return { catalog, playerUrl }
  }
  return null
}

function updateSportsCatalogWindowTitle(catalog: SportsCatalog) {
  if (!catalog.window || catalog.window.isDestroyed()) return
  catalog.window.setTitle(catalog.target
    ? `${catalog.name} — abrir no ${catalog.target.label}`
    : `${catalog.name} — escolha um painel no Quadra`)
}

function setSportsCatalogTarget(catalog: SportsCatalog, id: string | null, label = '') {
  catalog.target = id && visiblePanelIds.has(id) ? { id, label } : null
  updateSportsCatalogWindowTitle(catalog)
}

function configureSportsCatalog(catalog: SportsCatalog, contents: Electron.WebContents) {
  contents.setUserAgent(electronUserAgent)
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) overlayWindow?.webContents.send(`quadra:${catalog.id}-error`, {
      message: `Não foi possível abrir o catálogo (${errorDescription}).`,
      url: validatedURL,
    })
  })
  contents.setWindowOpenHandler(({ url }) => {
    const playerUrl = normalizeSportsPlayerUrl(catalog, url)
    if (!playerUrl) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            session: quadraSession!,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }
    if (!catalog.target || !visiblePanelIds.has(catalog.target.id)) {
      setSportsCatalogTarget(catalog, null)
      overlayWindow?.webContents.send(`quadra:${catalog.id}-target-required`)
      overlayWindow?.show()
      overlayWindow?.focus()
      return { action: 'deny' }
    }
    const existing = slotViews.get(catalog.target.id)
    if (existing?.url === playerUrl && !existing.view.webContents.isDestroyed()) {
      void existing.view.webContents.loadURL(playerUrl).catch(() => {})
    }
    overlayWindow?.webContents.send(`quadra:${catalog.id}-player-opened`, {
      panelId: catalog.target.id,
      url: playerUrl,
    })
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault()
  })
}

function openSportsCatalog(catalogId: SportsCatalogId, id: string, label: string) {
  if (!visiblePanelIds.has(id)) return
  const catalog = getSportsCatalog(catalogId)
  setSportsCatalogTarget(catalog, id, label)
  if (catalog.window && !catalog.window.isDestroyed()) {
    if (catalog.window.isMinimized()) catalog.window.restore()
    catalog.window.show()
    catalog.window.focus()
    return
  }
  catalog.window = new BrowserWindow({
    title: `${catalog.name} — abrir no ${label}`,
    icon: appIconPath,
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  configureSportsCatalog(catalog, catalog.window.webContents)
  catalog.window.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    updateSportsCatalogWindowTitle(catalog)
  })
  catalog.window.on('closed', () => {
    catalog.window = null
    catalog.target = null
  })
  void catalog.window.loadURL(catalog.homeUrl).catch(() => {})
}

const BLL_LIST_TIMEOUT_MS = 15000
const BLL_LIST_POLL_MS = 400
const BLL_LIST_IDLE_MS = 90000
let bllListWindow: BrowserWindow | null = null
let bllListIdleTimer: NodeJS.Timeout | null = null
let bllListPending: Promise<unknown[] | null> | null = null
/** While a BLL player is open, the list is read this often to spot games the BLL marks "Encerrado". */
const BLL_END_POLL_MS = Number(process.env.QUADRA_BLL_END_POLL_MS) || 60000
const bllEnds = createBllEndTracker()
let bllEndTimer: NodeJS.Timeout | null = null

function closeBllListWindow() {
  if (bllListIdleTimer) clearTimeout(bllListIdleTimer)
  bllListIdleTimer = null
  if (bllListWindow && !bllListWindow.isDestroyed()) bllListWindow.destroy()
  bllListWindow = null
}

/** Hidden BLL home on the shared `persist:quadra` session: the batch list is read here without showing the site. */
function getBllListWindow() {
  if (bllListWindow && !bllListWindow.isDestroyed()) return bllListWindow
  bllListWindow = new BrowserWindow({
    show: false,
    width: 1180,
    height: 820,
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const contents = bllListWindow.webContents
  contents.setUserAgent(electronUserAgent)
  contents.setAudioMuted(true)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault()
  })
  bllListWindow.on('closed', () => { bllListWindow = null })
  return bllListWindow
}

async function readBllListRows(contents: Electron.WebContents) {
  const deadline = Date.now() + BLL_LIST_TIMEOUT_MS
  let rows: unknown = null
  // The list component mounts before its games arrive, so wait for rows (an empty list stays empty until the deadline).
  while (Date.now() < deadline) {
    if (contents.isDestroyed()) return null
    rows = await contents.executeJavaScript(listEventsScript).catch(() => null)
    if (Array.isArray(rows) && rows.length > 0) return rows
    await new Promise((resolve) => setTimeout(resolve, BLL_LIST_POLL_MS))
  }
  return Array.isArray(rows) ? rows : null
}

async function loadBllListRows() {
  const listWindow = getBllListWindow()
  if (bllListIdleTimer) clearTimeout(bllListIdleTimer)
  await listWindow.loadURL(getSportsCatalog('bllsport').homeUrl).catch(() => {})
  const raw = await readBllListRows(listWindow.webContents)
  bllListIdleTimer = setTimeout(closeBllListWindow, BLL_LIST_IDLE_MS)
  if (raw) checkBllEnds(raw)
  return raw
}

/** One read of the BLL home list at a time, shared by the batch dialog and the end watch. */
function readBllList() {
  bllListPending ??= loadBllListRows().finally(() => { bllListPending = null })
  return bllListPending
}

async function listBllsportEvents(): Promise<BllEventsResult> {
  const catalog = getSportsCatalog('bllsport')
  const raw = await readBllList()
  if (!raw) return { status: 'unavailable' }
  return { status: 'ok', events: parseBllEvents(raw, (id) => normalizeSportsPlayerUrl(catalog, `/view/${encodeURIComponent(id)}`)) }
}

function bllPanelGames(): BllPanelGame[] {
  const homeUrl = getSportsCatalog('bllsport').homeUrl
  const games: BllPanelGame[] = []
  for (const [panelId, state] of slotViews) {
    const eventId = bllEventIdOf(state.url, homeUrl)
    if (eventId) games.push({ panelId, eventId })
  }
  return games
}

/** Panels whose game the BLL moved from "Ao Vivo" to "Encerrado" get the same end notice as William Hill and 365Scores. */
function checkBllEnds(raw: unknown[]) {
  const ended = bllEnds.update(bllPanelGames(), parseBllSituations(raw))
  for (const panelId of ended) logScanner(`[${panelId}] BLL marcou o jogo como encerrado`)
  if (ended.length > 0) sendMatchEnded({ panelIds: ended })
}

function stopBllEndWatch() {
  if (bllEndTimer) clearInterval(bllEndTimer)
  bllEndTimer = null
}

/** Watches the BLL list only while some panel plays a BLL game; the first read happens right away so the game is seen live. */
function syncBllEndWatch() {
  if (bllPanelGames().length === 0) {
    stopBllEndWatch()
    return
  }
  if (bllEndTimer) return
  bllEndTimer = setInterval(() => { void readBllList() }, BLL_END_POLL_MS)
  void readBllList()
}

function sanitizePanelTitle(title: string) {
  return title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PANEL_TITLE_LENGTH)
}

function sendPanelTitle(panelId: string, title: string) {
  overlayWindow?.webContents.send('quadra:panel-title', { panelId, title: sanitizePanelTitle(title) })
}

function isSameNormRect(a: NormVideoRect | null | undefined, b: NormVideoRect | null) {
  if (!a && !b) return true
  if (!a || !b) return false
  const epsilon = 0.002
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  )
}

function isValidNormRect(value: unknown): value is NormVideoRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as Partial<NormVideoRect>
  return [rect.x, rect.y, rect.width, rect.height].every((part) => typeof part === 'number' && Number.isFinite(part)) &&
    Number(rect.width) > 0 && Number(rect.height) > 0 &&
    Number(rect.x) >= -0.05 && Number(rect.y) >= -0.05 &&
    Number(rect.x) + Number(rect.width) <= 1.05 &&
    Number(rect.y) + Number(rect.height) <= 1.05
}

async function measureSlotVideoRect(state: SlotViewState, panelId: string) {
  if (state.view.webContents.isDestroyed()) return
  const measured = await state.view.webContents
    .executeJavaScriptInIsolatedWorld(VIDEO_RECT_WORLD, [{ code: measureVideoRectScript }])
    .catch(() => null)
  const next = isValidNormRect(measured) ? measured : null
  if (isSameNormRect(state.videoRect, next)) return
  state.videoRect = next
  overlayWindow?.webContents.send('quadra:panel-video-rect', { panelId, rect: next })
}

function startVideoRectPolling(state: SlotViewState, panelId: string) {
  if (state.videoPollTimer) return
  state.videoPollTimer = setInterval(() => {
    void measureSlotVideoRect(state, panelId)
  }, VIDEO_RECT_POLL_MS)
  void measureSlotVideoRect(state, panelId)
}

function stopVideoRectPolling(state: SlotViewState) {
  if (!state.videoPollTimer) return
  clearInterval(state.videoPollTimer)
  state.videoPollTimer = undefined
}

const playerLoadPacer = createLoadPacer(PLAYER_LOAD_SPACING_MS)

/** Loads a panel URL; sports players are spaced out so a batch does not start them all at once. */
function loadSlotUrl(state: SlotViewState, url: string) {
  if (state.loadTimer) clearTimeout(state.loadTimer)
  state.loadTimer = undefined
  const delay = matchSportsPlayerUrl(url) ? playerLoadPacer.reserve() : 0
  const load = () => {
    state.loadTimer = undefined
    if (state.view.webContents.isDestroyed() || state.url !== url) return
    void state.view.webContents.loadURL(url).catch(() => {})
  }
  if (delay > 0) state.loadTimer = setTimeout(load, delay)
  else load()
}

function stopPlaybackWatch(state: SlotViewState) {
  if (state.playbackTimer) clearInterval(state.playbackTimer)
  state.playbackTimer = undefined
}

/** Reloads a sports player that loaded but never got its video running (black panel). */
function startPlaybackWatch(state: SlotViewState, panelId: string) {
  stopPlaybackWatch(state)
  const startedAt = Date.now()
  const timer = setInterval(() => {
    const contents = state.view.webContents
    if (contents.isDestroyed() || state.playbackTimer !== timer) return stopPlaybackWatch(state)
    void contents.executeJavaScriptInIsolatedWorld(VIDEO_RECT_WORLD, [{ code: playbackProbeScript }])
      .catch(() => false)
      .then((playing) => {
        if (state.playbackTimer !== timer || contents.isDestroyed()) return
        if (playing === true) return stopPlaybackWatch(state)
        if (Date.now() - startedAt < PLAYBACK_TIMEOUT_MS) return
        stopPlaybackWatch(state)
        const title = sanitizePanelTitle(contents.getTitle()) || state.url
        if (state.playbackRetries >= PLAYBACK_MAX_RETRIES) {
          logScanner(`[${panelId}] vídeo não iniciou após ${PLAYBACK_MAX_RETRIES} recargas: ${title}`)
          return
        }
        state.playbackRetries += 1
        logScanner(`[${panelId}] vídeo não iniciou; recarregando (${state.playbackRetries}/${PLAYBACK_MAX_RETRIES}): ${title}`)
        loadSlotUrl(state, state.url)
      })
  }, PLAYBACK_CHECK_INTERVAL_MS)
  state.playbackTimer = timer
}

const matchDetections = new Map<string, ReturnType<typeof setInterval>>()

function stopMatchDetection(panelId: string) {
  const timer = matchDetections.get(panelId)
  if (timer) clearInterval(timer)
  matchDetections.delete(panelId)
  scanners.detach(panelId)
  liveScores.detach(panelId)
  teamCrests.clear(panelId)
  overlayWindow?.webContents.send('quadra:match-score', { panelId, home: '', away: '', score: '' })
}

/**
 * Finds which match a BLL panel is playing and hands its feed id to the scanner.
 * A match without a William Hill feed falls back to 365Scores by its name, as YouTube lives do;
 * detection keeps looking meanwhile, and a feed id that shows up later takes over.
 */
function startMatchDetection(contents: Electron.WebContents, panelId: string) {
  stopMatchDetection(panelId)
  teamCrests.warm()
  let attempts = 0
  let fallback = false
  const startFallback = (name: string) => {
    if (fallback || contents.isDestroyed()) return
    fallback = true
    // Basketball games ("🏀 …") never have a William Hill feed; 365Scores gives them names, crests and score.
    const sport = sportOfBllName(name)
    const reason = sport === 'basketball' ? 'jogo de basquete' : sport === 'american-football' ? 'jogo de futebol americano' : 'jogo sem feed de lances (williamHillId ausente)'
    logScanner(`[${panelId}] ${reason}; buscando no 365Scores: ${name || contents.getURL()}`, '365')
    liveScores.consider(panelId, contents.getURL(), name, sport)
  }
  const timer = setInterval(() => {
    attempts += 1
    if (contents.isDestroyed() || attempts > MATCH_DETECT_ATTEMPTS) {
      clearInterval(timer)
      matchDetections.delete(panelId)
      if (!contents.isDestroyed()) startFallback(sanitizePanelTitle(contents.getTitle()))
      return
    }
    void contents.executeJavaScript(detectMatchScript).then((found: { id?: string | null; nome?: string } | null) => {
      if (!found || !matchDetections.has(panelId)) return
      const name = sanitizePanelTitle(found.nome ?? '')
      const eventId = extractWilliamHillId(found.id)
      if (found.nome && sportOfBllName(name) === 'american-football') {
        // The scanner reads football incidents only: American football goes to 365Scores even with a feed id.
        clearInterval(timer)
        matchDetections.delete(panelId)
        logScanner(`[${panelId}] futebol americano ${eventId ? `com feed William Hill (${eventId}), não usado` : 'sem feed William Hill'}`, 'wh')
        startFallback(name)
        return
      }
      if (!eventId) {
        // The player loaded its match and it has no feed id: no point waiting a minute for one.
        if (found.nome) startFallback(name)
        return
      }
      clearInterval(timer)
      matchDetections.delete(panelId)
      if (fallback) {
        liveScores.detach(panelId)
        logScanner(`[${panelId}] feed William Hill apareceu; 365Scores deixado de lado`, 'wh')
      }
      scanners.attach(panelId, eventId, name || `jogo ${eventId}`)
    }).catch(() => {})
  }, MATCH_DETECT_INTERVAL_MS)
  matchDetections.set(panelId, timer)
}

function configureRemoteContents(contents: Electron.WebContents, slotId?: string) {
  contents.setUserAgent(electronUserAgent)
  let youtubeCssKey: string | undefined
  // YouTube is a SPA: re-evaluate on in-page navigation, and drop the CSS when leaving /watch.
  const syncYoutubePlayer = async () => {
    if (contents.isDestroyed()) return
    if (isYoutubeWatchUrl(contents.getURL())) {
      if (!youtubeCssKey) {
        youtubeCssKey = await contents.insertCSS(youtubePlayerCss, { cssOrigin: 'user' }).catch(() => undefined)
      }
      await contents.executeJavaScriptInIsolatedWorld(YOUTUBE_WORLD, [{ code: youtubeAdSkipScript }]).catch(() => {})
    } else if (youtubeCssKey) {
      const key = youtubeCssKey
      youtubeCssKey = undefined
      await contents.removeInsertedCSS(key).catch(() => {})
    }
    if (slotId) {
      const state = slotViews.get(slotId)
      if (state) void measureSlotVideoRect(state, slotId)
    }
  }
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    void syncYoutubePlayer()
    // Leaving /watch inside YouTube's SPA: the live is gone, so is its 365Scores link (a BLL player keeps its fallback).
    if (slotId && !isYoutubeWatchUrl(url) && !matchSportsPlayerUrl(url)) {
      liveScores.detach(slotId)
      teamCrests.clear(slotId)
    }
  })
  contents.on('did-finish-load', () => {
    youtubeCssKey = undefined // full load clears inserted CSS
    void syncYoutubePlayer()
    void contents.insertCSS(videoContainCss, { cssOrigin: 'user' }).catch(() => {})
    if (slotId) {
      const state = slotViews.get(slotId)
      if (state) {
        // Navigation clears inserted CSS; drop the stale key and re-apply cursor policy.
        state.cursorCssKey = undefined
        void syncSlotCursor(state)
        void measureSlotVideoRect(state, slotId)
      }
    }
    if (!matchSportsPlayerUrl(contents.getURL())) return
    void contents.insertCSS(sportsPlayerCss, { cssOrigin: 'user' }).catch(() => {})
    if (!slotId) return
    startMatchDetection(contents, slotId)
    const state = slotViews.get(slotId)
    if (state) startPlaybackWatch(state, slotId)
  })
  if (slotId) {
    contents.on('page-title-updated', (_event, title) => {
      sendPanelTitle(slotId, title)
      const url = contents.getURL()
      if (isYoutubeWatchUrl(url)) liveScores.consider(slotId, url, sanitizePanelTitle(title))
    })
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      stopMatchDetection(slotId)
      sendPanelTitle(slotId, '')
      const state = slotViews.get(slotId)
      if (!state) return
      stopPlaybackWatch(state)
      state.videoRect = undefined
      overlayWindow?.webContents.send('quadra:panel-video-rect', { panelId: slotId, rect: null })
    })
  }
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!slotId || !isMainFrame || errorCode === -3) return
    const match = matchSportsPlayerUrl(validatedURL)
    if (!match) return
    overlayWindow?.webContents.send(`quadra:${match.catalog.id}-error`, {
      message: `O player do ${match.catalog.name} não carregou (${errorDescription}). Tente escolher o jogo novamente.`,
      panelId: slotId,
      url: validatedURL,
    })
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedRemoteUrl(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        width: 1100,
        height: 760,
        webPreferences: {
          session: quadraSession!,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault()
  })
}

function destroySlotView(id: string) {
  const state = slotViews.get(id)
  if (!state) return
  stopMatchDetection(id)
  stopVideoRectPolling(state)
  stopPlaybackWatch(state)
  if (state.loadTimer) clearTimeout(state.loadTimer)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(state.view)
  if (!state.view.webContents.isDestroyed()) state.view.webContents.close()
  slotViews.delete(id)
}

async function syncSlotCursor(state: SlotViewState) {
  const revision = ++state.cursorRevision
  const previousKey = state.cursorCssKey
  state.cursorCssKey = undefined
  if (previousKey && !state.view.webContents.isDestroyed()) {
    await state.view.webContents.removeInsertedCSS(previousKey).catch(() => {})
  }
  if (state.view.webContents.isDestroyed()) return
  // Keep guest cursor under Quadra control. Sites like Zapping set cursor:none on the
  // player; with click-through that makes the system pointer vanish over the panel.
  const css = cursorHidden
    ? '* { cursor: none !important; }'
    : '* { cursor: auto !important; }'
  const key = await state.view.webContents.insertCSS(css).catch(() => '')
  if (!key) return
  if (revision !== state.cursorRevision || state.view.webContents.isDestroyed()) {
    if (!state.view.webContents.isDestroyed()) await state.view.webContents.removeInsertedCSS(key).catch(() => {})
    return
  }
  state.cursorCssKey = key
}

function setCursorHidden(hidden: boolean) {
  if (cursorHidden === hidden) return
  cursorHidden = hidden
  for (const state of slotViews.values()) void syncSlotCursor(state)
}

function destroyAllSlotViews() {
  for (const index of [...slotViews.keys()]) destroySlotView(index)
}

function openMonitorWindow() {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    if (monitorWindow.isMinimized()) monitorWindow.restore()
    monitorWindow.show()
    monitorWindow.focus()
    return
  }
  monitorWindow = new BrowserWindow({
    title: 'Quadra — Monitor de lances',
    icon: appIconPath,
    width: 760,
    height: 480,
    minWidth: 480,
    minHeight: 280,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The ESM preload cannot load in a sandboxed renderer; the page is local HTML with no remote content.
      sandbox: false,
      preload: join(__dirname, '../preload/monitor-preload.mjs'),
    },
  })
  const window = monitorWindow
  const stopListening = onScannerLog((line) => {
    if (!window.isDestroyed()) window.webContents.send('quadra-monitor:line', line)
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('closed', () => {
    stopListening()
    if (monitorWindow === window) monitorWindow = null
  })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(monitorHtml)}`).catch(() => {})
}

function closeOwnedWindows() {
  scanners.destroyAll()
  liveScores.destroyAll()
  teamCrests.reset()
  for (const id of [...matchDetections.keys()]) stopMatchDetection(id)
  stopBllEndWatch()
  if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.close()
  destroyAllSlotViews()
  closeBllListWindow()
  for (const catalog of Object.values(sportsCatalogs)) {
    if (catalog.window && !catalog.window.isDestroyed()) catalog.window.close()
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
}

function installAutoUpdater() {
  autoUpdateController = createAutoUpdateController({
    enabled: app.isPackaged && process.platform === 'win32',
    updater: autoUpdater,
    showMessageBox: uiMessageBox.show,
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    fetchReleaseNotes: (version) => fetchGitHubReleaseNotes(version, (url, init) => net.fetch(String(url), init)),
    log: (message) => console.warn(`[updater] ${message}`),
  })
  void autoUpdateController.check()
}

function createSlotView(id: string, url: string, muted: boolean) {
  const view = new WebContentsView({
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  })
  configureRemoteContents(view.webContents, id)
  // Ctrl + wheel over a player zooms the overlay UI, as over the buttons (Electron never zooms the page itself).
  view.webContents.on('zoom-changed', (_event, direction) => zoomOverlayByWheel(direction))
  view.webContents.setAudioMuted(muted)
  mainWindow?.contentView.addChildView(view)
  const state: SlotViewState = { view, url, cursorRevision: 0, videoRect: undefined, playbackRetries: 0 }
  slotViews.set(id, state)
  startVideoRectPolling(state, id)
  void syncSlotCursor(state)
  loadSlotUrl(state, url)
  return state
}

function isValidBounds(bounds: Bounds) {
  return (
    Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0 &&
    bounds.width <= 10000 && bounds.height <= 10000
  )
}

function isValidLayoutPayload(value: unknown): value is LayoutPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<LayoutPayload>
  if (payload.view !== 'choose' && payload.view !== 'grid') return false
  // Keep in sync with MAX_PANELS in src/layout.ts
  const maxPanels = 18
  if (!Number.isInteger(payload.panelCount) || Number(payload.panelCount) < 1 || Number(payload.panelCount) > maxPanels) return false
  if (payload.mode !== 'auto' && payload.mode !== 'equal' && payload.mode !== 'highlights') return false
  if (!Array.isArray(payload.panels) || payload.panels.length > maxPanels) return false
  if (payload.view === 'grid' && payload.panels.length !== payload.panelCount) return false
  const ids = new Set<string>()
  return payload.panels.every((panel) => {
    if (!panel || typeof panel !== 'object') return false
    const candidate = panel as Partial<PanelPayload>
    if (typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 80 || ids.has(candidate.id)) return false
    ids.add(candidate.id)
    return typeof candidate.url === 'string' && candidate.url.length <= 4096 &&
      typeof candidate.muted === 'boolean' && typeof candidate.editing === 'boolean' &&
      typeof candidate.forceReload === 'boolean' &&
      Boolean(candidate.bounds) && isValidBounds(candidate.bounds as Bounds)
  })
}

function syncOverlayBounds() {
  if (!mainWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setBounds(mainWindow.getContentBounds())
}

function raiseOverlay() {
  if (!mainWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  syncOverlayBounds()
  if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  overlayWindow.moveTop()
}

function applyLayout(payload: LayoutPayload) {
  if (!mainWindow) return
  visiblePanelIds = new Set(payload.panels.map((panel) => panel.id))
  for (const catalog of Object.values(sportsCatalogs)) {
    if (catalog.target && !visiblePanelIds.has(catalog.target.id)) setSportsCatalogTarget(catalog, null)
  }
  if (payload.view === 'choose') {
    destroyAllSlotViews()
    syncBllEndWatch()
    raiseOverlay()
    return
  }
  const visibleSlots = new Set<string>()
  for (const panel of payload.panels) {
    if (!panel.url || !isAllowedRemoteUrl(panel.url) || !isValidBounds(panel.bounds)) {
      destroySlotView(panel.id)
      continue
    }
    visibleSlots.add(panel.id)
    let state = slotViews.get(panel.id)
    if (!state) {
      state = createSlotView(panel.id, panel.url, panel.muted)
    } else if (state.url !== panel.url || panel.forceReload) {
      state.url = panel.url
      state.cursorCssKey = undefined
      state.playbackRetries = 0
      loadSlotUrl(state, panel.url)
    }
    state.view.webContents.setAudioMuted(panel.muted)
    const zoom = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.webContents.getZoomFactor() : 1
    state.view.setBounds({
      x: Math.round(panel.bounds.x * zoom),
      y: Math.round(panel.bounds.y * zoom),
      width: Math.max(1, Math.round(panel.bounds.width * zoom)),
      height: Math.max(1, Math.round(panel.bounds.height * zoom)),
    })
    state.view.setVisible(true)
    void measureSlotVideoRect(state, panel.id)
  }
  for (const id of [...slotViews.keys()]) {
    if (!visibleSlots.has(id)) destroySlotView(id)
  }
  syncBllEndWatch()
  raiseOverlay()
}

function createOverlay() {
  if (!mainWindow) return
  overlayWindow = new BrowserWindow({
    parent: mainWindow,
    frame: false,
    transparent: true,
    show: false,
    focusable: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  })
  watchFullscreenPriority(overlayWindow)
  overlayWindow.setBackgroundColor('#00000000')
  overlayWindow.setIgnoreMouseEvents(false)
  overlayWindow.on('closed', () => {
    overlayWindow = null
    overlayReady = false
    uiMessageBox.cancelAll()
    scheduleFullscreenPrioritySync()
  })
  // A reload drops whatever the overlay was showing; its dialogs count as dismissed.
  overlayWindow.webContents.on('did-start-loading', () => uiMessageBox.cancelAll())
  overlayWindow.webContents.on('zoom-changed', (_event, direction) => zoomOverlayByWheel(direction))
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true
    syncOverlayBounds()
    overlayWindow?.showInactive()
    raiseOverlay()
    scheduleFullscreenPrioritySync()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  // Smokes run on a fresh profile; the "what's new" popup would cover the screens they click.
  const query: Record<string, string> = testUserDataPath ? { 'release-notes': 'off', 'first-steps': 'off' } : {}
  // Smokes read the BLL list for Auto mode faster than the minute the app uses.
  if (Number(process.env.QUADRA_AUTO_OPEN_POLL_MS) > 0) query['auto-open-poll-ms'] = String(Number(process.env.QUADRA_AUTO_OPEN_POLL_MS))
  const devUrl = new URL(process.env.ELECTRON_RENDERER_URL ?? 'http://localhost')
  for (const [key, value] of Object.entries(query)) devUrl.searchParams.set(key, value)
  const load = isDev
    ? overlayWindow.webContents.loadURL(devUrl.toString())
    : overlayWindow.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query })
  void load.catch(() => {})
}

function installIpcHandlers() {
  ipcMain.handle('quadra:check-for-update', (event) => {
    if (!isUiSender(event)) throw new Error('Invalid update request sender')
    return autoUpdateController?.check() ?? 'disabled'
  })
  ipcMain.on('quadra:ui-dialog-response', (event, id: unknown, response: unknown) => {
    if (isUiSender(event)) uiMessageBox.respond(id, response)
  })
  ipcMain.on('quadra:choose-live-match', (event, panelId: unknown, gameId: unknown) => {
    if (!isUiSender(event) || typeof panelId !== 'string') return
    if (gameId === null || (typeof gameId === 'number' && Number.isSafeInteger(gameId) && gameId > 0)) liveScores.choose(panelId, gameId)
  })
  ipcMain.on('quadra:open-monitor', (event) => {
    if (isUiSender(event)) openMonitorWindow()
  })
  ipcMain.handle('quadra-monitor:backlog', (event) => {
    if (!monitorWindow || monitorWindow.isDestroyed() || event.sender !== monitorWindow.webContents) return []
    return getScannerLogBacklog()
  })
  ipcMain.on('quadra:ready', (event) => {
    if (isUiSender(event) && overlayReady) raiseOverlay()
  })
  ipcMain.on('quadra:set-layout', (event, payload: unknown) => {
    if (isUiSender(event) && isValidLayoutPayload(payload)) applyLayout(payload)
  })
  ipcMain.on('quadra:set-chrome-interactive', (event, interactive: unknown, refocusPlayers: unknown) => {
    if (!isUiSender(event) || typeof interactive !== 'boolean' || !overlayWindow) return
    overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true })
    // A focused overlay leaves the panel views in the background, where live players stop painting.
    if (!interactive && refocusPlayers === true && overlayWindow.isFocused() && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus()
    }
  })
  ipcMain.on('quadra:set-fullscreen', (event, on: unknown) => {
    if (isUiSender(event) && typeof on === 'boolean') setNativeFullscreen(on)
  })
  ipcMain.on('quadra:set-cursor-hidden', (event, hidden: unknown) => {
    if (isUiSender(event) && typeof hidden === 'boolean') setCursorHidden(hidden)
  })
  ipcMain.on('quadra:open-weddbets', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event) || typeof id !== 'string' || typeof label !== 'string') return
    openSportsCatalog('weddbets', id, label)
  })
  ipcMain.on('quadra:set-weddbets-target', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event)) return
    const catalog = getSportsCatalog('weddbets')
    if (id === null) {
      setSportsCatalogTarget(catalog, null)
      return
    }
    if (typeof id === 'string' && typeof label === 'string') setSportsCatalogTarget(catalog, id, label)
  })
  ipcMain.on('quadra:open-bllsport', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event) || typeof id !== 'string' || typeof label !== 'string') return
    openSportsCatalog('bllsport', id, label)
  })
  ipcMain.on('quadra:set-bllsport-target', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event)) return
    const catalog = getSportsCatalog('bllsport')
    if (id === null) {
      setSportsCatalogTarget(catalog, null)
      return
    }
    if (typeof id === 'string' && typeof label === 'string') setSportsCatalogTarget(catalog, id, label)
  })
  ipcMain.handle('quadra:list-bllsport-events', (event) => {
    if (!isUiSender(event)) return { status: 'unavailable' }
    return listBllsportEvents()
  })
  ipcMain.handle('quadra:list-youtube-lives', (event, channels: unknown) => {
    if (!isUiSender(event)) return { status: 'unavailable' }
    return listYoutubeLives(channels)
  })
  ipcMain.handle('quadra:resolve-youtube-channel', (event, input: unknown) => {
    if (!isUiSender(event)) return { status: 'unavailable' }
    return resolveYoutubeChannel(input)
  })
}

function createWindow() {
  mainWindow = new BaseWindow({
    title: 'Quadra — Multi-view', width: 1440, height: 900,
    backgroundColor: '#000000', autoHideMenuBar: true, icon: appIconPath,
  })
  watchFullscreenPriority(mainWindow)
  mainWindow.setMinimumSize(960, 620)
  mainWindow.on('resize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('move', syncOverlayBounds)
  mainWindow.on('maximize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('unmaximize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('enter-full-screen', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:fullscreen-changed', true)
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('leave-full-screen', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:fullscreen-changed', false)
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('restore', () => {
    syncOverlayBounds()
    overlayWindow?.showInactive()
    overlayWindow?.webContents.send('quadra:request-layout')
    scheduleFullscreenPrioritySync()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    closeBllListWindow()
    for (const catalog of Object.values(sportsCatalogs)) {
      if (catalog.window && !catalog.window.isDestroyed()) catalog.window.close()
    }
    scanners.destroyAll()
    liveScores.destroyAll()
    teamCrests.reset()
    if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.close()
    destroyAllSlotViews()
    scheduleFullscreenPrioritySync()
  })
  mainWindow.maximize()
  mainWindow.show()
  createOverlay()
  scheduleFullscreenPrioritySync()
}

app.whenReady().then(async () => {
  await prepareProtectedPlayback(
    () => components.whenReady(),
    (error) => {
      console.error('Widevine initialization failed:', error)
      dialog.showErrorBox(
        'Não foi possível preparar a reprodução protegida',
        'O Quadra será aberto, mas conteúdo protegido pode não reproduzir. Verifique sua conexão e reinicie o Quadra para tentar instalar o Widevine novamente.',
      )
    },
  )
  quadraSession = session.fromPartition('persist:quadra')
  quadraSession.setUserAgent(electronUserAgent)
  quadraSession.webRequest.onBeforeRequest({ urls: YOUTUBE_AD_URL_PATTERNS }, (_details, callback) => callback({ cancel: true }))
  if (process.platform === 'win32') app.setAppUserModelId('com.quadra.multiview')
  installNativeFullscreenHandlers()
  installIpcHandlers()
  createWindow()
  installAutoUpdater()
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shuttingDown) {
    closeOwnedWindows()
    return
  }
  event.preventDefault()
  shuttingDown = true
  closeOwnedWindows()
  app.quit()
})
