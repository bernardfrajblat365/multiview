import { contextBridge, ipcRenderer } from 'electron'
import type { BllEventsResult } from '../src/bll-batch'
import type { YoutubeLivesResult } from '../src/youtube-lives'
import type { LayoutPayload } from '../src/layout'
import type { AlertKind } from '../src/match-events'
import type { LiveMatchStatus } from '../src/livescore-365'

type MatchScorePayload = { panelId: string; home: string; away: string; score: string }
type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; note?: string; label: string }

const quadra = {
  ready: () => ipcRenderer.send('quadra:ready'),
  setLayout: (payload: LayoutPayload) => ipcRenderer.send('quadra:set-layout', payload),
  setFullscreen: (on: boolean) => ipcRenderer.send('quadra:set-fullscreen', on),
  setChromeInteractive: (interactive: boolean, refocusPlayers = false) => ipcRenderer.send('quadra:set-chrome-interactive', interactive, refocusPlayers),
  setCursorHidden: (hidden: boolean) => ipcRenderer.send('quadra:set-cursor-hidden', hidden),
  checkForUpdate: () => ipcRenderer.invoke('quadra:check-for-update'),
  openWeddbets: (panelId: string, label: string) => ipcRenderer.send('quadra:open-weddbets', panelId, label),
  setWeddbetsTarget: (panelId: string | null, label = '') => ipcRenderer.send('quadra:set-weddbets-target', panelId, label),
  openBllsport: (panelId: string, label: string) => ipcRenderer.send('quadra:open-bllsport', panelId, label),
  setBllsportTarget: (panelId: string | null, label = '') => ipcRenderer.send('quadra:set-bllsport-target', panelId, label),
  listBllsportEvents: (): Promise<BllEventsResult> => ipcRenderer.invoke('quadra:list-bllsport-events'),
  listYoutubeLives: (): Promise<YoutubeLivesResult> => ipcRenderer.invoke('quadra:list-youtube-lives'),
  onRequestLayout: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quadra:request-layout', listener)
    return () => ipcRenderer.removeListener('quadra:request-layout', listener)
  },
  onFullscreenChange: (callback: (on: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, on: boolean) => callback(on)
    ipcRenderer.on('quadra:fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('quadra:fullscreen-changed', listener)
  },
  onWeddbetsPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string; url: string }) => callback(payload)
    ipcRenderer.on('quadra:weddbets-player-opened', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-player-opened', listener)
  },
  onWeddbetsTargetRequired: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quadra:weddbets-target-required', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-target-required', listener)
  },
  onWeddbetsError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { message: string; panelId?: string; url?: string }) => callback(payload)
    ipcRenderer.on('quadra:weddbets-error', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-error', listener)
  },
  onBllsportPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string; url: string }) => callback(payload)
    ipcRenderer.on('quadra:bllsport-player-opened', listener)
    return () => ipcRenderer.removeListener('quadra:bllsport-player-opened', listener)
  },
  onBllsportTargetRequired: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quadra:bllsport-target-required', listener)
    return () => ipcRenderer.removeListener('quadra:bllsport-target-required', listener)
  },
  onBllsportError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { message: string; panelId?: string; url?: string }) => callback(payload)
    ipcRenderer.on('quadra:bllsport-error', listener)
    return () => ipcRenderer.removeListener('quadra:bllsport-error', listener)
  },
  openMonitor: () => ipcRenderer.send('quadra:open-monitor'),
  onMatchEvent: (callback: (payload: MatchEventPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchEventPayload) => callback(payload)
    ipcRenderer.on('quadra:match-event', listener)
    return () => ipcRenderer.removeListener('quadra:match-event', listener)
  },
  onLiveMatch: (callback: (payload: LiveMatchStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LiveMatchStatus) => callback(payload)
    ipcRenderer.on('quadra:live-match', listener)
    return () => ipcRenderer.removeListener('quadra:live-match', listener)
  },
  chooseLiveMatch: (panelId: string, gameId: number | null) => ipcRenderer.send('quadra:choose-live-match', panelId, gameId),
  onMatchScore: (callback: (payload: MatchScorePayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchScorePayload) => callback(payload)
    ipcRenderer.on('quadra:match-score', listener)
    return () => ipcRenderer.removeListener('quadra:match-score', listener)
  },
  onPanelTitle: (callback: (payload: { panelId: string; title: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string; title: string }) => callback(payload)
    ipcRenderer.on('quadra:panel-title', listener)
    return () => ipcRenderer.removeListener('quadra:panel-title', listener)
  },
  onPanelVideoRect: (callback: (payload: { panelId: string; rect: { x: number; y: number; width: number; height: number } | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { panelId: string; rect: { x: number; y: number; width: number; height: number } | null },
    ) => callback(payload)
    ipcRenderer.on('quadra:panel-video-rect', listener)
    return () => ipcRenderer.removeListener('quadra:panel-video-rect', listener)
  },
}

contextBridge.exposeInMainWorld('quadra', quadra)
