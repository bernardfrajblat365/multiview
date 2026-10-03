import { app, BaseWindow, BrowserWindow, components, dialog, ipcMain, session, WebContentsView } from 'electron'
import electronUpdater from 'electron-updater'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bounds, LayoutPayload, PanelPayload } from '../src/layout'
import { prepareProtectedPlayback } from './protected-playback'
import { createAutoUpdateController } from './update'

const { autoUpdater } = electronUpdater

type SlotViewState = { view: WebContentsView; url: string; cursorCssKey?: string; cursorRevision: number }

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

function configureRemoteContents(contents: Electron.WebContents, slotId?: string) {
  contents.setUserAgent(electronUserAgent)
  contents.on('did-finish-load', () => {
    void contents.insertCSS(videoContainCss, { cssOrigin: 'user' }).catch(() => {})
    if (!matchSportsPlayerUrl(contents.getURL())) return
    void contents.insertCSS(sportsPlayerCss, { cssOrigin: 'user' }).catch(() => {})
  })
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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(state.view)
  if (!state.view.webContents.isDestroyed()) state.view.webContents.close()
  slotViews.delete(id)
}

async function syncSlotCursor(state: SlotViewState) {
  const revision = ++state.cursorRevision
  if (!cursorHidden) {
    const key = state.cursorCssKey
    state.cursorCssKey = undefined
    if (key && !state.view.webContents.isDestroyed()) await state.view.webContents.removeInsertedCSS(key).catch(() => {})
    return
  }
  if (state.cursorCssKey || state.view.webContents.isDestroyed()) return
  const key = await state.view.webContents.insertCSS('* { cursor: none !important; }').catch(() => '')
  if (!key) return
  if (revision !== state.cursorRevision || !cursorHidden || state.view.webContents.isDestroyed()) {
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

function closeOwnedWindows() {
  destroyAllSlotViews()
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
    },
  })
  configureRemoteContents(view.webContents, id)
  view.webContents.setAudioMuted(muted)
  mainWindow?.contentView.addChildView(view)
  const state: SlotViewState = { view, url, cursorRevision: 0 }
  slotViews.set(id, state)
  if (cursorHidden) void syncSlotCursor(state)
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
  if (!Number.isInteger(payload.panelCount) || Number(payload.panelCount) < 1 || Number(payload.panelCount) > 16) return false
  if (payload.mode !== 'auto' && payload.mode !== 'equal' && payload.mode !== 'highlights') return false
  if (!Array.isArray(payload.panels) || payload.panels.length > 16) return false
  if (payload.view === 'grid' && payload.panels.length !== payload.panelCount) return false
  const ids = new Set<string>()
  return payload.panels.every((panel) => {
    if (!panel || typeof panel !== 'object') return false
    const candidate = panel as Partial<PanelPayload>
    if (typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 80 || ids.has(candidate.id)) return false
    ids.add(candidate.id)
    return typeof candidate.url === 'string' && candidate.url.length <= 4096 &&
      typeof candidate.muted === 'boolean' && typeof candidate.editing === 'boolean' &&
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
    if (!state) state = createSlotView(panel.id, panel.url, panel.muted)
    state.view.webContents.setAudioMuted(panel.muted)
    if (state.url !== panel.url) {
      state.url = panel.url
      void state.view.webContents.loadURL(panel.url).catch(() => {})
    }
    state.view.setBounds({
      x: Math.round(panel.bounds.x),
      y: Math.round(panel.bounds.y),
      width: Math.max(1, Math.round(panel.bounds.width)),
      height: Math.max(1, Math.round(panel.bounds.height)),
    })
    state.view.setVisible(true)
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
  overlayWindow.setIgnoreMouseEvents(false)
  overlayWindow.on('closed', () => {
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
  ipcMain.on('quadra:set-chrome-interactive', (event, interactive: unknown) => {
    if (!isUiSender(event) || typeof interactive !== 'boolean' || !overlayWindow) return
    overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true })
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
