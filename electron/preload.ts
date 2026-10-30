import { contextBridge, ipcRenderer } from 'electron'
import type { BllEventsResult } from '../src/bll-batch'
import type { YoutubeChannelResult, YoutubeLivesResult } from '../src/youtube-lives'
import type { LayoutPayload } from '../src/layout'
import type { AlertKind } from '../src/match-events'
import type { MatchClock } from '../src/match-clock'
import type { LiveMatchStatus, LiveVarPayload } from '../src/livescore-365'

type UiDialogPayload = { id: number; title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }
type MatchScorePayload = { panelId: string; home: string; away: string; score: string }
type MatchCrestsPayload = { panelId: string; home: string | null; away: string | null }
/** Match clock for the label; null: no clock (not started, over). */
type MatchClockPayload = { panelId: string; clock: MatchClock | null }
/** A goal's scorer, known after its alert went out. */
type MatchScorerPayload = { panelId: string; eventId: string; player: string }
type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; team?: 'home' | 'away' | 'match'; note?: string; label: string; eventId?: string; player?: string }

const quadra = {
  ready: () => ipcRenderer.send('quadra:ready'),
  setLayout: (payload: LayoutPayload) => ipcRenderer.send('quadra:set-layout', payload),
  setFullscreen: (on: boolean) => ipcRenderer.send('quadra:set-fullscreen', on),
  setChromeInteractive: (interactive: boolean, refocusPlayers = false) => ipcRenderer.send('quadra:set-chrome-interactive', interactive, refocusPlayers),
  setCursorHidden: (hidden: boolean) => ipcRenderer.send('quadra:set-cursor-hidden', hidden),
  checkForUpdate: () => ipcRenderer.invoke('quadra:check-for-update'),
  onUiDialog: (callback: (payload: UiDialogPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UiDialogPayload) => callback(payload)
    ipcRenderer.on('quadra:ui-dialog', listener)
    return () => ipcRenderer.removeListener('quadra:ui-dialog', listener)
  },
  respondUiDialog: (id: number, response: number) => ipcRenderer.send('quadra:ui-dialog-response', id, response),
  openWeddbets: (panelId: string, label: string) => ipcRenderer.send('quadra:open-weddbets', panelId, label),
  setWeddbetsTarget: (panelId: string | null, label = '') => ipcRenderer.send('quadra:set-weddbets-target', panelId, label),
  openBllsport: (panelId: string, label: string) => ipcRenderer.send('quadra:open-bllsport', panelId, label),
  setBllsportTarget: (panelId: string | null, label = '') => ipcRenderer.send('quadra:set-bllsport-target', panelId, label),
  listBllsportEvents: (): Promise<BllEventsResult> => ipcRenderer.invoke('quadra:list-bllsport-events'),
  listYoutubeLives: (channelIds: string[]): Promise<YoutubeLivesResult> => ipcRenderer.invoke('quadra:list-youtube-lives', channelIds),
  resolveYoutubeChannel: (input: string): Promise<YoutubeChannelResult> => ipcRenderer.invoke('quadra:resolve-youtube-channel', input),
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
  onMatchScorer: (callback: (payload: MatchScorerPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchScorerPayload) => callback(payload)
    ipcRenderer.on('quadra:match-scorer', listener)
    return () => ipcRenderer.removeListener('quadra:match-scorer', listener)
  },
  onMatchEnded: (callback: (payload: { panelId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string }) => callback(payload)
    ipcRenderer.on('quadra:match-ended', listener)
    return () => ipcRenderer.removeListener('quadra:match-ended', listener)
  },
  onLiveMatch: (callback: (payload: LiveMatchStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LiveMatchStatus) => callback(payload)
    ipcRenderer.on('quadra:live-match', listener)
    return () => ipcRenderer.removeListener('quadra:live-match', listener)
  },
  onLiveVar: (callback: (payload: LiveVarPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LiveVarPayload) => callback(payload)
    ipcRenderer.on('quadra:live-var', listener)
    return () => ipcRenderer.removeListener('quadra:live-var', listener)
  },
  chooseLiveMatch: (panelId: string, gameId: number | null) => ipcRenderer.send('quadra:choose-live-match', panelId, gameId),
  onMatchScore: (callback: (payload: MatchScorePayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchScorePayload) => callback(payload)
    ipcRenderer.on('quadra:match-score', listener)
    return () => ipcRenderer.removeListener('quadra:match-score', listener)
  },
  onMatchCrests: (callback: (payload: MatchCrestsPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchCrestsPayload) => callback(payload)
    ipcRenderer.on('quadra:match-crests', listener)
    return () => ipcRenderer.removeListener('quadra:match-crests', listener)
  },
  onMatchClock: (callback: (payload: MatchClockPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchClockPayload) => callback(payload)
    ipcRenderer.on('quadra:match-clock', listener)
    return () => ipcRenderer.removeListener('quadra:match-clock', listener)
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
