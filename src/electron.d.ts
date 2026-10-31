import type { BllEventsResult } from './bll-batch'
import type { YoutubeChannelResult, YoutubeLivesResult } from './youtube-lives'
import type { LayoutPayload } from './layout'
import type { AlertKind } from './match-events'
import type { MatchClock } from './match-clock'
import type { PipCommand, PipState } from './pip'
import type { LiveMatchStatus, LiveVarPayload, TeamRef365 } from './livescore-365'
import type { MatchInfoReady, MatchInfoRequest, MatchInfoResult, PhotoRef } from './match-info'

/** A dialog the main process asks the overlay to draw (update prompts); answer with `respondUiDialog`. */
type UiDialogPayload = { id: number; title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }
type MatchScorePayload = { panelId: string; home: string; away: string; score: string }
/** Crest data URLs in the feed's home/away order; null where there is none (both null: clear). */
type MatchCrestsPayload = { panelId: string; home: string | null; away: string | null }
/** Match clock for the label; null: no clock (not started, over). */
type MatchClockPayload = { panelId: string; clock: MatchClock | null }
type MatchScorerPayload = { panelId: string; eventId: string; player: string }
type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; team?: 'home' | 'away' | 'match'; note?: string; label: string; eventId?: string; player?: string }

type QuadraBridge = {
  checkForUpdate: () => Promise<UpdateCheckResult>
  ready: () => void
  onUiDialog: (callback: (payload: UiDialogPayload) => void) => () => void
  respondUiDialog: (id: number, response: number) => void
  setLayout: (payload: LayoutPayload) => void
  setFullscreen: (on: boolean) => void
  setChromeInteractive: (interactive: boolean, refocusPlayers?: boolean) => void
  setCursorHidden: (hidden: boolean) => void
  openWeddbets: (panelId: string, label: string) => void
  setWeddbetsTarget: (panelId: string | null, label?: string) => void
  openBllsport: (panelId: string, label: string) => void
  setBllsportTarget: (panelId: string | null, label?: string) => void
  listBllsportEvents: () => Promise<BllEventsResult>
  listYoutubeLives: (channelIds: string[]) => Promise<YoutubeLivesResult>
  resolveYoutubeChannel: (input: string) => Promise<YoutubeChannelResult>
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
  onMatchScorer: (callback: (payload: MatchScorerPayload) => void) => () => void
  onMatchScore: (callback: (payload: MatchScorePayload) => void) => () => void
  onMatchCrests: (callback: (payload: MatchCrestsPayload) => void) => () => void
  onMatchClock: (callback: (payload: MatchClockPayload) => void) => () => void
  onMatchEnded: (callback: (payload: { panelId: string }) => void) => () => void
  onLiveMatch: (callback: (payload: LiveMatchStatus) => void) => () => void
  onLiveVar: (callback: (payload: LiveVarPayload) => void) => () => void
  chooseLiveMatch: (panelId: string, gameId: number | null) => void
  getMatchInfo: (request: MatchInfoRequest) => Promise<MatchInfoResult>
  getTableCrests: (refs: TeamRef365[]) => Promise<Record<string, string | null>>
  getAthletePhotos: (refs: PhotoRef[]) => Promise<Record<string, string | null>>
  onMatchInfoReady: (callback: (payload: MatchInfoReady) => void) => () => void
  onPanelTitle: (callback: (payload: { panelId: string; title: string }) => void) => () => void
  onPanelVideoRect: (callback: (payload: { panelId: string; rect: { x: number; y: number; width: number; height: number } | null }) => void) => () => void
  sendPipState: (state: PipState) => void
  onPipCommand: (callback: (payload: { panelId: string; command: PipCommand }) => void) => () => void
  onPipClosed: (callback: (payload: { panelId: string }) => void) => () => void
  onPipRequestState: (callback: (payload: { panelId: string }) => void) => () => void
}

/** Bridge of the floating window (picture-in-picture): shows the state the grid sends and returns the user's commands. */
type QuadraPipBridge = {
  ready: () => void
  command: (command: PipCommand) => void
  setBarHeight: (px: number) => void
  onState: (callback: (state: PipState) => void) => () => void
}

type UpdateCheckResult = 'updated' | 'available' | 'ready' | 'busy' | 'disabled' | 'error'

declare global {
  interface Window {
    quadra?: QuadraBridge
    quadraPip?: QuadraPipBridge
  }
}

export {}
