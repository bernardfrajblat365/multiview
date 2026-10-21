import { app, BaseWindow, BrowserWindow, components, dialog, ipcMain, screen, session, WebContentsView } from 'electron'
import electronUpdater from 'electron-updater'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bounds, LayoutPayload, PanelPayload } from '../src/layout'
import { createFeedManager, logLiveFeed, type FeedManager } from './live-feed'
import { prepareProtectedPlayback } from './protected-playback'
import { createAutoUpdateController } from './update'

const { autoUpdater } = electronUpdater

type NormVideoRect = { x: number; y: number; width: number; height: number }
type SlotViewState = {
  view: WebContentsView
  url: string
  cursorCssKey?: string
  cursorRevision: number
  videoRect?: NormVideoRect | null
  videoPollTimer?: ReturnType<typeof setInterval>
  feedEventId?: string | null
  feedProbeTimer?: ReturnType<typeof setTimeout>
  feedProbeAttempts: number
}

const VIDEO_RECT_POLL_MS = 1500
const VIDEO_RECT_WORLD = 1002
const MAX_PANEL_TITLE_LENGTH = 160
const FEED_PROBE_MAX_ATTEMPTS = 5
const FEED_PROBE_INTERVAL_MS = 3000
const FEED_PROBE_SLOW_INTERVAL_MS = 15_000
const WILLIAM_HILL_ID_RE = /^\d{5,12}$/
const readWilliamHillIdScript = `(() => {
  const root = document.querySelector('#app')
  const vm = root && root.__vue__
  if (!vm) return null
  const seen = new Set()
  const queue = [vm]
  while (queue.length) {
    const node = queue.shift()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    const data = node.$data
    if (data && typeof data === 'object') {
      const evento = data.item && data.item.evento
      const id = evento && evento.williamHillId
      if (id != null && /^\\d{5,12}$/.test(String(id))) return String(id)
      if (data.williamHillId != null && /^\\d{5,12}$/.test(String(data.williamHillId))) return String(data.williamHillId)
    }
    const children = node.$children
    if (Array.isArray(children)) {
      for (const child of children) queue.push(child)
    }
  }
  return null
})()`
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
let feedManager: FeedManager | null = null

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

function handleBeforeInput(event: Electron.Event, input: Electron.Input) {
  if (input.type !== 'keyDown' || (input.key !== 'Escape' && input.code !== 'Escape')) return
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFullScreen()) return
  event.preventDefault()
  setNativeFullscreen(false)
}

function installNativeFullscreenHandlers() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', handleBeforeInput)
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

function sanitizePanelTitle(title: string) {
  return title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PANEL_TITLE_LENGTH)
}

function sendPanelTitle(panelId: string, title: string) {
  overlayWindow?.webContents.send('quadra:panel-title', { panelId, title: sanitizePanelTitle(title) })
}

function clearFeedProbe(state: SlotViewState) {
  if (!state.feedProbeTimer) return
  clearTimeout(state.feedProbeTimer)
  state.feedProbeTimer = undefined
}

function detachPanelFeed(panelId: string, state?: SlotViewState) {
  const slot = state ?? slotViews.get(panelId)
  if (slot) {
    clearFeedProbe(slot)
    slot.feedEventId = null
    slot.feedProbeAttempts = 0
  }
  feedManager?.detach(panelId)
}

function applyPanelFeedEventId(panelId: string, eventId: string | null) {
  const state = slotViews.get(panelId)
  if (!state) return
  if (!eventId || !WILLIAM_HILL_ID_RE.test(eventId)) {
    if (state.feedEventId) detachPanelFeed(panelId, state)
    return
  }
  if (state.feedEventId === eventId) return
  state.feedEventId = eventId
  clearFeedProbe(state)
  logLiveFeed('info', `panel ${panelId} -> event ${eventId}`)
  feedManager?.attach(panelId, eventId)
}

