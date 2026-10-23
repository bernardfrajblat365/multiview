import type { BllEventsResult } from './bll-batch'
import type { YoutubeLivesResult } from './youtube-lives'
import type { LayoutPayload } from './layout'
import type { AlertKind } from './match-events'
import type { LiveMatchStatus } from './livescore-365'

type MatchScorePayload = { panelId: string; home: string; away: string; score: string }
type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; note?: string; label: string }

type QuadraBridge = {
  checkForUpdate: () => Promise<UpdateCheckResult>
  ready: () => void
  setLayout: (payload: LayoutPayload) => void
  setFullscreen: (on: boolean) => void
  setChromeInteractive: (interactive: boolean, refocusPlayers?: boolean) => void
  setCursorHidden: (hidden: boolean) => void
  openWeddbets: (panelId: string, label: string) => void
  setWeddbetsTarget: (panelId: string | null, label?: string) => void
  openBllsport: (panelId: string, label: string) => void
  setBllsportTarget: (panelId: string | null, label?: string) => void
  listBllsportEvents: () => Promise<BllEventsResult>
  listYoutubeLives: () => Promise<YoutubeLivesResult>
  onRequestLayout: (callback: () => void) => () => void
  onFullscreenChange: (callback: (on: boolean) => void) => () => void
  onWeddbetsPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => () => void
  onWeddbetsTargetRequired: (callback: () => void) => () => void
  onWeddbetsError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => () => void
  onBllsportPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => () => void
  onBllsportTargetRequired: (callback: () => void) => () => void
  onBllsportError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => () => void
  openMonitor: () => void
  onMatchEvent: (callback: (payload: MatchEventPayload) => void) => () => void
  onMatchScore: (callback: (payload: MatchScorePayload) => void) => () => void
  onLiveMatch: (callback: (payload: LiveMatchStatus) => void) => () => void
  chooseLiveMatch: (panelId: string, gameId: number | null) => void
  onPanelTitle: (callback: (payload: { panelId: string; title: string }) => void) => () => void
  onPanelVideoRect: (callback: (payload: { panelId: string; rect: { x: number; y: number; width: number; height: number } | null }) => void) => () => void
}

type UpdateCheckResult = 'updated' | 'available' | 'ready' | 'busy' | 'disabled' | 'error'

declare global {
  interface Window {
    quadra?: QuadraBridge
  }
}

export {}
