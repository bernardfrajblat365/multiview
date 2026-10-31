import { BrowserWindow, screen, type BaseWindow, type WebContentsView } from 'electron'
import {
  clampPipBar,
  defaultPipBounds,
  PIP_BAR_MIN,
  PIP_FRAME,
  PIP_MIN_HEIGHT,
  PIP_MIN_WIDTH,
  pipViewBounds,
  type PipBounds,
} from '../src/pip'

type PipWindowOptions = {
  preloadPath: string
  icon: string
  getMainWindow: () => BaseWindow | null
  /** Loads a floating window's page (dev server or packaged file). */
  loadPage: (contents: Electron.WebContents) => Promise<unknown>
  /** The system closed a window (Alt+F4): the panel's view is already detached and must go back to the grid. */
  onClosed: (panelId: string, view: WebContentsView) => void
}

type PipEntry = {
  window: BrowserWindow
  view: WebContentsView
  barHeight: number
  /** Position among the open windows, so a new one does not land exactly on another. */
  slot: number
}

/**
 * The floating windows of the panels in picture-in-picture: small always-on-top windows, one per panel, each holding the panel's view
 * under a bar the Quadra draws (score, alerts, buttons). A view moves between windows without reloading its page.
 */
export function createPipWindowController(options: PipWindowOptions) {
  const entries = new Map<string, PipEntry>()
  // Position and size last used by each panel; lives only as long as the app, like the rest of the layout.
  const lastBounds = new Map<string, PipBounds>()
  // Windows the controller closed itself: their 'closed' event is not a system close.
  const released = new WeakSet<BrowserWindow>()

  const entryOf = (contents: Electron.WebContents) => {
    for (const [id, entry] of entries) if (!entry.window.isDestroyed() && entry.window.webContents === contents) return { id, entry }
    return null
  }

  const relayout = (entry: PipEntry) => {
    if (entry.window.isDestroyed()) return
    const [width, height] = entry.window.getContentSize()
    entry.view.setBounds(pipViewBounds({ width, height }, entry.barHeight))
  }

  const applyAspectRatio = (entry: PipEntry) => {
    if (entry.window.isDestroyed()) return
    entry.window.setAspectRatio(16 / 9, { width: 2 * PIP_FRAME, height: entry.barHeight + PIP_FRAME })
  }

  /** Resizes the window so the view under the bar is exactly 16:9, whatever the bar's height turned out to be. */
  const fitToVideo = (entry: PipEntry) => {
    if (entry.window.isDestroyed()) return
    const [width, height] = entry.window.getContentSize()
    const target = Math.round(((width - 2 * PIP_FRAME) * 9) / 16) + entry.barHeight + PIP_FRAME
    if (Math.abs(height - target) > 1) entry.window.setContentSize(width, target)
  }

  const freeSlot = () => {
    const used = new Set([...entries.values()].map((entry) => entry.slot))
    let slot = 0
    while (used.has(slot)) slot++
    return slot
  }

  const create = (id: string, panelView: WebContentsView, title: string) => {
    const mainBounds = options.getMainWindow()?.getBounds()
    const workArea = (mainBounds ? screen.getDisplayMatching(mainBounds) : screen.getPrimaryDisplay()).workArea
    const slot = freeSlot()
    const bounds = lastBounds.get(id) ?? defaultPipBounds(workArea, PIP_BAR_MIN + 4, slot)
    const created = new BrowserWindow({
      ...bounds,
      title,
      icon: options.icon,
      frame: false,
      show: false,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: '#000000',
      minWidth: PIP_MIN_WIDTH,
      minHeight: PIP_MIN_HEIGHT,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // The ESM preload cannot load in a sandboxed renderer; the page is local HTML with no remote content.
        sandbox: false,
        backgroundThrottling: false,
        preload: options.preloadPath,
      },
    })
    const entry: PipEntry = { window: created, view: panelView, barHeight: PIP_BAR_MIN + 4, slot }
    entries.set(id, entry)
    created.setAlwaysOnTop(true, 'screen-saver')
    applyAspectRatio(entry)
    created.webContents.on('will-navigate', (event) => event.preventDefault())
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
    created.on('resize', () => {
      relayout(entry)
      if (!created.isDestroyed()) lastBounds.set(id, created.getBounds())
    })
    // Windows' own aspect ratio lock lets a few pixels through; settle them once the user lets go.
    created.on('resized', () => fitToVideo(entry))
    created.on('move', () => {
      if (!created.isDestroyed()) lastBounds.set(id, created.getBounds())
    })
    // Take the view out before the window goes away, so closing the window never takes the page with it.
    created.on('close', () => created.contentView.removeChildView(entry.view))
    created.on('closed', () => {
      if (released.has(created) || entries.get(id) !== entry) return
      entries.delete(id)
      options.onClosed(id, entry.view)
    })
    void options.loadPage(created.webContents).catch(() => {})
    return entry
  }

  const release = (id: string): WebContentsView | null => {
    const entry = entries.get(id)
    if (!entry) return null
    entries.delete(id)
    if (entry.window.isDestroyed()) return null
    released.add(entry.window)
    entry.window.contentView.removeChildView(entry.view)
    entry.window.close()
    return entry.view
  }

  return {
    has: (id: string) => entries.has(id),
    /** The panel shown by this floating window's page, or null if the contents are not one of them. */
    panelIdOf: (contents: Electron.WebContents) => entryOf(contents)?.id ?? null,
    isPipContents: (contents: Electron.WebContents) => entryOf(contents) !== null,
    /** Puts the panel's view in its floating window, opening it if needed. */
    show(id: string, panelView: WebContentsView, title: string) {
      const current = entries.get(id)
      if (current && !current.window.isDestroyed() && current.view === panelView) return
      release(id)
      const entry = create(id, panelView, title)
      entry.window.contentView.addChildView(panelView)
      relayout(entry)
      fitToVideo(entry)
      entry.window.showInactive()
      entry.window.moveTop()
    },
    /** Takes the view back out and closes the window; the caller gives the view back to the grid. */
    release,
    releaseAll() {
      for (const id of [...entries.keys()]) release(id)
    },
    setBarHeight(contents: Electron.WebContents, px: number) {
      const found = entryOf(contents)
      if (!found) return
      const next = clampPipBar(px)
      if (next === found.entry.barHeight) return
      found.entry.barHeight = next
      applyAspectRatio(found.entry)
      fitToVideo(found.entry)
      relayout(found.entry)
    },
    raise() {
      for (const entry of entries.values()) if (!entry.window.isDestroyed()) entry.window.moveTop()
    },
    send(id: string, channel: string, payload?: unknown) {
      const entry = entries.get(id)
      if (!entry || entry.window.isDestroyed()) return
      const contents = entry.window.webContents
      // The page's ready signal can come before its load event; hold the message until it has loaded.
      if (contents.isLoading()) contents.once('did-finish-load', () => { if (!contents.isDestroyed()) contents.send(channel, payload) })
      else contents.send(channel, payload)
    },
  }
}