function scheduleFeedProbe(panelId: string, reset = false) {
  const state = slotViews.get(panelId)
  if (!state || state.view.webContents.isDestroyed()) return
  if (!matchSportsPlayerUrl(state.url)) {
    detachPanelFeed(panelId, state)
    return
  }
  if (state.feedEventId) return
  if (reset) {
    clearFeedProbe(state)
    state.feedProbeAttempts = 0
  }
  if (state.feedProbeTimer) return

  const run = async () => {
    state.feedProbeTimer = undefined
    if (state.view.webContents.isDestroyed()) return
    if (!matchSportsPlayerUrl(state.view.webContents.getURL() || state.url)) {
      detachPanelFeed(panelId, state)
      return
    }
    if (state.feedEventId) return
    const raw = await state.view.webContents.executeJavaScript(readWilliamHillIdScript).catch(() => null)
    const eventId = typeof raw === 'string' && WILLIAM_HILL_ID_RE.test(raw) ? raw : null
    if (eventId) {
      applyPanelFeedEventId(panelId, eventId)
      return
    }
    state.feedProbeAttempts += 1
    if (state.feedProbeAttempts === FEED_PROBE_MAX_ATTEMPTS) {
      logLiveFeed('warn', `panel ${panelId} still without williamHillId after fast probe; retrying slowly`)
    }
    const delay =
      state.feedProbeAttempts >= FEED_PROBE_MAX_ATTEMPTS
        ? FEED_PROBE_SLOW_INTERVAL_MS
        : FEED_PROBE_INTERVAL_MS
    state.feedProbeTimer = setTimeout(() => {
      void run()
    }, delay)
  }

  void run()
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

function configureRemoteContents(contents: Electron.WebContents, slotId?: string) {
  contents.setUserAgent(electronUserAgent)
  contents.on('did-finish-load', () => {
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
    if (!matchSportsPlayerUrl(contents.getURL())) {
      if (slotId) detachPanelFeed(slotId)
      return
    }
    void contents.insertCSS(sportsPlayerCss, { cssOrigin: 'user' }).catch(() => {})
    if (slotId) scheduleFeedProbe(slotId, true)
  })
  if (slotId) {
    contents.on('page-title-updated', (_event, title) => {
      sendPanelTitle(slotId, title)
      if (matchSportsPlayerUrl(contents.getURL())) scheduleFeedProbe(slotId)
    })
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      sendPanelTitle(slotId, '')
      const state = slotViews.get(slotId)
      if (!state) return
      state.videoRect = undefined
      overlayWindow?.webContents.send('quadra:panel-video-rect', { panelId: slotId, rect: null })
      if (!matchSportsPlayerUrl(details.url)) detachPanelFeed(slotId, state)
      else {
        clearFeedProbe(state)
        state.feedProbeAttempts = 0
      }
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
  stopVideoRectPolling(state)
  detachPanelFeed(id, state)
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

/** While the overlay ignores mouse events, Windows sometimes stops forwarding moves. */
let chromePassThrough = false
let pointerProxyTimer: ReturnType<typeof setInterval> | null = null
let lastPointerProxy = { x: Number.NaN, y: Number.NaN }

function stopPointerProxy() {
  if (pointerProxyTimer !== null) clearInterval(pointerProxyTimer)
  pointerProxyTimer = null
  lastPointerProxy = { x: Number.NaN, y: Number.NaN }
}

function startPointerProxy() {
  stopPointerProxy()
  pointerProxyTimer = setInterval(() => {
    if (!chromePassThrough || !overlayWindow || overlayWindow.isDestroyed()) {
      stopPointerProxy()
      return
    }
    const point = screen.getCursorScreenPoint()
    const bounds = overlayWindow.getBounds()
    if (
      point.x < bounds.x ||
      point.y < bounds.y ||
      point.x >= bounds.x + bounds.width ||
      point.y >= bounds.y + bounds.height
    ) {
      return
    }
    const x = point.x - bounds.x
    const y = point.y - bounds.y
    if (x === lastPointerProxy.x && y === lastPointerProxy.y) return
    lastPointerProxy = { x, y }
    overlayWindow.webContents.send('quadra:pointer-proxy', { x, y })
  }, 50)
}

function setOverlayMousePassThrough(passThrough: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  chromePassThrough = passThrough
  overlayWindow.setIgnoreMouseEvents(passThrough, { forward: true })
  if (passThrough) startPointerProxy()
  else stopPointerProxy()
}

function destroyAllSlotViews() {
  for (const index of [...slotViews.keys()]) destroySlotView(index)
}

function closeOwnedWindows() {
  stopPointerProxy()
  chromePassThrough = false
  destroyAllSlotViews()
  feedManager?.dispose()
  feedManager = null
  for (const catalog of Object.values(sportsCatalogs)) {
    if (catalog.window && !catalog.window.isDestroyed()) catalog.window.close()
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
}

function installAutoUpdater() {
  autoUpdateController = createAutoUpdateController({
    enabled: app.isPackaged && process.platform === 'win32',
    updater: autoUpdater,
    showMessageBox: (options) => dialog.showMessageBox(options),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
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
  view.webContents.setAudioMuted(muted)
  mainWindow?.contentView.addChildView(view)
  const state: SlotViewState = { view, url, cursorRevision: 0, videoRect: undefined, feedProbeAttempts: 0 }
  slotViews.set(id, state)
  startVideoRectPolling(state, id)
  void syncSlotCursor(state)
  void view.webContents.loadURL(url).catch(() => {})
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
      void state.view.webContents.loadURL(panel.url).catch(() => {})
    }
    state.view.webContents.setAudioMuted(panel.muted)
    state.view.setBounds({
      x: Math.round(panel.bounds.x),
      y: Math.round(panel.bounds.y),
      width: Math.max(1, Math.round(panel.bounds.width)),
      height: Math.max(1, Math.round(panel.bounds.height)),
    })
    state.view.setVisible(true)
    void measureSlotVideoRect(state, panel.id)
  }
  for (const id of [...slotViews.keys()]) {
    if (!visibleSlots.has(id)) destroySlotView(id)
  }
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
  setOverlayMousePassThrough(false)
  overlayWindow.on('closed', () => {
    stopPointerProxy()
    chromePassThrough = false
    overlayWindow = null
    overlayReady = false
    scheduleFullscreenPrioritySync()
  })
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true
    syncOverlayBounds()
    overlayWindow?.showInactive()
    raiseOverlay()
    scheduleFullscreenPrioritySync()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  const load = isDev
    ? overlayWindow.webContents.loadURL(process.env.ELECTRON_RENDERER_URL!)
    : overlayWindow.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  void load.catch(() => {})
}

function installIpcHandlers() {
  ipcMain.handle('quadra:check-for-update', (event) => {
    if (!isUiSender(event)) throw new Error('Invalid update request sender')
    return autoUpdateController?.check() ?? 'disabled'
  })
  ipcMain.on('quadra:ready', (event) => {
    if (isUiSender(event) && overlayReady) raiseOverlay()
  })
  ipcMain.on('quadra:set-layout', (event, payload: unknown) => {
    if (isUiSender(event) && isValidLayoutPayload(payload)) applyLayout(payload)
  })
  ipcMain.on('quadra:set-chrome-interactive', (event, interactive: unknown, refocusPlayers: unknown) => {
    if (!isUiSender(event) || typeof interactive !== 'boolean' || !overlayWindow) return
    setOverlayMousePassThrough(!interactive)
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
    for (const catalog of Object.values(sportsCatalogs)) {
      if (catalog.window && !catalog.window.isDestroyed()) catalog.window.close()
    }
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
  feedManager = createFeedManager({
    onAlert: (alert) => {
      overlayWindow?.webContents.send('quadra:panel-alert', {
        panelId: alert.panelId,
        kind: alert.kind,
        team: alert.team,
        label: alert.label,
      })
    },
  })
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
