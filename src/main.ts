import './style.css'
import { version } from '../package.json'
import { normalizeUrl } from './routing'
import { batchCapacity, groupByCompetition, groupByLeague, groupByTime, loadBllBatchOrder, planBatchOpen, saveBllBatchOrder, stageOf, type BllBatchOrder, type BllEvent, type BllEventGroup } from './bll-batch'
import {
  DEFAULT_YOUTUBE_CHANNELS,
  loadYoutubeChannels,
  MAX_YOUTUBE_CHANNELS,
  saveYoutubeChannels,
  type YoutubeChannel,
  type YoutubeChannelResult,
  type YoutubeLivesResult,
} from './youtube-lives'
import { setAlertAudioAwake } from './alert-sounds'
import {
  autoOpenDecision,
  COMPETITION_MODE_LABEL,
  COMPETITIONS,
  defaultAutoOpenSettings,
  loadAutoOpenSettings,
  mainTeamOf,
  MAX_CUSTOM_COMPETITIONS,
  MAX_TEAMS,
  planAutoOpen,
  saveAutoOpenSettings,
  teamDisplayName,
  type AutoOpenCandidate,
  type AutoOpenSettings,
  type CompetitionMode,
  type CompetitionRule,
} from './auto-open'
import { alertControlsHtml, applyAlertStates, bindAlertControls, clearAlert, clearVarReview, getAlertSettings, handleMatchEvent, handleScorerName, onAlertSettingsChange, onAlertShown, onVarReviewStarted, setVarReview, type MatchEventPayload } from './alert-ui'
import { LIVE_DELAY_OPTIONS } from './alert-settings'
import { createInfoDrawer, updateInfoButton } from './info-drawer'
import { FIRST_STEPS, markFirstStepsSeen, readFirstStepsSeen, shouldShowFirstSteps } from './first-steps'
import { RELEASES, markVersionSeen, readLastSeenVersion, releaseHistory, releaseToShow, type Release } from './release-notes'
import type { LiveMatchStatus, LiveVarPayload } from './livescore-365'
import { AUTO_MIN_PANELS, VAR_MAX_MS, composeHighlighted, endVarAuto, expireAutos, registerGoal, secondsLeft, type AutoEntry } from './auto-highlight'
import {
  buildLayoutTree,
  calculateLayout,
  defaultHighlightCount,
  getCompositions,
  MAX_PANELS,
  resolveComposition,
  swapPanels,
  type HighlightPosition,
  type LayoutMode,
  type LayoutNode,
  type PanelId,
} from './layout'
import {
  extractMatchLabel,
  formatScore,
  orientScore,
  parseScore,
  placeMatchLabel,
  rollColumns,
  splitMatchTeams,
  teamsReversed,
  type MatchScore,
  type NormRect,
} from './match-label'
import { createScoreTimeline, nextScoreChangeAt, pushScore, visibleScore, type ScoreTimeline } from './score-delay'
import { clockElapsedAt, clockView, createClockTimeline, nextClockChangeAt, pushClock, visibleClock, type ClockTimeline, type ClockView } from './match-clock'
import { isBreakPeriod, planHalftimeSwaps, type HalftimeSwap, type SwapPanelInfo } from './halftime-swap'
import {
  buildOrganizerChoices,
  organizerDraftKey,
  organizerDraftValid,
  type OrganizerChoice,
  type OrganizerDraft,
} from './organizer'

type View = 'choose' | 'grid'
type Panel = { id: PanelId; url: string; draftUrl: string; muted: boolean; alertsOff: boolean }
type LayoutSnapshot = {
  panels: Panel[]
  highlighted: PanelId[]
  tree: LayoutNode
  mode: LayoutMode
  position: HighlightPosition | undefined
  variant: string | undefined
  order: PanelId[]
}

const app = document.querySelector<HTMLDivElement>('#app')!
const APP_VERSION = `v${version}`
const MIN_PANELS = 1
const HISTORY_LIMIT = 24
const TOOLBAR_IDLE_MS = 5_000
const BACK_IDLE_MS = 2_000
/** Top-left hot zone (px) where the mouse summons the back button. */
const BACK_ZONE = { width: 170, height: 90 }
const DRAG_THRESHOLD_PX = 6
type DragState = { sourceId: PanelId; pointerId: number; startX: number; startY: number; active: boolean; targetId: PanelId | null; abort: AbortController }
let dragState: DragState | null = null
let highlightPosition: HighlightPosition | undefined
let compositionVariant: string | undefined
let panelOrder: PanelId[] = []
let resolvedHighlightPosition: HighlightPosition | undefined

let view: View = 'choose'
let panelSerial = 1
let panels: Panel[] = []
let highlighted = new Set<PanelId>()
let layoutMode: LayoutMode = 'auto'
let layoutTree: LayoutNode
let editorOpen = false
let organizerDraft: OrganizerDraft | null = null
let organizerBaselineKey = ''
let organizerChoices: OrganizerChoice[] = []
let organizerAspect = 0
let organizerNotice = ''
let history: LayoutSnapshot[] = []
let nativeFullscreen = false
let layoutSyncFrame: number | null = null
let layoutResizeFrame: number | null = null
let lastChromeInteractive: boolean | null = null
let pendingFocusPanelId: PanelId | null = null
let bllsportTargetId: PanelId | null = null
let showMatchLabels = true
const forceReloadIds = new Set<PanelId>()
/** Panels promoted to highlights by a goal; they return to the user's layout after the chosen time. */
type AutoBaseline = { highlighted: PanelId[]; mode: LayoutMode; position: HighlightPosition | undefined; variant: string | undefined }
let autoEntries: AutoEntry[] = []
let autoBaseline: AutoBaseline | null = null
let autoTimer: number | null = null
/** Highlights of the user at half-time, swapped with a game being played until their break ends. */
let halftimeSwaps: HalftimeSwap[] = []
/** Highlights the user kept in their break ("Voltar", "Fixar" or a manual change): not swapped again until it ends. */
const halftimeSkipped = new Set<PanelId>()
let halftimeCheckTimer: number | null = null
/** While the user organizes, drags or answers a dialog, the half-time swap waits this long to try again. */
const HALFTIME_RETRY_MS = 5000
const panelTitles = new Map<PanelId, string>()
const panelVideoRects = new Map<PanelId, NormRect | null>()
/** Per-panel dismiss; restored when the user opens/reloads the panel URL. */
const dismissedMatchLabels = new Set<PanelId>()
/** Teams and score history from the William Hill feed, per panel. */
const panelFeeds = new Map<PanelId, { home: string; away: string; timeline: ScoreTimeline }>()
type Crests = { home: string | null; away: string | null }
/** Team crests (data URLs, in the feed's home/away order) from 365Scores; they arrive after the names and score. */
const panelCrests = new Map<PanelId, Crests>()
/** Match clock readings per panel (William Hill or 365Scores), held back like the score. */
const panelClocks = new Map<PanelId, ClockTimeline>()
/** Last score shown per panel, to flash the label (or roll the numbers, in basketball) when it changes. */
const shownScores = new Map<PanelId, MatchScore>()
const scoreFlashUntil = new Map<PanelId, number>()
/** Which numbers of the score lit up with the last change (the team(s) that scored). */
const scoreFlashSides = new Map<PanelId, { home: boolean; away: boolean }>()
const SCORE_FLASH_MS = 6000
let labelRefreshTimer: number | null = null
/** Some label shows a running clock or the half-time countdown, so the labels refresh every second. */
let clockTicking = false
/** 365Scores link of each YouTube panel (and BLL panel without a William Hill feed), as reported by the main process. */
const panelLive = new Map<PanelId, LiveMatchStatus>()
/** Panels whose game has info for the drawer (a 365Scores game, or William Hill's own line-up); the 👕 button shows only for these. */
const matchInfoReady = new Set<PanelId>()
/** Per-panel delay (s) chosen on a 365Scores-linked panel; memory only, like the rest of the panel state. */
const panelDelayOverride = new Map<PanelId, number>()
/** Alerts of 365Scores-linked panels waiting for the video to catch up with the data. */
const pendingAlerts = new Map<PanelId, Set<number>>()

/** Panels whose match a source (William Hill, 365Scores or the BLL list) reported over, counting down to close; "Manter aberto" cancels. */
const finishedPanels = new Map<PanelId, { showAt: number; closeAt: number }>()
/** "Manter aberto" holds for the rest of the match: a later end notice from another source doesn't count down again. */
const keptFinishedPanels = new Set<PanelId>()
let finishedTimer: number | null = null

/** Auto mode: re-reads the BLL list and opens the games that start in the chosen competitions; on/off lasts only for this session. */
const AUTO_OPEN_POLL_MS = Number(new URLSearchParams(location.search).get('auto-open-poll-ms')) || 25_000
/** While the user organizes, drags, answers a dialog or a goal is highlighted, new games wait this long to try again. */
const AUTO_OPEN_RETRY_MS = 5000
let autoOpenOn = false
let autoOpenSettings = loadAutoOpenSettings()
/** Panels Auto mode opened, in the order it opened them; a main-team game may take the oldest one without a main team. */
const autoOpenPanels = new Map<PanelId, { url: string; mainTeam: boolean }>()
/** Games the user closed or swapped in a panel Auto mode opened: they don't come back. */
const autoOpenDismissed = new Set<string>()
/** Games Auto mode already opened since it was turned on. */
const autoOpenSeen = new Set<string>()
let autoOpenEvents: BllEvent[] = []
let autoOpenTimer: number | null = null
let autoOpenRetryTimer: number | null = null
let autoOpenReading = false
let autoOpenReadAt = 0
let autoOpenError = ''
let autoOpenSkipped = 0
/** A panel can't close while the user is organizing, dragging or answering a dialog; it tries again after this. */
const FINISHED_RETRY_MS = 5000

/** Label order vs feed order: 1 when the title lists the teams the other way round than the feed (crests and the first team follow it). */
function feedTeamsFlipped(id: PanelId) {
  const titleLabel = extractMatchLabel(panelTitles.get(id) ?? '')
  const titleTeams = titleLabel ? splitMatchTeams(titleLabel) : null
  const feed = panelFeeds.get(id)
  return Boolean(titleTeams && feed?.home && feed.away && teamsReversed(titleTeams, { home: feed.home, away: feed.away }))
}

const infoDrawer = createInfoDrawer({
  panelElement: (id) => app.querySelector<HTMLElement>(`.panel[data-panel-id="${CSS.escape(id)}"]`),
  canOpen: (id) => view === 'grid' && !editorOpen && Boolean(panelById(id)?.url) && matchInfoReady.has(id),
  crests: (id) => {
    const crests = panelCrests.get(id)
    return [crests?.home ?? null, crests?.away ?? null]
  },
  firstTeam: (id) => (feedTeamsFlipped(id) ? 1 : 0),
  onChange: () => updateLiveControls(),
})

function clearPendingAlerts(id: PanelId) {
  for (const timer of pendingAlerts.get(id) ?? []) window.clearTimeout(timer)
  pendingAlerts.delete(id)
}

function clearPanelMatchState(id: PanelId) {
  matchInfoReady.delete(id)
  infoDrawer.forget(id)
  panelLive.delete(id)
  panelDelayOverride.delete(id)
  clearPendingAlerts(id)
  clearVarReview(id, app)
  finishedPanels.delete(id)
  keptFinishedPanels.delete(id)
  panelTitles.delete(id)
  panelVideoRects.delete(id)
  dismissedMatchLabels.delete(id)
  panelFeeds.delete(id)
  panelCrests.delete(id)
  panelClocks.delete(id)
  shownScores.delete(id)
  scoreFlashUntil.delete(id)
  scoreFlashSides.delete(id)
}

function clearAllPanelMatchState() {
  matchInfoReady.clear()
  infoDrawer.close()
  for (const id of [...pendingAlerts.keys()]) clearPendingAlerts(id)
  finishedPanels.clear()
  keptFinishedPanels.clear()
  panelLive.clear()
  panelDelayOverride.clear()
  panelTitles.clear()
  panelVideoRects.clear()
  dismissedMatchLabels.clear()
  panelFeeds.clear()
  panelCrests.clear()
  shownScores.clear()
  scoreFlashUntil.clear()
  scoreFlashSides.clear()
}

function scoreDelayMs() {
  const delay = getAlertSettings().scoreDelaySec
  return delay === null ? null : delay * 1000
}

function isLiveLinked(id: PanelId) {
  return panelLive.get(id)?.status === 'linked'
}

/** Score delay of one panel: a 365Scores-linked panel may have its own; null hides the score everywhere. */
function panelScoreDelayMs(id: PanelId) {
  const global = scoreDelayMs()
  if (global === null) return null
  const own = isLiveLinked(id) ? panelDelayOverride.get(id) : undefined
  return own === undefined ? global : own * 1000
}

/** Videos trail the 365Scores data, so 365Scores alerts wait as long as their score. William Hill alerts stay immediate. */
function panelAlertDelayMs(id: PanelId) {
  if (!isLiveLinked(id)) return 0
  const own = panelDelayOverride.get(id)
  return own !== undefined ? own * 1000 : scoreDelayMs() ?? 0
}

/** Wakes the labels up when a held-back score or a goal flash is due. */
function scheduleLabelRefresh(now: number) {
  if (labelRefreshTimer !== null) window.clearTimeout(labelRefreshTimer)
  labelRefreshTimer = null
  let next: number | null = null
  const consider = (at: number | null) => {
    if (at !== null && at > now && (next === null || at < next)) next = at
  }
  for (const [id, feed] of panelFeeds) {
    const delay = panelScoreDelayMs(id)
    if (delay !== null) consider(nextScoreChangeAt(feed.timeline, now, delay))
  }
  for (const [id, timeline] of panelClocks) {
    const delay = panelScoreDelayMs(id)
    if (delay !== null) consider(nextClockChangeAt(timeline, now, delay))
  }
  for (const until of scoreFlashUntil.values()) consider(until)
  // A clock on screen ticks: wake up on the next whole second.
  if (clockTicking) consider(now + 1000 - (now % 1000))
  if (next === null) return
  labelRefreshTimer = window.setTimeout(() => {
    labelRefreshTimer = null
    updatePanelLabels()
  }, Math.max(0, next - now) + 30)
}

function panelMatch(id: PanelId, now: number): { home: string; away: string; score: MatchScore | null; crests: Crests; clock: ClockView | null } | null {
  const feed = panelFeeds.get(id)
  const titleLabel = extractMatchLabel(panelTitles.get(id) ?? '')
  const titleTeams = titleLabel ? splitMatchTeams(titleLabel) : null
  const feedTeams = feed?.home && feed.away ? { home: feed.home, away: feed.away } : null
  const teams = titleTeams ?? feedTeams
  if (!teams) return null
  const delay = panelScoreDelayMs(id)
  let score = feed && delay !== null ? visibleScore(feed.timeline, now, delay) : null
  if (score && titleTeams && feedTeams) score = orientScore(titleTeams, feedTeams, score)
  const feedCrests = panelCrests.get(id) ?? { home: null, away: null }
  const crests = titleTeams && feedTeams && teamsReversed(titleTeams, feedTeams)
    ? { home: feedCrests.away, away: feedCrests.home }
    : feedCrests
  // The clock follows the score's delay (and hides with it): the video trails the feed.
  const timeline = panelClocks.get(id)
  const reading = timeline && delay !== null ? visibleClock(timeline, now, delay) : null
  const clock = reading && delay !== null ? clockView(reading, now - delay) : null
  return { ...teams, score, crests, clock }
}

/** Width the label reserves for the clock box; the time counts as at least "00:00" so it doesn't jitter each second. */
function clockChars(clock: ClockView | null) {
  if (!clock) return 0
  return clock.tag.length + (clock.time ? 1 + Math.max(5, clock.time.length) : 0)
}

/** The clock box after the names: a tag ("2T", "Intervalo") and the time, which ticks in place. */
function clockBox(clock: ClockView) {
  const box = document.createElement('span')
  box.className = clock.paused ? 'panel__label-clock panel__label-clock--paused' : 'panel__label-clock'
  box.title = clock.title
  box.append(labelSpan('panel__label-clock-tag', clock.tag))
  box.append(labelSpan('panel__label-clock-time', clock.time))
  return box
}

function updateClockBox(labelElement: HTMLElement, clock: ClockView | null) {
  const box = labelElement.querySelector<HTMLElement>('.panel__label-clock')
  if (!box || !clock) return
  const time = box.querySelector<HTMLElement>('.panel__label-clock-time')
  if (time && time.textContent !== clock.time) time.textContent = clock.time
  box.title = clock.title
}

function crestImage(src: string | null, fresh: boolean) {
  if (!src) return null
  const image = document.createElement('img')
  // A crest that just arrived fades in; later rebuilds (score changes) show it at once.
  image.className = fresh ? 'panel__label-crest panel__label-crest--new' : 'panel__label-crest'
  image.alt = ''
  image.src = src
  return image
}

function labelSpan(className: string, text: string) {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

/** A score number; when it just changed, the digits that moved roll up from the old value like a roulette. */
function scoreNumber(value: number, from: number | undefined, lit = false) {
  const span = document.createElement('span')
  span.className = lit ? 'panel__label-number panel__label-number--lit' : 'panel__label-number'
  if (from === undefined || from === value) {
    span.textContent = String(value)
    return span
  }
  for (const column of rollColumns(from, value)) {
    if (column.length === 1) {
      span.append(column[0])
      continue
    }
    const roll = document.createElement('span')
    roll.className = 'panel__label-roll'
    const strip = document.createElement('span')
    strip.className = 'panel__label-roll-strip'
    strip.style.setProperty('--roll-end', `${(-(column.length - 1) / column.length) * 100}%`)
    strip.style.setProperty('--roll-steps', String(column.length - 1))
    for (const digit of column) strip.append(labelSpan('panel__label-roll-digit', digit || ' '))
    roll.append(strip)
    span.append(roll)
  }
  return span
}

function scoreLabel(score: MatchScore, from: MatchScore | null, lit: { home: boolean; away: boolean }) {
  const span = document.createElement('span')
  span.className = 'panel__label-score'
  span.append(scoreNumber(score.home, from?.home, lit.home), ' – ', scoreNumber(score.away, from?.away, lit.away))
  return span
}

function ensureMatchLabelDismiss(labelElement: HTMLElement, panelId: PanelId) {
  let dismiss = labelElement.querySelector<HTMLButtonElement>('.panel__label-dismiss')
  if (dismiss) return dismiss
  dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'panel__label-dismiss'
  dismiss.dataset.dismissLabel = ''
  dismiss.setAttribute('aria-label', 'Ocultar nome do jogo')
  dismiss.title = 'Ocultar nome (abra o link de novo para mostrar)'
  dismiss.textContent = '×'
  dismiss.addEventListener('pointerenter', () => setChromeInteractive(true))
  dismiss.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    setChromeInteractive(true)
  })
  dismiss.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    dismissedMatchLabels.add(panelId)
    updatePanelLabels()
  })
  return dismiss
}

function updatePanelLabels() {
  const stage = app.querySelector<HTMLElement>('#layout-stage')
  if (!stage) return
  const now = Date.now()
  clockTicking = false
  for (const panelElement of stage.querySelectorAll<HTMLElement>('.panel')) {
    const id = panelElement.dataset.panelId
    if (!id) continue
    const panel = panelById(id)
    const existing = panelElement.querySelector<HTMLElement>('.panel__label')
    const match =
      showMatchLabels && panel?.url && panelElement.classList.contains('panel--loaded') && !dismissedMatchLabels.has(id)
        ? panelMatch(id, now)
        : null
    if (!match) {
      existing?.remove()
      continue
    }
    const scoreText = match.score ? formatScore(match.score) : ''
    const previousScore = shownScores.get(id)
    const scoreChanged = Boolean(match.score && previousScore && formatScore(previousScore) !== scoreText)
    // Basketball scores all the time: the numbers only roll, without lighting up the label.
    const basketball = panelLive.get(id)?.sport === 'basketball'
    if (scoreChanged && !basketball) {
      scoreFlashUntil.set(id, now + SCORE_FLASH_MS)
      scoreFlashSides.set(id, { home: Boolean(previousScore && match.score && match.score.home > previousScore.home), away: Boolean(previousScore && match.score && match.score.away > previousScore.away) })
    }
    if (match.score) shownScores.set(id, match.score)
    const rollFrom = scoreChanged && basketball ? previousScore ?? null : null
    const flashUntil = scoreFlashUntil.get(id) ?? 0
    if (flashUntil && flashUntil <= now) {
      scoreFlashUntil.delete(id)
      scoreFlashSides.delete(id)
    }
    const flashing = flashUntil > now
    const lit = flashing ? scoreFlashSides.get(id) ?? { home: false, away: false } : { home: false, away: false }

    const placement = placeMatchLabel({
      panelWidth: panelElement.clientWidth || 1,
      panelHeight: panelElement.clientHeight || 1,
      videoRect: panelVideoRects.has(id) ? panelVideoRects.get(id) ?? null : null,
      home: match.home,
      away: match.away,
      score: match.score,
      crests: Boolean(match.crests.home || match.crests.away),
      clockChars: clockChars(match.clock),
    })
    if (match.clock?.time) clockTicking = true
    const labelElement = existing ?? document.createElement('div')
    if (!existing) {
      labelElement.className = 'panel__label'
      panelElement.appendChild(labelElement)
    }
    const label = `${match.home} x ${match.away}`
    labelElement.dataset.mode = placement.mode
    labelElement.dataset.layout = placement.layout
    labelElement.dataset.label = label
    labelElement.dataset.score = scoreText
    labelElement.classList.toggle('panel__label--flash', flashing)
    const clockText = match.clock ? ` · ${match.clock.title}${match.clock.time ? ` ${match.clock.time}` : ''}` : ''
    labelElement.dataset.clock = match.clock ? `${match.clock.tag} ${match.clock.time}`.trim() : ''
    labelElement.setAttribute('aria-label', `${scoreText ? `${match.home} ${scoreText} ${match.away}` : label}${clockText}`)
    labelElement.style.setProperty('--label-x', `${placement.box.x * 100}%`)
    labelElement.style.setProperty('--label-y', `${placement.box.y * 100}%`)
    labelElement.style.setProperty('--label-w', `${placement.box.width * 100}%`)
    labelElement.style.setProperty('--label-h', `${placement.box.height * 100}%`)
    labelElement.style.setProperty('--label-font', `${placement.fontPx}px`)

    // Rebuild the content only when it changes, so the flash animation is not restarted by every poll.
    // The clock's time isn't part of the key: it ticks in place every second.
    const clockKey = match.clock ? `${match.clock.tag}:${match.clock.paused ? 'p' : 'r'}:${match.clock.time ? 't' : ''}` : ''
    const contentKey = [placement.mode, placement.layout, match.home, match.away, scoreText, flashing ? `${lit.home ? 'h' : ''}${lit.away ? 'a' : ''}` : '', match.crests.home ?? '', match.crests.away ?? '', clockKey].join('|')
    if (labelElement.dataset.contentKey === contentKey) {
      updateClockBox(labelElement, match.clock)
      continue
    }
    labelElement.dataset.contentKey = contentKey
    const shownCrests = labelElement.dataset.crests ?? ''
    const homeCrest = crestImage(match.crests.home, !shownCrests.includes('h'))
    const awayCrest = crestImage(match.crests.away, !shownCrests.includes('a'))
    labelElement.dataset.crests = `${homeCrest ? 'h' : ''}${awayCrest ? 'a' : ''}`
    const dismiss = ensureMatchLabelDismiss(labelElement, id)
    const chip = document.createElement('div')
    chip.className = 'panel__label-chip'
    chip.setAttribute('aria-hidden', 'true')
    if (placement.layout === 'inline') {
      if (homeCrest) chip.append(homeCrest)
      chip.append(
        labelSpan('panel__label-team', match.home),
        match.score ? scoreLabel(match.score, rollFrom, lit) : labelSpan('panel__label-vs', 'x'),
        labelSpan('panel__label-team', match.away),
      )
      if (awayCrest) chip.append(awayCrest)
    } else {
      const rows = [
        [match.home, match.score?.home, rollFrom?.home, homeCrest, lit.home],
        [match.away, match.score?.away, rollFrom?.away, awayCrest, lit.away],
      ] as const
      for (const [team, goals, goalsFrom, crest, goalsLit] of rows) {
        const row = document.createElement('div')
        row.className = 'panel__label-row'
        if (crest) row.append(crest)
        row.append(labelSpan('panel__label-team', team))
        if (goals !== undefined) {
          const cell = document.createElement('span')
          cell.className = 'panel__label-goals'
          cell.append(scoreNumber(goals, goalsFrom, goalsLit))
          row.append(cell)
        }
        chip.append(row)
      }
    }
    if (match.clock) chip.append(clockBox(match.clock))
    chip.append(dismiss)
    labelElement.replaceChildren(chip)
  }
  scheduleLabelRefresh(now)
  // The visible clocks just moved: a highlight may have gone to half-time or come back from it.
  scheduleHalftimeCheck()
}

function createPanel(): Panel {
  return { id: `panel-${panelSerial++}`, url: '', draftUrl: '', muted: allPanelsMuted(), alertsOff: false }
}

function initializePanels(count: number) {
  panels = Array.from({ length: count }, createPanel)
  panelOrder = panels.map((panel) => panel.id)
  buildCurrentLayout()
}

initializePanels(4)

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function panelIndex(id: PanelId) {
  return panels.findIndex((panel) => panel.id === id)
}

function panelById(id: PanelId) {
  return panels.find((panel) => panel.id === id)
}

function captureDrafts() {
  for (const panel of panels) {
    const element = app.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(panel.id)}"]`)
    const input = element?.querySelector<HTMLInputElement>('input[name="url"]')
    if (input) panel.draftUrl = input.value
  }
}

function viewportAspect() {
  const stage = app.querySelector<HTMLElement>('#layout-stage')
  const rect = stage?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) return rect.width / rect.height
  return window.innerWidth > 0 && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9
}

function cloneSnapshot(): LayoutSnapshot {
  return {
    panels: panels.map((panel) => ({ ...panel })),
    highlighted: [...highlighted],
    tree: layoutTree,
    mode: layoutMode,
    position: highlightPosition,
    variant: compositionVariant,
    order: [...panelOrder],
  }
}

function pushHistory() {
  cancelAutoMode()
  forgetHalftimeSwaps()
  captureDrafts()
  history = [...history.slice(-(HISTORY_LIMIT - 1)), cloneSnapshot()]
}

function restoreSnapshot(snapshot: LayoutSnapshot) {
  cancelAutoMode()
  forgetHalftimeSwaps()
  panels = snapshot.panels.map((panel) => ({ ...panel }))
  highlighted = new Set(snapshot.highlighted)
  layoutTree = snapshot.tree
  layoutMode = snapshot.mode
  highlightPosition = snapshot.position
  compositionVariant = snapshot.variant
  panelOrder = [...snapshot.order]
  buildCurrentLayout()
  pendingFocusPanelId = null
  render()
}

function stopAutoTimer() {
  if (autoTimer !== null) window.clearInterval(autoTimer)
  autoTimer = null
}

/** A manual layout change wins: forget the auto state and keep whatever is on screen as the new base. */
function cancelAutoMode() {
  if (autoEntries.length === 0 && !autoBaseline) return
  autoEntries = []
  autoBaseline = null
  stopAutoTimer()
  updateAutoControls()
}

function applyAutoLayout() {
  const baseline = autoBaseline
  if (!baseline) return
  captureDrafts()
  if (autoEntries.length === 0) {
    autoBaseline = null
    stopAutoTimer()
    highlighted = new Set(baseline.highlighted)
    highlightPosition = baseline.position
    compositionVariant = baseline.variant
    buildCurrentLayout(baseline.mode)
  } else {
    highlighted = new Set(composeHighlighted(autoEntries, baseline.highlighted, panels.length, panels.map((panel) => panel.id)))
    highlightPosition = baseline.position
    buildCurrentLayout('highlights')
  }
  renderGrid()
}

function updateAutoControls() {
  const now = Date.now()
  for (const panelElement of app.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
    const entry = autoEntries.find((item) => item.id === panelElement.dataset.panelId)
    let controls = panelElement.querySelector<HTMLElement>('.panel__auto-controls')
    if (!entry) {
      controls?.remove()
      continue
    }
    if (!controls) {
      controls = document.createElement('div')
      controls.className = 'panel__auto-controls'
      controls.innerHTML = '<span class="panel__auto-count" data-auto-count></span><button type="button" class="btn btn--load" data-auto-pin title="Manter este jogo em destaque">📌 Fixar</button><button type="button" class="btn btn--ghost" data-auto-back title="Voltar ao layout anterior agora">↩ Voltar</button>'
    }
    // Inside the green goal badge (next to the score) or the blue VAR badge while one shows; on its own at the top once it fades.
    const badge = panelElement.querySelector<HTMLElement>(':scope > .panel__alert > .panel__alert-badge')
      ?? panelElement.querySelector<HTMLElement>(':scope > .panel__var > .panel__var-badge')
    const host = badge ?? panelElement
    if (controls.parentElement !== host) host.append(controls)
    const count = controls.querySelector<HTMLElement>('[data-auto-count]')
    // A review in progress has no end time yet: no countdown.
    const seconds = entry.reviewing ? '' : `${secondsLeft(entry, now)} s`
    const text = badge ? seconds : `${entry.reason === 'var' ? 'VAR' : 'Gol!'} ${seconds}`.trim()
    if (count && count.textContent !== text) count.textContent = text
  }
}

function updateFinishedControls() {
  const now = Date.now()
  for (const panelElement of app.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
    const entry = finishedPanels.get(panelElement.dataset.panelId ?? '')
    let controls = panelElement.querySelector<HTMLElement>(':scope > .panel__finished')
    // Hidden until the score delay passes, so the notice doesn't spoil the end before the video shows it.
    if (!entry || now < entry.showAt) {
      controls?.remove()
      continue
    }
    if (!controls) {
      controls = document.createElement('div')
      controls.className = 'panel__finished'
      controls.innerHTML = '<span class="panel__finished-count" role="status" data-finished-count></span><button type="button" class="btn btn--ghost" data-finished-keep title="Não fechar este painel">Manter aberto</button>'
      panelElement.append(controls)
    }
    const count = controls.querySelector<HTMLElement>('[data-finished-count]')
    const text = `Fim de jogo · fecha em ${Math.max(0, Math.ceil((entry.closeAt - now) / 1000))} s`
    if (count && count.textContent !== text) count.textContent = text
  }
}

function tickFinished() {
  const now = Date.now()
  const busy = view !== 'grid' || editorOpen || dragState !== null || document.querySelector('.confirm') !== null
  for (const [id, entry] of finishedPanels) {
    if (now < entry.closeAt) continue
    if (!panelById(id) || panels.length <= MIN_PANELS) {
      finishedPanels.delete(id)
    } else if (busy) {
      entry.closeAt = now + FINISHED_RETRY_MS
    } else {
      finishedPanels.delete(id)
      removePanel(id)
    }
  }
  if (finishedPanels.size === 0 && finishedTimer !== null) {
    window.clearInterval(finishedTimer)
    finishedTimer = null
  }
  updateFinishedControls()
}

function onMatchEnded(id: PanelId) {
  const { closeFinishedSec, scoreDelaySec } = getAlertSettings()
  if (closeFinishedSec === null || !panelById(id)?.url || finishedPanels.has(id) || keptFinishedPanels.has(id)) return
  // 365Scores-linked panels wait their own delay (the video trails the data), William Hill ones the score delay.
  const showAt = Date.now() + (isLiveLinked(id) ? panelAlertDelayMs(id) : (scoreDelaySec ?? 0) * 1000)
  finishedPanels.set(id, { showAt, closeAt: showAt + closeFinishedSec * 1000 })
  finishedTimer ??= window.setInterval(tickFinished, 1000)
  tickFinished()
}

function keepFinishedPanel(id: PanelId) {
  finishedPanels.delete(id)
  keptFinishedPanels.add(id)
  updateFinishedControls()
}

function tickAuto() {
  const { autos, changed } = expireAutos(autoEntries, Date.now())
  autoEntries = autos
  if (changed) applyAutoLayout()
  else updateAutoControls()
}

/** `reason: 'var'`: a VAR review, highlighted until it ends (capped by `VAR_MAX_MS`). */
function startAutoGoal(panelId: PanelId, reason?: 'var') {
  const alertSettings = getAlertSettings()
  if (view !== 'grid' || panels.length < AUTO_MIN_PANELS || !alertSettings.autoHighlight) return
  if (!autoBaseline) {
    autoBaseline = { highlighted: [...highlighted], mode: layoutMode, position: highlightPosition, variant: compositionVariant }
  }
  const result = registerGoal(autoEntries, panelId, Date.now(), panels.length, autoBaseline.highlighted, panels.map((panel) => panel.id), reason ? VAR_MAX_MS : alertSettings.autoHighlightSec * 1000, reason)
  autoEntries = result.autos
  if (!result.highlighted) {
    if (autoEntries.length === 0) autoBaseline = null
    return
  }
  applyAutoLayout()
  if (autoTimer === null) autoTimer = window.setInterval(tickAuto, 1000)
}

function pinAutoPanel(panelId: PanelId) {
  if (!autoBaseline || !autoEntries.some((entry) => entry.id === panelId)) return
  autoEntries = autoEntries.filter((entry) => entry.id !== panelId)
  autoBaseline = { ...autoBaseline, highlighted: [panelId, ...autoBaseline.highlighted.filter((id) => id !== panelId)] }
  applyAutoLayout()
}

function releaseAutoPanel(panelId: PanelId) {
  if (!autoEntries.some((entry) => entry.id === panelId)) return
  autoEntries = autoEntries.filter((entry) => entry.id !== panelId)
  applyAutoLayout()
}

/** Visible clock of a panel (with the score's delay, or the alerts' one while the score is hidden). */
function panelVisibleClock(id: PanelId, now: number) {
  const timeline = panelClocks.get(id)
  if (!timeline) return null
  const delay = panelScoreDelayMs(id) ?? panelAlertDelayMs(id)
  const clock = visibleClock(timeline, now, delay)
  return clock ? { period: clock.period, elapsed: clockElapsedAt(clock, now - delay) } : null
}

function swapPanelInfo(panel: Panel, now: number): SwapPanelInfo {
  const clock = panel.url ? panelVisibleClock(panel.id, now) : null
  const delay = panelScoreDelayMs(panel.id) ?? panelAlertDelayMs(panel.id)
  const feed = panelFeeds.get(panel.id)
  const name = extractMatchLabel(panelTitles.get(panel.id) ?? '') ?? (feed?.home && feed.away ? `${feed.home} x ${feed.away}` : '')
  const mainTeam = Boolean(autoOpenPanels.get(panel.id)?.mainTeam || (name && mainTeamOf(name, autoOpenSettings.teams)))
  return {
    id: panel.id,
    period: clock?.period ?? null,
    elapsed: clock?.elapsed ?? null,
    score: feed ? visibleScore(feed.timeline, now, delay) : null,
    mainTeam,
    alertsOff: panel.alertsOff,
  }
}

/** The user's own highlights: kept aside while a goal is highlighted. */
function userHighlights(): PanelId[] {
  return autoBaseline ? [...autoBaseline.highlighted] : [...highlighted]
}

/** Exchanges the places of two panels, like dragging one onto the other; doing it again undoes it. */
function exchangeHighlights(a: PanelId, b: PanelId) {
  if (!panelById(a) || !panelById(b)) return
  const result = swapPanels(panelOrder, userHighlights(), a, b)
  panelOrder = result.order
  if (autoBaseline) autoBaseline = { ...autoBaseline, highlighted: result.highlighted }
  else highlighted = new Set(result.highlighted)
}

function relayoutHalftime() {
  if (autoBaseline) {
    applyAutoLayout()
    return
  }
  captureDrafts()
  buildCurrentLayout(layoutMode)
  renderGrid()
}

function scheduleHalftimeCheck(delayMs = 0) {
  if (halftimeCheckTimer !== null) {
    if (delayMs > 0) return
    window.clearTimeout(halftimeCheckTimer)
  }
  halftimeCheckTimer = window.setTimeout(() => {
    halftimeCheckTimer = null
    checkHalftimeSwaps()
  }, delayMs)
}

/** A manual layout change wins: the swaps on screen stay as they are, and the games in a break are left alone until it ends. */
function forgetHalftimeSwaps() {
  const now = Date.now()
  for (const panel of panels) {
    if (isBreakPeriod(panelVisibleClock(panel.id, now)?.period ?? null)) halftimeSkipped.add(panel.id)
  }
  if (halftimeSwaps.length === 0) return
  halftimeSwaps = []
  updateHalftimeControls()
}

/** Swaps a highlight going to half-time with the best game being played, and back once its break is over. */
function checkHalftimeSwaps() {
  const now = Date.now()
  const infos = panels.map((panel) => swapPanelInfo(panel, now))
  for (const id of halftimeSkipped) {
    const info = infos.find((item) => item.id === id)
    if (!info || !isBreakPeriod(info.period)) halftimeSkipped.delete(id)
  }
  if (view !== 'grid') {
    halftimeSwaps = []
    return
  }
  if (editorOpen || dragState !== null || document.querySelector('.confirm')) {
    scheduleHalftimeCheck(HALFTIME_RETRY_MS)
    return
  }
  const enabled = panels.length >= AUTO_MIN_PANELS && getAlertSettings().halftimeSwap
  // Turned off (or too few panels): every swap goes back now.
  const plan = enabled
    ? planHalftimeSwaps({ swaps: halftimeSwaps, userHighlighted: userHighlights(), highlighted: [...highlighted], panels: infos, order: panelOrder, skipped: halftimeSkipped })
    : { restore: [...halftimeSwaps], start: [] }
  if (plan.restore.length === 0 && plan.start.length === 0) {
    updateHalftimeControls()
    return
  }
  for (const swap of plan.restore) exchangeHighlights(swap.out, swap.in)
  for (const swap of plan.start) exchangeHighlights(swap.out, swap.in)
  halftimeSwaps = [...halftimeSwaps.filter((swap) => !plan.restore.includes(swap)), ...plan.start]
  relayoutHalftime()
}

/** "Voltar": the game in its break goes back to the highlight and stays there until the break ends. */
function releaseHalftimeSwap(inId: PanelId) {
  const swap = halftimeSwaps.find((item) => item.in === inId)
  if (!swap) return
  halftimeSwaps = halftimeSwaps.filter((item) => item !== swap)
  halftimeSkipped.add(swap.out)
  exchangeHighlights(swap.out, swap.in)
  relayoutHalftime()
}

/** "Fixar": the game that came in keeps the highlight; the other one doesn't come back. */
function pinHalftimeSwap(inId: PanelId) {
  const swap = halftimeSwaps.find((item) => item.in === inId)
  if (!swap) return
  halftimeSwaps = halftimeSwaps.filter((item) => item !== swap)
  halftimeSkipped.add(swap.out)
  updateHalftimeControls()
}

function updateHalftimeControls() {
  const now = Date.now()
  for (const panelElement of app.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
    const swap = halftimeSwaps.find((item) => item.in === panelElement.dataset.panelId)
    let badge = panelElement.querySelector<HTMLElement>(':scope > .panel__halftime')
    if (!swap) {
      badge?.remove()
      continue
    }
    if (!badge) {
      badge = document.createElement('div')
      badge.className = 'panel__halftime'
      badge.innerHTML = '<span class="panel__halftime-text" data-halftime-text></span><button type="button" class="btn btn--load" data-halftime-pin title="Manter este jogo em destaque">📌 Fixar</button><button type="button" class="btn btn--ghost" data-halftime-back title="Voltar o jogo do intervalo para o destaque agora">↩ Voltar</button>'
      panelElement.append(badge)
    }
    const match = panelMatch(swap.out, now)
    const name = match ? `${match.home} x ${match.away}` : extractMatchLabel(panelTitles.get(swap.out) ?? '') ?? 'outro jogo'
    const text = `Intervalo em ${name}`
    const textElement = badge.querySelector<HTMLElement>('[data-halftime-text]')
    if (textElement && textElement.textContent !== text) textElement.textContent = text
    badge.title = `${text}: volta ao destaque quando o jogo recomeçar`
  }
}

function liveDelayLabel(seconds: number) {
  return seconds === 0 ? 'na hora' : `${seconds} s`
}

/** The "⏱ 30 s" button of a 365Scores-linked panel, kept with the panel's other top-left buttons so it never covers the player's own controls. */
function updateLiveDelayButton(panelElement: HTMLElement, id: PanelId, live: LiveMatchStatus | undefined, globalSec: number | null) {
  const controls = panelElement.querySelector<HTMLElement>(':scope > .panel__controls')
  let button = controls?.querySelector<HTMLElement>(':scope > .panel__delay') ?? null
  if (!controls || live?.status !== 'linked') {
    button?.remove()
    return
  }
  const own = panelDelayOverride.get(id)
  const key = `${live.label}|${live.coverage}|${live.sport}|${own ?? 'default'}|${globalSec}`
  if (button?.dataset.key === key) return
  if (!button) {
    button = document.createElement('label')
    button.className = 'btn btn--ghost panel__delay'
    controls.insertBefore(button, controls.querySelector(':scope > .panel__alerts') ?? controls.querySelector(':scope > .panel__remove'))
  }
  button.dataset.key = key
  const effective = own ?? globalSec ?? 0
  const defaultLabel = globalSec === null ? 'Padrão (placar oculto, alertas na hora)' : `Padrão (${liveDelayLabel(globalSec)})`
  const coverage = live.sport === 'basketball' ? ' · basquete, só placar' : live.sport === 'american-football' ? ' · futebol americano, touchdowns e field goals' : live.coverage === 'score' ? ' · só placar' : ''
  button.title = `Atraso do placar e dos alertas deste painel — 365Scores: ${live.label ?? ''}${coverage}`
  button.classList.toggle('is-custom', own !== undefined)
  button.innerHTML = `<svg class="panel__delay-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="5.5" /><path d="M8 6.2V9l1.8 1.3M6.3 1.8h3.4" /></svg><span class="panel__delay-value" aria-hidden="true">${effective} s</span><select data-live-delay aria-label="Atraso do placar e dos alertas deste painel">
      <option value="default"${own === undefined ? ' selected' : ''}>${escapeHtml(defaultLabel)}</option>
      ${LIVE_DELAY_OPTIONS.map((value) => `<option value="${value}"${own === value ? ' selected' : ''}>${liveDelayLabel(value)}</option>`).join('')}
    </select>`
}

/** Prompt to pick the game of an ambiguous title (YouTube, or BLL without a William Hill feed), and the delay button of a linked one. Idempotent, like the auto controls. */
function updateLiveControls() {
  const globalSec = getAlertSettings().scoreDelaySec
  for (const panelElement of app.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
    const id = panelElement.dataset.panelId ?? ''
    const live = panelById(id)?.url ? panelLive.get(id) : undefined
    updateLiveDelayButton(panelElement, id, live, globalSec)
    updateInfoButton(panelElement, matchInfoReady.has(id) && Boolean(panelById(id)?.url), infoDrawer.openPanelId() === id)
    let prompt = panelElement.querySelector<HTMLElement>(':scope > .panel__live')
    if (live?.status !== 'ambiguous') {
      prompt?.remove()
      continue
    }
    const key = (live.candidates ?? []).map((candidate) => candidate.id).join(',')
    if (prompt?.dataset.key === key) continue
    if (!prompt) {
      prompt = document.createElement('div')
      prompt.className = 'panel__live'
      panelElement.append(prompt)
    }
    prompt.dataset.key = key
    prompt.innerHTML = `<span class="panel__live-title">Qual jogo é este? (365Scores)</span>${(live.candidates ?? []).map((candidate) =>
      `<button type="button" class="btn btn--load" data-live-choose="${candidate.id}" title="${escapeHtml(candidate.detail)}">${escapeHtml(candidate.label)}</button>`).join('')}<button type="button" class="btn btn--ghost" data-live-choose="none">Nenhum</button>`
  }
}

/** Shows or ends a VAR review now; its end leaves the highlight a few more seconds for the decision. */
function deliverLiveVar(payload: LiveVarPayload) {
  if (payload.review && (view !== 'grid' || panelById(payload.panelId)?.alertsOff)) return
  if (setVarReview(payload.panelId, payload.review, app, (panelId) => Boolean(panelById(panelId)))) return
  if (payload.review) return
  autoEntries = endVarAuto(autoEntries, payload.panelId, Date.now())
  updateAutoControls()
}

/** Shows an alert now; a goal the VAR cancelled also undoes that panel's goal highlight. */
function deliverMatchEvent(payload: MatchEventPayload) {
  if (view !== 'grid' || panelById(payload.panelId)?.alertsOff) return
  if (payload.kind === 'var' && payload.note === 'gol anulado') releaseAutoPanel(payload.panelId)
  // With the goal highlight on, the alert (and the scorer's name in it) lasts as long as the highlight, so they leave together.
  const alertSettings = getAlertSettings()
  const highlightMs = panels.length >= AUTO_MIN_PANELS && alertSettings.autoHighlight ? alertSettings.autoHighlightSec * 1000 : undefined
  handleMatchEvent(payload, app, (panelId) => Boolean(panelById(panelId)), highlightMs)
}

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const panelId = target.closest<HTMLElement>('.panel')?.dataset.panelId
  if (!panelId) return
  if (target.closest('[data-auto-pin]')) pinAutoPanel(panelId)
  else if (target.closest('[data-auto-back]')) releaseAutoPanel(panelId)
  if (target.closest('[data-halftime-pin]')) pinHalftimeSwap(panelId)
  else if (target.closest('[data-halftime-back]')) releaseHalftimeSwap(panelId)
  if (target.closest('[data-finished-keep]')) keepFinishedPanel(panelId)
  if (target.closest('[data-info]')) infoDrawer.toggle(panelId)
  const choice = target.closest<HTMLElement>('[data-live-choose]')?.dataset.liveChoose
  if (choice) window.quadra?.chooseLiveMatch(panelId, choice === 'none' ? null : Number(choice))
})
app.addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-live-delay]')
  const panelId = select?.closest<HTMLElement>('.panel')?.dataset.panelId
  if (!select || !panelId) return
  if (select.value === 'default') panelDelayOverride.delete(panelId)
  else panelDelayOverride.set(panelId, Number(select.value))
  updateLiveControls()
  updatePanelLabels()
})

function undo() {
  const previous = history.at(-1)
  if (!previous) return
  history = history.slice(0, -1)
  restoreSnapshot(previous)
}

function resetOrganizerDraft(notice = ''): void {
  if (!editorOpen) return

  const draft: OrganizerDraft = {
    count: highlighted.size,
    ids: [...highlighted],
    position: highlighted.size === 0 ? undefined : resolvedHighlightPosition,
    previousVariant: compositionVariant,
  }
  organizerDraft = draft
  organizerBaselineKey = organizerDraftKey(draft, panels.length)
  organizerNotice = notice
  organizerChoices = []
  organizerAspect = 0
}

function buildCurrentLayout(
  mode: LayoutMode = layoutMode,
  preserveOrganizerDraft = false,
) {
  layoutMode = mode
  panelOrder = [...panelOrder.filter((id) => panelById(id)), ...panels.map((panel) => panel.id).filter((id) => !panelOrder.includes(id))]
  const result = resolveComposition(panelOrder, { mode, highlighted, position: highlightPosition, aspect: viewportAspect(), previousVariant: compositionVariant })
  layoutTree = result.tree
  highlighted = new Set(result.highlighted)
  compositionVariant = result.variant
  resolvedHighlightPosition = result.highlighted.length > 0 ? result.position : undefined
  if (highlightPosition && !result.composition.positions.includes(highlightPosition)) highlightPosition = result.position
  if (editorOpen && !preserveOrganizerDraft) {
    resetOrganizerDraft('A organização mudou. A prévia foi atualizada.')
  }
}

function setPanelCount(count: number, options: { recordHistory?: boolean } = {}) {
  const nextCount = Math.max(MIN_PANELS, Math.min(MAX_PANELS, Math.round(count)))
  if (nextCount === panels.length) return
  if (options.recordHistory !== false) pushHistory()

  if (nextCount > panels.length) {
    panels = [...panels, ...Array.from({ length: nextCount - panels.length }, createPanel)]
  } else {
    const removed = new Set(panels.slice(nextCount).map((panel) => panel.id))
    for (const id of removed) {
      clearPanelMatchState(id)
      dismissAutoOpen(id)
    }
    panels = panels.slice(0, nextCount)
    highlighted = new Set([...highlighted].filter((id) => !removed.has(id)))
  }

  buildCurrentLayout()
  if (view === 'grid') renderGrid()
}

function selectCount(count: number) {
  highlighted.clear()
  layoutMode = 'auto'
  highlightPosition = undefined
  compositionVariant = undefined
  setPanelCount(count, { recordHistory: false })
  buildCurrentLayout()
  view = 'grid'
  editorOpen = false
  pendingFocusPanelId = null
  render()
}

function startWithOnePanel() {
  highlighted.clear()
  layoutMode = 'auto'
  highlightPosition = undefined
  compositionVariant = undefined
  setPanelCount(1, { recordHistory: false })
  buildCurrentLayout()
  view = 'grid'
  editorOpen = false
  pendingFocusPanelId = panels[0]?.id ?? null
  render()
}

function addPanel() {
  if (panels.length >= MAX_PANELS || view !== 'grid') return
  pushHistory()
  const panel = createPanel()
  panels = [...panels, panel]
  pendingFocusPanelId = panel.id
  buildCurrentLayout()
  renderGrid()
}

function removeLastPanel() {
  removePanel(panels.at(-1)?.id ?? '')
}

function removePanel(id: PanelId) {
  if (panels.length <= MIN_PANELS || !panelById(id) || view !== 'grid') return
  pushHistory()
  dismissAutoOpen(id)
  clearPanelMatchState(id)
  panels = panels.filter((panel) => panel.id !== id)
  panelOrder = panelOrder.filter((panelId) => panelId !== id)
  highlighted.clear()
  layoutMode = 'auto'
  highlightPosition = undefined
  compositionVariant = undefined
  pendingFocusPanelId = null
  buildCurrentLayout('auto')
  renderGrid()
}

function setEditor(open: boolean) {
  if (open) infoDrawer.close()
  captureDrafts()
  editorOpen = open

  if (open) {
    resetOrganizerDraft()
  } else {
    organizerDraft = null
    organizerChoices = []
    organizerBaselineKey = ''
    organizerAspect = 0
    organizerNotice = ''
  }

  renderGrid()
  app.querySelector<HTMLButtonElement>(open ? '[data-composition]' : '#btn-organize')?.focus()
}

function toggleHighlight(id: PanelId) {
  if (!panelById(id)) return
  pushHistory()
  if (highlighted.has(id)) highlighted.delete(id)
  else highlighted.add(id)
  buildCurrentLayout(highlighted.size > 0 ? 'highlights' : 'equal')
  renderGrid()
  app.querySelector<HTMLButtonElement>(`[data-panel-id="${CSS.escape(id)}"] [data-highlight]`)?.focus()
}

function chooseHighlight(id: PanelId) {
  const capacity = getCompositions(panels.length).at(-1)!.highlightCount
  if (!panelById(id) || capacity === 0) return
  if (highlighted.has(id)) {
    if (highlighted.size <= 1) {
      makeEqual()
      return
    }
    toggleHighlight(id)
    return
  }
  if (highlighted.size >= capacity) replaceHighlight(id)
  else toggleHighlight(id)
}

function replaceHighlight(id: PanelId) {
  if (!panelById(id) || panels.length < 3) return
  pushHistory()
  const others = [...highlighted].filter((panelId) => panelId !== id).slice(1)
  highlighted = new Set([id, ...others])
  buildCurrentLayout('highlights')
  renderGrid()
  app.querySelector<HTMLButtonElement>(`[data-panel-id="${CSS.escape(id)}"] [data-highlight]`)?.focus()
}

function chooseOrganizerComposition(count: number): void {
  if (!organizerDraft) return
  const composition = getCompositions(panels.length)
    .find((entry) => entry.highlightCount === count)
  if (!composition || count === organizerDraft.count) return

  const ids = [
    ...organizerDraft.ids.filter((id) => panelOrder.includes(id)),
    ...panelOrder.filter((id) => !organizerDraft!.ids.includes(id)),
  ].slice(0, count)
  const position = count === 0
    ? undefined
    : composition.positions.includes(organizerDraft.position!)
      ? organizerDraft.position
      : composition.positions[0]

  organizerDraft = { count, ids, position, previousVariant: undefined }
  organizerNotice = ''
  updateOrganizerPanel(`[data-composition="${count}"]`)
}

function toggleOrganizerPanel(id: PanelId): void {
  if (!organizerDraft || !panelOrder.includes(id) || organizerDraft.count === 0) return

  if (organizerDraft.count === 1) {
    if (organizerDraft.ids[0] === id) return
    organizerDraft = { ...organizerDraft, ids: [id], previousVariant: undefined }
  } else if (organizerDraft.ids.includes(id)) {
    organizerDraft = {
      ...organizerDraft,
      ids: organizerDraft.ids.filter((panelId) => panelId !== id),
      previousVariant: undefined,
    }
  } else if (organizerDraft.ids.length < organizerDraft.count) {
    organizerDraft = {
      ...organizerDraft,
      ids: [...organizerDraft.ids, id],
      previousVariant: undefined,
    }
  } else {
    organizerNotice = 'Desmarque uma tela antes de escolher outra.'
    updateOrganizerPanel(`[data-map-panel="${CSS.escape(id)}"]`)
    return
  }

  organizerDraft = {
    ...organizerDraft,
    ids: panelOrder.filter((panelId) => organizerDraft!.ids.includes(panelId)),
  }
  organizerNotice = ''
  updateOrganizerPanel(`[data-map-panel="${CSS.escape(id)}"]`)
}

function chooseOrganizerPosition(key: string): void {
  if (!organizerDraft) return
  const choice = organizerChoices.find((entry) => entry.key === key)
  if (!choice) return
  const current = organizerDraft.position ?? 'none'
  if (choice.positions.includes(current)) return

  organizerDraft = {
    ...organizerDraft,
    position: organizerDraft.count === 0 ? undefined : choice.result.position,
    previousVariant: choice.result.variant,
  }
  organizerNotice = ''
  updateOrganizerPanel(`[data-organizer-position="${CSS.escape(key)}"]`)
}

function applyOrganizerDraft(): void {
  if (!organizerDraft) return

  if (!organizerDraftValid(panelOrder, organizerDraft)) {
    organizerNotice = 'Selecione a quantidade indicada de telas principais.'
    updateOrganizerPanel('[data-organize-apply]')
    return
  }

  if (Math.abs(viewportAspect() - organizerAspect) > 1e-8) {
    organizerNotice = 'O tamanho da janela mudou. Confira a prévia e clique em Aplicar.'
    updateOrganizerPanel('[data-organize-apply]')
    return
  }

  const selectedPosition = organizerDraft.position ?? 'none'
  const choice = organizerChoices.find((entry) =>
    entry.positions.includes(selectedPosition),
  )
  if (!choice) {
    organizerNotice = 'A prévia está indisponível. Feche e abra Organizar.'
    updateOrganizerPanel('[data-organize-apply]')
    return
  }

  if (organizerDraftKey(organizerDraft, panels.length) === organizerBaselineKey) {
    setEditor(false)
    return
  }

  pushHistory()
  layoutMode = organizerDraft.count === 0 ? 'equal' : 'highlights'
  highlighted = new Set(choice.result.highlighted)
  layoutTree = choice.result.tree
  highlightPosition = organizerDraft.count === 0 ? undefined : choice.result.position
  resolvedHighlightPosition = highlightPosition
  compositionVariant = choice.result.variant
  setEditor(false)
}

function makeEqual() {
  pushHistory()
  highlighted.clear()
  buildCurrentLayout('equal')
  renderGrid()
}

function organizeAutomatically() {
  pushHistory()
  highlighted.clear()
  compositionVariant = undefined
  buildCurrentLayout('auto')
  renderGrid()
}

function applyPanelUrl(id: PanelId, next: string) {
  const panel = panelById(id)
  if (!panel) return
  if (panel.url !== next) {
    clearPanelMatchState(id)
    dismissAutoOpen(id)
  }
  panel.url = next
  panel.draftUrl = next
  if (next) {
    dismissedMatchLabels.delete(id)
    forceReloadIds.add(id)
  } else {
    forceReloadIds.delete(id)
    clearPanelMatchState(id)
  }
  renderGrid()
}

function panelLabel(id: PanelId) {
  return `Jogo ${panelIndex(id) + 1}`
}

function openWeddbets(id: PanelId) {
  if (!panelById(id)) return
  // Ensure main knows the panel exists before the catalog IPC (same-turn send order).
  syncLayout()
  window.quadra?.openWeddbets(id, panelLabel(id))
}

function openBllsport(id: PanelId) {
  if (!panelById(id)) return
  bllsportTargetId = id
  syncLayout()
  window.quadra?.openBllsport(id, panelLabel(id))
}

const ZAPPING_URL = 'https://app.zapping.com.br/webplayer'

function openZapping(id: PanelId) {
  if (!panelById(id)) return
  applyPanelUrl(id, ZAPPING_URL)
}

function useSportsCatalogPlayer(
  panelId: PanelId,
  url: string,
  setTargetId: (id: PanelId | null) => void,
  syncTarget: (id: PanelId | null, label?: string) => void,
) {
  const panel = panelById(panelId)
  if (!panel || view !== 'grid') return
  if (panel.url !== url) clearPanelMatchState(panelId)
  panel.url = url
  panel.draftUrl = url
  const next = panels.find((candidate) => candidate.id !== panelId && !candidate.url)
  setTargetId(next?.id ?? null)
  renderGrid()
  if (next) syncTarget(next.id, panelLabel(next.id))
  else syncTarget(null)
}

function useWeddbetsPlayer(panelId: PanelId, url: string) {
  useSportsCatalogPlayer(
    panelId,
    url,
    () => {},
    (id, label) => window.quadra?.setWeddbetsTarget(id, label),
  )
}

function useBllsportPlayer(panelId: PanelId, url: string) {
  useSportsCatalogPlayer(
    panelId,
    url,
    (id) => { bllsportTargetId = id },
    (id, label) => window.quadra?.setBllsportTarget(id, label),
  )
}

type BatchSource = 'bll' | 'youtube'
type BatchEvent = BllEvent & { channel?: string }
type BatchLoad = { status: 'ok'; events: BatchEvent[] } | { status: 'error'; message: string }

function applyBatch(urls: string[], source: BatchSource, firstPanelId: PanelId | null = null) {
  if (view !== 'grid') return
  // Opened from a panel's own button: that panel gets the first game.
  const first = firstPanelId ? panelById(firstPanelId) : undefined
  const slots = first ? [first, ...panels.filter((panel) => panel !== first)] : panels
  const plan = planBatchOpen(slots, urls, MAX_PANELS)
  if (plan.fill.length === 0 && plan.extra.length === 0) return
  pushHistory()
  for (const { panelId, url } of plan.fill) {
    const panel = panelById(panelId)
    if (!panel) continue
    clearPanelMatchState(panelId)
    panel.url = url
    panel.draftUrl = url
  }
  panels = [...panels, ...plan.extra.map((url) => ({ ...createPanel(), url, draftUrl: url }))]
  buildCurrentLayout()
  renderGrid()
  syncLayout()
  if (source !== 'bll') return
  const next = panels.find((panel) => !panel.url)
  bllsportTargetId = next?.id ?? null
  if (next) window.quadra?.setBllsportTarget(next.id, panelLabel(next.id))
  else window.quadra?.setBllsportTarget(null)
}

/** From the start screen: one panel per chosen game, replacing whatever the grid held before. */
function startWithGames(urls: string[]) {
  const games = [...new Set(urls)].slice(0, MAX_PANELS)
  if (games.length === 0) return
  for (const panel of panels) clearPanelMatchState(panel.id)
  panels = games.map((url) => ({ ...createPanel(), url, draftUrl: url }))
  highlighted.clear()
  layoutMode = 'auto'
  highlightPosition = undefined
  compositionVariant = undefined
  buildCurrentLayout()
  view = 'grid'
  editorOpen = false
  pendingFocusPanelId = null
  render()
}

function batchListHtml(groups: BllEventGroup<BatchEvent>[], fromChooser: boolean, checked: ReadonlySet<string> = new Set(), byTime = false) {
  const open = new Set(fromChooser ? [] : panels.map((panel) => panel.url).filter(Boolean))
  return groups.map((group, groupIndex) => `<fieldset class="bll-batch__group">
    <legend><label><input type="checkbox" data-group="${groupIndex}"> ${escapeHtml(group.competition)} <span class="bll-batch__count">(${group.events.length})</span></label></legend>
    ${group.events.map((event) => {
      const isOpen = open.has(event.url)
      return `<label class="bll-batch__item${isOpen ? ' is-open' : ''}"><input type="checkbox" data-url="${escapeHtml(event.url)}" data-group-item="${groupIndex}"${isOpen ? ' checked disabled' : checked.has(event.url) ? ' checked' : ''}>
        ${event.time ? `<span class="bll-batch__time">${escapeHtml(event.time)}</span> ` : ''}${event.basketball ? '<span class="bll-batch__sport" title="Basquete" aria-label="Basquete">🏀</span> ' : ''}${event.americanFootball ? '<span class="bll-batch__sport" title="Futebol americano" aria-label="Futebol americano">🏈</span> ' : ''}<span>${escapeHtml(event.name)}</span>${byTime ? ` <small class="bll-batch__channel">${escapeHtml(event.competition)}</small>` : ''}${!byTime && event.competition !== group.competition && stageOf(event.competition) ? ` <small class="bll-batch__channel">${escapeHtml(stageOf(event.competition))}</small>` : ''}${event.channel && event.channel !== group.competition ? ` <small class="bll-batch__channel">${escapeHtml(event.channel)}</small>` : ''}${isOpen ? ' <small>já aberto</small>' : ''}</label>`
    }).join('')}
  </fieldset>`).join('')
}

const YOUTUBE_ERRORS: Record<Exclude<YoutubeLivesResult['status'], 'ok'>, string> = {
  'no-key': 'Esta versão do Quadra veio sem chave da YouTube Data API. Coloque QUADRA_YOUTUBE_API_KEY=... no arquivo .env e clique em Atualizar lista.',
  'invalid-key': 'A chave da YouTube Data API foi recusada. Se você usa chave própria, confira QUADRA_YOUTUBE_API_KEY no .env; senão, atualize o Quadra.',
  'api-disabled': 'A YouTube Data API v3 não está ativada no projeto do Google Cloud desta chave.',
  quota: 'A cota diária da YouTube Data API acabou. Ela volta à meia-noite do horário do Pacífico.',
  unavailable: 'Não foi possível buscar as lives do YouTube. Confira a internet e clique em Atualizar lista.',
}

const YOUTUBE_CHANNEL_ERRORS: Record<Exclude<YoutubeChannelResult['status'], 'ok'>, string> = {
  ...YOUTUBE_ERRORS,
  'not-found': 'Canal não encontrado. Use o @ do canal (ex.: @CazeTV) ou um link youtube.com/@… ou youtube.com/channel/….',
}

const BATCH_SOURCES: Record<BatchSource, { title: string; loading: string; empty: string; hint: string; load: () => Promise<BatchLoad> }> = {
  bll: {
    title: 'Abrir jogos da BLL',
    loading: 'Lendo os jogos da BLL…',
    empty: 'Nenhum jogo ao vivo na BLL agora. Jogos previstos só podem ser abertos quando começarem.',
    hint: 'Marque a competição inteira ou só os jogos que quiser.',
    load: async () => {
      const result = await window.quadra?.listBllsportEvents()
      if (!result) return { status: 'error', message: 'A BLL só está disponível no app do Quadra.' }
      if (result.status === 'unavailable') return { status: 'error', message: 'Não foi possível ler os jogos da BLL. Clique em Atualizar lista; se continuar, abra a BLL em um painel e confira o login.' }
      return { status: 'ok', events: result.events.filter((event) => event.live) }
    },
  },
  youtube: {
    title: 'Abrir jogos ao vivo do YouTube',
    loading: 'Procurando lives nos canais da lista…',
    empty: 'Nenhum jogo ao vivo nos canais da lista agora. Clique em Canais… para adicionar outros canais.',
    hint: 'Marque o grupo inteiro ou só as lives que quiser.',
    load: async () => {
      const channels = loadYoutubeChannels()
      if (channels.length === 0) return { status: 'error', message: 'A lista de canais está vazia. Clique em Canais… para adicionar.' }
      const result = await window.quadra?.listYoutubeLives(channels.map((channel) => channel.id))
      if (!result) return { status: 'error', message: 'A busca do YouTube só está disponível no app do Quadra.' }
      if (result.status !== 'ok') return { status: 'error', message: YOUTUBE_ERRORS[result.status] }
      return { status: 'ok', events: result.events }
    },
  },
}

function openBatch(source: BatchSource, firstPanelId: PanelId | null = null) {
  const config = BATCH_SOURCES[source]
  const fromChooser = view === 'choose'
  document.querySelector('.confirm:not(.ui-dialog)')?.remove()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm bll-batch'
  backdrop.innerHTML = `<div class="confirm__dialog bll-batch__dialog" role="dialog" aria-modal="true" aria-labelledby="bll-batch-title">
    <p id="bll-batch-title" class="confirm__message">${config.title}</p>
    ${source === 'bll' ? `<div class="bll-batch__order" role="group" aria-label="Ordem da lista">
      <span>Ordem:</span>
      <button type="button" data-order="league">Por liga</button>
      <button type="button" data-order="time">Por horário</button>
    </div>` : ''}
    <p class="bll-batch__status" role="status" aria-live="polite"></p>
    <div class="bll-batch__list"></div>
    ${source === 'youtube' ? `<div class="yt-channels" hidden>
      <p class="bll-batch__status yt-channels__hint"></p>
      <ul class="yt-channels__list"></ul>
      <form class="yt-channels__add">
        <input type="text" name="channel" placeholder="@canal ou link do canal" aria-label="Canal do YouTube" autocomplete="off" spellcheck="false">
        <button type="submit" class="btn btn--load">Adicionar</button>
      </form>
      <p class="yt-channels__message" role="status" aria-live="polite"></p>
      <button type="button" class="btn btn--ghost yt-channels__restore" data-restore>Restaurar lista padrão</button>
    </div>` : ''}
    <div class="confirm__actions">
      ${source === 'youtube' ? '<button type="button" class="btn btn--ghost" data-channels>Canais…</button>' : ''}
      <button type="button" class="btn btn--ghost" data-refresh>Atualizar lista</button>
      <button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>
      <button type="button" class="btn btn--load" data-ok disabled>Abrir</button>
    </div>
  </div>`
  const status = backdrop.querySelector<HTMLElement>('.bll-batch__status')!
  const list = backdrop.querySelector<HTMLElement>('.bll-batch__list')!
  const ok = backdrop.querySelector<HTMLButtonElement>('[data-ok]')!
  const refresh = backdrop.querySelector<HTMLButtonElement>('[data-refresh]')!
  const selectedUrls = () => [...list.querySelectorAll<HTMLInputElement>('input[data-url]:checked:not(:disabled)')].map((input) => input.dataset.url!)
  const updateSelection = () => {
    for (const groupBox of list.querySelectorAll<HTMLInputElement>('input[data-group]')) {
      const items = [...list.querySelectorAll<HTMLInputElement>(`input[data-group-item="${groupBox.dataset.group}"]:not(:disabled)`)]
      const checked = items.filter((item) => item.checked).length
      groupBox.disabled = items.length === 0
      groupBox.checked = items.length > 0 && checked === items.length
      groupBox.indeterminate = checked > 0 && checked < items.length
    }
    const count = selectedUrls().length
    const capacity = fromChooser ? MAX_PANELS : batchCapacity(panels, MAX_PANELS)
    ok.disabled = count === 0 || count > capacity
    ok.textContent = count === 0
      ? 'Abrir'
      : fromChooser
        ? `Abrir ${count} ${count === 1 ? 'jogo' : 'jogos'} em ${count} ${count === 1 ? 'tela' : 'telas'}`
        : `Abrir ${count} ${count === 1 ? 'jogo' : 'jogos'}`
    if (list.childElementCount > 0) {
      status.textContent = count > capacity
        ? fromChooser
          ? `Escolha no máximo ${MAX_PANELS} jogos (uma tela para cada).`
          : `Cabem só mais ${capacity} ${capacity === 1 ? 'jogo' : 'jogos'} (máximo de ${MAX_PANELS} telas).`
        : fromChooser
          ? `${config.hint} Cada jogo ganha uma tela.`
          : config.hint
    }
  }
  const load = async () => {
    status.textContent = config.loading
    list.innerHTML = ''
    updateSelection()
    refresh.disabled = true
    // A dev app whose main process predates this list has no handler; say so instead of spinning forever.
    const result: BatchLoad = await config.load().catch(() => ({ status: 'error', message: 'Não foi possível buscar a lista. Se o app foi atualizado, feche e abra o Quadra de novo.' }))
    if (!backdrop.isConnected) return
    refresh.disabled = false
    if (result.status === 'error') {
      status.textContent = result.message
      return
    }
    if (result.events.length === 0) {
      status.textContent = config.empty
      return
    }
    events = result.events
    renderList()
  }
  let events: BatchEvent[] = []
  let order: BllBatchOrder = loadBllBatchOrder()
  const orderButtons = [...backdrop.querySelectorAll<HTMLButtonElement>('[data-order]')]
  const renderList = () => {
    for (const button of orderButtons) button.setAttribute('aria-pressed', String(button.dataset.order === order))
    if (events.length === 0) return
    // Switching the order keeps the games already ticked.
    const checked = new Set(selectedUrls())
    const groups = source !== 'bll' ? groupByCompetition(events) : order === 'time' ? groupByTime(events) : groupByLeague(events)
    list.innerHTML = batchListHtml(groups, fromChooser, checked, source === 'bll' && order === 'time')
    updateSelection()
  }
  for (const button of orderButtons) {
    button.addEventListener('click', () => {
      order = button.dataset.order === 'time' ? 'time' : 'league'
      saveBllBatchOrder(order)
      renderList()
    })
  }
  renderList()
  const finish = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    finish()
  }
  list.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement
    if (input.dataset.group !== undefined) {
      for (const item of list.querySelectorAll<HTMLInputElement>(`input[data-group-item="${input.dataset.group}"]:not(:disabled)`)) {
        item.checked = input.checked
      }
    }
    updateSelection()
  })
  refresh.addEventListener('click', () => void load())
  backdrop.querySelector('[data-cancel]')!.addEventListener('click', finish)
  const channelsButton = backdrop.querySelector<HTMLButtonElement>('[data-channels]')
  if (channelsButton) setupYoutubeChannelEditor(backdrop, channelsButton, () => void load())
  ok.addEventListener('click', () => {
    const urls = selectedUrls()
    finish()
    if (fromChooser && view === 'choose') startWithGames(urls)
    else applyBatch(urls, source, firstPanelId)
  })
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish() })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(backdrop)
  backdrop.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
  void load()
}

/** The "Canais…" view of the YouTube batch dialog: the list of channels read for lives, saved in this browser profile. */
function setupYoutubeChannelEditor(backdrop: HTMLElement, toggle: HTMLButtonElement, reload: () => void) {
  const editor = backdrop.querySelector<HTMLElement>('.yt-channels')!
  const hint = editor.querySelector<HTMLElement>('.yt-channels__hint')!
  const listEl = editor.querySelector<HTMLUListElement>('.yt-channels__list')!
  const form = editor.querySelector<HTMLFormElement>('.yt-channels__add')!
  const input = form.querySelector<HTMLInputElement>('input')!
  const addButton = form.querySelector<HTMLButtonElement>('button')!
  const message = editor.querySelector<HTMLElement>('.yt-channels__message')!
  const batchParts = [...backdrop.querySelectorAll<HTMLElement>('.bll-batch__dialog > .bll-batch__status, .bll-batch__list, [data-refresh], [data-ok]')]
  let channels = loadYoutubeChannels()
  let changed = false
  const render = () => {
    hint.textContent = `As lives são procuradas nestes ${channels.length} canais (máximo ${MAX_YOUTUBE_CHANNELS}). Cada canal gasta cerca de 2 unidades da cota diária por busca.`
    listEl.innerHTML = channels.map((channel) => `<li><span>${escapeHtml(channel.title)}</span><button type="button" class="yt-channels__remove" data-remove="${escapeHtml(channel.id)}" aria-label="Remover ${escapeHtml(channel.title)}" title="Remover">×</button></li>`).join('')
    addButton.disabled = channels.length >= MAX_YOUTUBE_CHANNELS
  }
  const update = (next: YoutubeChannel[]) => {
    channels = next
    changed = true
    saveYoutubeChannels(channels)
    render()
  }
  const setOpen = (open: boolean) => {
    editor.hidden = !open
    for (const part of batchParts) part.hidden = open
    toggle.textContent = open ? 'Voltar à lista' : 'Canais…'
    if (open) {
      channels = loadYoutubeChannels()
      message.textContent = ''
      render()
      input.focus()
    } else if (changed) {
      changed = false
      reload()
    }
  }
  toggle.addEventListener('click', () => setOpen(editor.hidden !== false))
  listEl.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-remove]')?.dataset.remove
    if (!id) return
    const removed = channels.find((channel) => channel.id === id)
    update(channels.filter((channel) => channel.id !== id))
    message.textContent = removed ? `${removed.title} removido.` : ''
  })
  editor.querySelector('[data-restore]')!.addEventListener('click', () => {
    update(DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel })))
    message.textContent = 'Lista padrão restaurada.'
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text) return
    addButton.disabled = true
    message.textContent = 'Procurando o canal…'
    const result: YoutubeChannelResult = await window.quadra?.resolveYoutubeChannel(text)
      .catch((): YoutubeChannelResult => ({ status: 'unavailable' })) ?? { status: 'unavailable' }
    if (!backdrop.isConnected) return
    addButton.disabled = channels.length >= MAX_YOUTUBE_CHANNELS
    if (result.status !== 'ok') {
      message.textContent = YOUTUBE_CHANNEL_ERRORS[result.status]
      return
    }
    input.value = ''
    if (channels.some((channel) => channel.id === result.channel.id)) {
      message.textContent = `${result.channel.title} já está na lista.`
      return
    }
    update([...channels, result.channel].slice(0, MAX_YOUTUBE_CHANNELS))
    message.textContent = `${result.channel.title} adicionado.`
  })
}

function autoOpenBusy() {
  // The Auto mode dialog itself doesn't block: turning the mode on opens the games right away.
  return editorOpen || dragState !== null || document.querySelector('.confirm:not(.auto-open)') !== null || autoEntries.length > 0
}

/** The user closed or changed a panel Auto mode opened: that game doesn't come back. */
function dismissAutoOpen(id: PanelId) {
  const entry = autoOpenPanels.get(id)
  if (!entry) return
  autoOpenDismissed.add(entry.url)
  autoOpenPanels.delete(id)
}

function autoOpenStatusText() {
  if (!autoOpenOn) return 'Desligado. Ligue para o Quadra abrir sozinho os jogos que começarem.'
  if (!autoOpenReadAt) return autoOpenError || 'Ligado · lendo a lista da BLL…'
  const time = new Date(autoOpenReadAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const opened = autoOpenPanels.size
  const parts = [`Ligado · lista lida às ${time}`, `${opened} ${opened === 1 ? 'jogo aberto' : 'jogos abertos'} pelo modo Auto`]
  if (autoOpenSkipped > 0) parts.push(`${autoOpenSkipped} sem time principal esperando tela livre`)
  return `${parts.join(' · ')}.${autoOpenError ? ` ${autoOpenError}` : ''}`
}

function updateAutoOpenIndicators() {
  const status = autoOpenStatusText()
  for (const element of document.querySelectorAll<HTMLElement>('[data-auto-open-status]')) element.textContent = status
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-auto-open-toggle]')) button.textContent = autoOpenOn ? 'Desligar modo Auto' : 'Ligar modo Auto'
  const startButton = document.querySelector<HTMLButtonElement>('#btn-start-auto-open')
  if (startButton) {
    startButton.textContent = autoOpenOn ? 'Modo Auto: ligado' : 'Modo Auto'
    startButton.setAttribute('aria-pressed', String(autoOpenOn))
  }
  const menuItem = document.querySelector<HTMLButtonElement>('#btn-auto-open')
  if (menuItem) menuItem.textContent = autoOpenOn ? 'Modo Auto: ligado…' : 'Modo Auto…'
  const more = document.querySelector<HTMLButtonElement>('#btn-more')
  more?.classList.toggle('is-auto-open', autoOpenOn)
  more?.setAttribute('aria-label', autoOpenOn ? 'Mais opções (modo Auto ligado)' : 'Mais opções')
}

function autoOpenCandidates(): AutoOpenCandidate[] {
  return autoOpenEvents.flatMap((event) => {
    if (!event.live || autoOpenDismissed.has(event.url)) return []
    const decision = autoOpenDecision(event, autoOpenSettings)
    return decision.open ? [{ url: event.url, name: event.name, mainTeam: decision.mainTeam !== null }] : []
  })
}

function markAutoOpened(id: PanelId, url: string, mainTeam: boolean) {
  autoOpenPanels.delete(id)
  autoOpenPanels.set(id, { url, mainTeam })
  autoOpenSeen.add(url)
}

/** Opens the games of the last BLL list read that fit the lists, waiting while the user organizes, drags, answers a dialog or watches a goal highlight. */
function applyAutoOpen() {
  if (autoOpenRetryTimer !== null) window.clearTimeout(autoOpenRetryTimer)
  autoOpenRetryTimer = null
  if (!autoOpenOn) return
  for (const [id, entry] of autoOpenPanels) {
    if (panelById(id)?.url !== entry.url) autoOpenPanels.delete(id)
  }
  const candidates = autoOpenCandidates()
  const mainTeam = new Map(candidates.map((candidate) => [candidate.url, candidate.mainTeam]))
  if (candidates.length > 0 && autoOpenBusy()) {
    autoOpenRetryTimer = window.setTimeout(applyAutoOpen, AUTO_OPEN_RETRY_MS)
    return
  }
  if (view === 'choose') {
    // From the start screen only a game Auto mode hasn't opened yet starts a grid, so "Voltar" isn't undone a minute later.
    autoOpenSkipped = 0
    if (candidates.some((candidate) => !autoOpenSeen.has(candidate.url))) {
      const chosen = [...candidates].sort((a, b) => Number(b.mainTeam) - Number(a.mainTeam))
      autoOpenSkipped = Math.max(0, chosen.length - MAX_PANELS)
      startWithGames(chosen.slice(0, MAX_PANELS).map((candidate) => candidate.url))
      autoOpenPanels.clear()
      for (const panel of panels) markAutoOpened(panel.id, panel.url, mainTeam.get(panel.url) ?? false)
    }
    updateAutoOpenIndicators()
    return
  }
  // Oldest Auto panels last, in the order they were opened: the first to give way to a main-team game.
  const ordered = [
    ...panels.filter((panel) => !autoOpenPanels.has(panel.id)),
    ...[...autoOpenPanels.keys()].map((id) => panelById(id)).filter((panel): panel is Panel => Boolean(panel)),
  ]
  const plan = planAutoOpen(ordered.map((panel) => ({ id: panel.id, url: panel.url, auto: autoOpenPanels.has(panel.id), mainTeam: autoOpenPanels.get(panel.id)?.mainTeam ?? false })), candidates, MAX_PANELS)
  autoOpenSkipped = plan.skipped
  if (plan.fill.length + plan.extra.length + plan.replace.length > 0) {
    for (const { panelId, url } of [...plan.fill, ...plan.replace]) {
      const panel = panelById(panelId)
      if (!panel) continue
      clearPanelMatchState(panelId)
      panel.url = url
      panel.draftUrl = url
      markAutoOpened(panelId, url, mainTeam.get(url) ?? false)
    }
    const added = plan.extra.map((url) => ({ ...createPanel(), url, draftUrl: url }))
    panels = [...panels, ...added]
    for (const panel of added) markAutoOpened(panel.id, panel.url, mainTeam.get(panel.url) ?? false)
    buildCurrentLayout()
    renderGrid()
    syncLayout()
    if (bllsportTargetId && panelById(bllsportTargetId)?.url) {
      const next = panels.find((panel) => !panel.url)
      bllsportTargetId = next?.id ?? null
      if (next) window.quadra?.setBllsportTarget(next.id, panelLabel(next.id))
      else window.quadra?.setBllsportTarget(null)
    }
  }
  updateAutoOpenIndicators()
}

async function pollAutoOpen() {
  if (!autoOpenOn || autoOpenReading) return
  autoOpenReading = true
  const result = await window.quadra?.listBllsportEvents().catch(() => null) ?? null
  autoOpenReading = false
  if (!autoOpenOn) return
  if (!result || result.status !== 'ok') {
    autoOpenError = window.quadra ? 'Não foi possível ler a lista da BLL; tenta de novo em 25 s. Se continuar, abra a BLL num painel e confira o login.' : 'O modo Auto só funciona no app do Quadra.'
    updateAutoOpenIndicators()
    return
  }
  autoOpenError = ''
  autoOpenReadAt = Date.now()
  autoOpenEvents = result.events
  applyAutoOpen()
}

function setAutoOpen(on: boolean) {
  if (autoOpenOn === on) return
  autoOpenOn = on
  if (autoOpenTimer !== null) window.clearInterval(autoOpenTimer)
  if (autoOpenRetryTimer !== null) window.clearTimeout(autoOpenRetryTimer)
  autoOpenTimer = null
  autoOpenRetryTimer = null
  autoOpenEvents = []
  autoOpenReadAt = 0
  autoOpenError = ''
  autoOpenSkipped = 0
  if (on) {
    // Turning the mode on opens the games already live too, even from the start screen.
    autoOpenSeen.clear()
    autoOpenTimer = window.setInterval(() => void pollAutoOpen(), AUTO_OPEN_POLL_MS)
    void pollAutoOpen()
  }
  updateAutoOpenIndicators()
}

function competitionRowHtml(id: string, label: string, mode: CompetitionMode, custom = false) {
  return `<div class="auto-open__row"><span>${escapeHtml(label)}</span>
    <select ${custom ? `data-custom-competition="${escapeHtml(id)}"` : `data-competition="${escapeHtml(id)}"`} aria-label="${escapeHtml(label)}">
      ${(['all', 'teams', 'off'] as const).map((value) => `<option value="${value}"${mode === value ? ' selected' : ''}>${COMPETITION_MODE_LABEL[value]}</option>`).join('')}
    </select>${custom ? `<button type="button" class="yt-channels__remove" data-remove-competition="${escapeHtml(id)}" aria-label="Remover ${escapeHtml(label)}" title="Remover">×</button>` : ''}</div>`
}

function autoOpenListsHtml(settings: AutoOpenSettings) {
  const group = (legend: string, rules: readonly CompetitionRule[]) => `<fieldset class="bll-batch__group auto-open__group"><legend>${legend}</legend>
    ${rules.map((rule) => competitionRowHtml(rule.id, rule.label, settings.competitions[rule.id] ?? 'off')).join('')}</fieldset>`
  return `${group('Brasil', COMPETITIONS.filter((rule) => rule.region === 'Brasil'))}
    ${group('Europa · ligas', COMPETITIONS.filter((rule) => rule.region === 'Europa' && rule.kind === 'liga'))}
    ${group('Europa · copas', COMPETITIONS.filter((rule) => rule.region === 'Europa' && rule.kind === 'copa'))}
    <fieldset class="bll-batch__group auto-open__group"><legend>Outras competições</legend>
      ${settings.custom.map((item, index) => competitionRowHtml(String(index), item.name, item.mode, true)).join('')}
      <form class="yt-channels__add" data-add-competition>
        <input type="text" name="competition" placeholder="Como aparece na BLL, ex.: Portugal, Liga Portugal" aria-label="Competição" autocomplete="off" spellcheck="false" maxlength="120">
        <button type="submit" class="btn btn--load"${settings.custom.length >= MAX_CUSTOM_COMPETITIONS ? ' disabled' : ''}>Adicionar</button>
      </form>
    </fieldset>
    <fieldset class="bll-batch__group auto-open__group"><legend>Times principais (${settings.teams.length})</legend>
      <p class="bll-batch__status">Nas competições em "Só times principais", só os jogos destes times abrem. Acima de ${MAX_PANELS} telas, eles têm prioridade.</p>
      <ul class="yt-channels__list">${settings.teams.map((team, index) => {
        const name = teamDisplayName(team)
        const aliases = team.split('/').slice(1).map((alias) => alias.trim()).filter(Boolean)
        return `<li${aliases.length ? ` title="Também: ${escapeHtml(aliases.join(', '))}"` : ''}><span>${escapeHtml(name)}</span><button type="button" class="yt-channels__remove" data-remove-team="${index}" aria-label="Remover ${escapeHtml(name)}" title="Remover">×</button></li>`
      }).join('')}</ul>
      <form class="yt-channels__add" data-add-team>
        <input type="text" name="team" placeholder="Nome do time; outros nomes separados por / (ex.: Benfica / SL Benfica)" aria-label="Time" autocomplete="off" spellcheck="false" maxlength="120">
        <button type="submit" class="btn btn--load"${settings.teams.length >= MAX_TEAMS ? ' disabled' : ''}>Adicionar</button>
      </form>
      <label class="auto-open__check"><input type="checkbox" data-teams-anywhere${settings.teamsAnywhere ? ' checked' : ''}> Abrir os jogos dos times principais em qualquer competição</label>
    </fieldset>`
}

function openAutoOpenDialog() {
  document.querySelector('.confirm:not(.ui-dialog)')?.remove()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm bll-batch auto-open'
  backdrop.innerHTML = `<div class="confirm__dialog bll-batch__dialog" role="dialog" aria-modal="true" aria-labelledby="auto-open-title">
    <p id="auto-open-title" class="confirm__message">Modo Auto</p>
    <p class="bll-batch__status" role="status" aria-live="polite" data-auto-open-status></p>
    <div class="auto-open__body">
      <p class="bll-batch__status">Ligado, o Quadra lê a lista da BLL a cada 25 s e abre numa tela cada jogo que começar nas competições escolhidas (só futebol). Jogos que você fechar não voltam.</p>
      <div data-auto-open-lists></div>
      <p class="yt-channels__message" role="status" aria-live="polite" data-auto-open-message></p>
      <button type="button" class="btn btn--ghost yt-channels__restore" data-restore>Restaurar listas padrão</button>
    </div>
    <div class="confirm__actions">
      <button type="button" class="btn btn--ghost" data-cancel>Fechar</button>
      <button type="button" class="btn btn--load" data-auto-open-toggle></button>
    </div>
  </div>`
  const lists = backdrop.querySelector<HTMLElement>('[data-auto-open-lists]')!
  const message = backdrop.querySelector<HTMLElement>('[data-auto-open-message]')!
  let changed = false
  const renderLists = (focus?: string) => {
    lists.innerHTML = autoOpenListsHtml(autoOpenSettings)
    if (focus) lists.querySelector<HTMLInputElement>(focus)?.focus()
  }
  const update = (next: AutoOpenSettings, focus?: string) => {
    autoOpenSettings = next
    changed = true
    saveAutoOpenSettings(autoOpenSettings)
    renderLists(focus)
  }
  const finish = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
    // New lists count from the last BLL read, without waiting for the next one.
    if (changed) applyAutoOpen()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    finish()
  }
  lists.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    if (target instanceof HTMLSelectElement && target.dataset.competition) {
      update({ ...autoOpenSettings, competitions: { ...autoOpenSettings.competitions, [target.dataset.competition]: target.value as CompetitionMode } })
    } else if (target instanceof HTMLSelectElement && target.dataset.customCompetition !== undefined) {
      const index = Number(target.dataset.customCompetition)
      update({ ...autoOpenSettings, custom: autoOpenSettings.custom.map((item, position) => position === index ? { ...item, mode: target.value as CompetitionMode } : item) })
    } else if (target instanceof HTMLInputElement && target.dataset.teamsAnywhere !== undefined) {
      update({ ...autoOpenSettings, teamsAnywhere: target.checked })
    }
  })
  lists.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-team], [data-remove-competition]')
    if (!button) return
    if (button.dataset.removeTeam !== undefined) {
      const index = Number(button.dataset.removeTeam)
      const removed = teamDisplayName(autoOpenSettings.teams[index] ?? '')
      update({ ...autoOpenSettings, teams: autoOpenSettings.teams.filter((_, position) => position !== index) }, '[data-add-team] input')
      message.textContent = removed ? `${removed} removido.` : ''
    } else {
      const index = Number(button.dataset.removeCompetition)
      const removed = autoOpenSettings.custom[index]?.name ?? ''
      update({ ...autoOpenSettings, custom: autoOpenSettings.custom.filter((_, position) => position !== index) }, '[data-add-competition] input')
      message.textContent = removed ? `${removed} removida.` : ''
    }
  })
  lists.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const input = form.querySelector<HTMLInputElement>('input')!
    const text = input.value.replace(/\s+/g, ' ').trim()
    if (!text) return
    if (form.dataset.addTeam !== undefined) {
      const name = teamDisplayName(text)
      if (!name) return
      if (autoOpenSettings.teams.some((team) => mainTeamOf(`${name} x Adversário`, [team]) || teamDisplayName(team).toLowerCase() === name.toLowerCase())) {
        message.textContent = `${name} já está na lista.`
        return
      }
      update({ ...autoOpenSettings, teams: [...autoOpenSettings.teams, text].slice(0, MAX_TEAMS) }, '[data-add-team] input')
      message.textContent = `${name} adicionado.`
    } else {
      if (autoOpenSettings.custom.some((item) => item.name.toLowerCase() === text.toLowerCase())) {
        message.textContent = `${text} já está na lista.`
        return
      }
      update({ ...autoOpenSettings, custom: [...autoOpenSettings.custom, { name: text, mode: 'all' as const }].slice(0, MAX_CUSTOM_COMPETITIONS) }, '[data-add-competition] input')
      message.textContent = `${text} adicionada (todos os jogos).`
    }
  })
  backdrop.querySelector('[data-restore]')!.addEventListener('click', () => {
    update(defaultAutoOpenSettings())
    message.textContent = 'Listas padrão restauradas.'
  })
  backdrop.querySelector('[data-auto-open-toggle]')!.addEventListener('click', () => setAutoOpen(!autoOpenOn))
  backdrop.querySelector('[data-cancel]')!.addEventListener('click', finish)
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish() })
  document.addEventListener('keydown', onKey)
  renderLists()
  document.body.appendChild(backdrop)
  updateAutoOpenIndicators()
  backdrop.querySelector<HTMLButtonElement>('[data-auto-open-toggle]')?.focus()
}

function openAllPanels() {
  panels = panels.map((panel) => {
    const input = app.querySelector<HTMLInputElement>(`[data-panel-id="${CSS.escape(panel.id)}"] input[name="url"]`)
    const url = input ? normalizeUrl(input.value) : panel.url
    if (panel.url !== url) {
      clearPanelMatchState(panel.id)
      dismissAutoOpen(panel.id)
    }
    if (url) {
      dismissedMatchLabels.delete(panel.id)
      forceReloadIds.add(panel.id)
    } else {
      forceReloadIds.delete(panel.id)
      clearPanelMatchState(panel.id)
    }
    return { ...panel, url, draftUrl: url }
  })
  renderGrid()
}

function allPanelsMuted() {
  return panels.length > 0 && panels.every((panel) => panel.muted)
}

function updateAudioControls() {
  const allMuted = allPanelsMuted()
  const globalButton = app.querySelector<HTMLButtonElement>('#btn-mute-all')
  if (globalButton) {
    globalButton.textContent = allMuted ? 'Ativar som de todos' : 'Mutar todos'
    globalButton.setAttribute('aria-pressed', String(allMuted))
  }
  for (const panel of panels) {
    const button = app.querySelector<HTMLButtonElement>(`[data-panel-id="${CSS.escape(panel.id)}"] [data-mute]`)
    if (!button) continue
    const label = `${panel.muted ? 'Ativar som do' : 'Mutar'} jogo ${panelIndex(panel.id) + 1}`
    button.textContent = panel.muted ? 'Ativar som' : 'Mutar'
    button.setAttribute('aria-pressed', String(panel.muted))
    button.setAttribute('aria-label', label)
    button.title = label
  }
  scheduleSyncLayout()
}

function togglePanelMute(id: PanelId) {
  const panel = panelById(id)
  if (!panel) return
  panel.muted = !panel.muted
  updateAudioControls()
}

function panelAlertsLabel(panel: Panel) {
  return `${panel.alertsOff ? 'Ativar' : 'Desativar'} alertas do jogo ${panelIndex(panel.id) + 1}`
}

function panelAlertsIconHtml(off: boolean) {
  return `<svg class="panel__alerts-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.2H2.8zM6.6 14.2a1.5 1.5 0 0 0 2.8 0" />${off ? '<path d="M2.2 2.2l11.6 11.6" />' : ''}</svg>`
}

/** Turns every alert of one panel off or on (ring, sound, goal highlight); memory only, like mute. */
function togglePanelAlerts(id: PanelId) {
  const panel = panelById(id)
  if (!panel) return
  panel.alertsOff = !panel.alertsOff
  if (panel.alertsOff) {
    clearPendingAlerts(id)
    clearAlert(id, app)
    clearVarReview(id, app)
    releaseAutoPanel(id)
  }
  syncAlertAudio()
  const button = app.querySelector<HTMLButtonElement>(`[data-panel-id="${CSS.escape(id)}"] [data-alerts]`)
  if (!button) return
  const label = panelAlertsLabel(panel)
  button.innerHTML = panelAlertsIconHtml(panel.alertsOff)
  button.setAttribute('aria-pressed', String(panel.alertsOff))
  button.setAttribute('aria-label', label)
  button.title = label
}

function toggleAllMuted() {
  const muted = !allPanelsMuted()
  for (const panel of panels) panel.muted = muted
  updateAudioControls()
}

function clearAllPanels() {
  pushHistory()
  clearAllPanelMatchState()
  for (const panel of panels) dismissAutoOpen(panel.id)
  panels = panels.map((panel) => ({ ...panel, url: '', draftUrl: '' }))
  renderGrid()
}

function setShowMatchLabels(next: boolean) {
  showMatchLabels = next
  const button = app.querySelector<HTMLButtonElement>('#btn-match-labels')
  if (button) {
    button.setAttribute('aria-pressed', String(showMatchLabels))
    button.textContent = showMatchLabels ? 'Ocultar nomes dos jogos' : 'Mostrar nomes dos jogos'
  }
  updatePanelLabels()
}

function urlFormHtml(panel: Panel, options: { withClose?: boolean } = {}): string {
  const index = panelIndex(panel.id)
  const closeBtn = options.withClose
    ? '<button type="button" class="btn btn--ghost btn--icon panel__close" data-close aria-label="Fechar edição"><span aria-hidden="true">×</span></button>'
    : ''

  return `
    <form class="panel__bar" data-panel-form data-panel-id="${escapeHtml(panel.id)}" novalidate>
      <label class="visually-hidden" for="url-${escapeHtml(panel.id)}">URL do jogo ${index + 1}</label>
      <input id="url-${escapeHtml(panel.id)}" type="url" name="url" inputmode="url" autocomplete="off" spellcheck="false"
        placeholder="Cole link YouTube ou URL e pressione Enter" value="${escapeHtml(panel.draftUrl)}" />
      <button type="button" class="btn btn--bllsport${bllsportTargetId === panel.id ? ' is-target' : ''}" data-bllsport aria-pressed="${bllsportTargetId === panel.id}" aria-label="Escolher jogo no BLL para o jogo ${index + 1}" title="Abrir BLL para este painel">BLL</button>
      <button type="button" class="btn btn--youtube" data-youtube aria-label="Escolher live do YouTube para o jogo ${index + 1}" title="Abrir jogos ao vivo do YouTube">YouTube</button>
      <button type="button" class="btn btn--zapping" data-zapping aria-label="Abrir Zapping no jogo ${index + 1}" title="Abrir Zapping para este painel">Zapping</button>
      <button type="submit" class="btn btn--load" aria-label="Abrir link">Abrir</button>
      <button type="button" class="btn btn--clear" data-clear aria-label="Limpar link">Limpar</button>
      ${closeBtn}
    </form>
  `
}

function panelActionsHtml(panel: Panel): string {
  const isHighlighted = highlighted.has(panel.id)
  const canRemove = panels.length > MIN_PANELS
  const removeLabel = canRemove
    ? `Remover tela ${panelIndex(panel.id) + 1}`
    : 'É necessário manter pelo menos uma tela'
  return `
    <div class="panel__controls" aria-label="Ações do jogo ${panelIndex(panel.id) + 1}">
      ${panels.length > 1 ? `<button type="button" class="btn btn--ghost btn--icon panel__drag" data-drag aria-label="Arrastar jogo ${panelIndex(panel.id) + 1} para trocar de posição" title="Arrastar para trocar de posição">⠿</button>` : ''}
      <button type="button" class="btn btn--ghost panel__mute" data-mute aria-pressed="${panel.muted}" aria-label="${panel.muted ? 'Ativar som do' : 'Mutar'} jogo ${panelIndex(panel.id) + 1}" title="${panel.muted ? 'Ativar som do' : 'Mutar'} jogo ${panelIndex(panel.id) + 1}">${panel.muted ? 'Ativar som' : 'Mutar'}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-highlight aria-pressed="${isHighlighted}" aria-label="${isHighlighted ? 'Remover destaque' : 'Destacar jogo'}" title="${isHighlighted ? 'Remover destaque' : 'Destacar jogo'}">${isHighlighted ? '★' : '☆'}</button>
      ${panel.url ? '<button type="button" class="btn btn--ghost btn--icon" data-edit aria-label="Editar URL" title="Editar URL">✎</button>' : ''}
      ${panel.url ? `<button type="button" class="btn btn--ghost btn--icon panel__reload" data-reload aria-label="Recarregar jogo ${panelIndex(panel.id) + 1}" title="Recarregar página"><img src="./reload-icon.png" alt="" aria-hidden="true" /></button>` : ''}
      ${panel.url ? `<button type="button" class="btn btn--ghost btn--icon panel__alerts" data-alerts aria-pressed="${panel.alertsOff}" aria-label="${panelAlertsLabel(panel)}" title="${panelAlertsLabel(panel)}">${panelAlertsIconHtml(panel.alertsOff)}</button>` : ''}
      <button type="button" class="btn btn--ghost btn--icon panel__remove" data-remove aria-label="${removeLabel}" title="${removeLabel}"${canRemove ? '' : ' disabled'}><img src="./trash-icon.png" alt="" aria-hidden="true" /></button>
    </div>
  `
}

function panelInnerHtml(panel: Panel): string {
  if (!panel.url) {
    return `
      ${panelActionsHtml(panel)}
      <div class="panel__empty">
        <p class="panel__slot">Jogo ${panelIndex(panel.id) + 1}</p>
        ${urlFormHtml(panel)}
      </div>
    `
  }

  return `
    ${panelActionsHtml(panel)}
    <div class="panel__overlay">
      ${urlFormHtml(panel, { withClose: true })}
    </div>
    <div class="panel__stage" data-stage aria-hidden="true"></div>
  `
}

function renderPanelElements() {
  const stage = app.querySelector<HTMLElement>('#layout-stage')
  if (!stage) return
  stage.dataset.layoutMode = layoutMode
  const result = calculateLayout(layoutTree)
  const rects = new Map(result.rects.map((rect) => [rect.panelId, rect]))

  for (const panelElement of stage.querySelectorAll<HTMLElement>('.panel')) {
    const rect = rects.get(panelElement.dataset.panelId ?? '')
    if (!rect) continue
    panelElement.style.left = `${rect.x * 100}%`
    panelElement.style.top = `${rect.y * 100}%`
    panelElement.style.width = `${rect.width * 100}%`
    panelElement.style.height = `${rect.height * 100}%`
  }

  scheduleSyncLayout()
  updatePanelLabels()
}

function focusPendingPanel() {
  const id = pendingFocusPanelId
  if (!id) return
  pendingFocusPanelId = null
  const focus = () => {
    const input = app.querySelector<HTMLInputElement>(`[data-panel-id="${CSS.escape(id)}"] input[name="url"]`)
    input?.focus()
    input?.select()
  }
  focus()
  requestAnimationFrame(focus)
}

function setPanelEditing(panel: HTMLElement, editing: boolean) {
  panel.classList.toggle('is-editing', editing)
  if (editing) {
    const input = panel.querySelector<HTMLInputElement>('.panel__overlay input[name="url"]')
    input?.focus()
    input?.select()
  }
  scheduleSyncLayout()
}

function bindPanelForm(panelElement: HTMLElement) {
  const id = panelElement.dataset.panelId
  if (!id) return
  const form = panelElement.querySelector<HTMLFormElement>('[data-panel-form]')
  form?.querySelector<HTMLInputElement>('input[name="url"]')?.addEventListener('input', (event) => {
    const panel = panelById(id)
    if (panel) panel.draftUrl = (event.target as HTMLInputElement).value
  })
  form?.addEventListener('pointerenter', () => setChromeInteractive(true))
  form?.addEventListener('pointerdown', () => setChromeInteractive(true))

  panelElement.querySelector('[data-mute]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    togglePanelMute(id)
  })
  panelElement.querySelector('[data-edit]')?.addEventListener('click', () => setPanelEditing(panelElement, true))
  panelElement.querySelector('[data-reload]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    const panel = panelById(id)
    if (panel?.url) applyPanelUrl(id, panel.url)
  })
  panelElement.querySelector('[data-alerts]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    togglePanelAlerts(id)
  })
  panelElement.querySelector('[data-remove]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    removePanel(id)
  })
  panelElement.querySelector<HTMLButtonElement>('[data-drag]')?.addEventListener('pointerdown', (event) => startPanelDrag(id, event))
  panelElement.querySelector('[data-highlight]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    chooseHighlight(id)
  })

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = form.elements.namedItem('url') as HTMLInputElement
    applyPanelUrl(id, normalizeUrl(input.value))
  })
  form?.querySelector('[data-clear]')?.addEventListener('click', () => applyPanelUrl(id, ''))
  form?.querySelector('[data-weddbets]')?.addEventListener('click', () => openWeddbets(id))
  form?.querySelector('[data-bllsport]')?.addEventListener('click', () => openBllsport(id))
  form?.querySelector('[data-youtube]')?.addEventListener('click', () => openBatch('youtube', id))
  form?.querySelector('[data-zapping]')?.addEventListener('click', () => openZapping(id))
  form?.querySelector('[data-close]')?.addEventListener('click', () => setPanelEditing(panelElement, false))
  form?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setPanelEditing(panelElement, false)
  })
}

function isFullscreenActive() {
  return window.quadra ? nativeFullscreen : document.fullscreenElement !== null
}

function updateFullscreenButton() {
  const button = app.querySelector<HTMLButtonElement>('#btn-fullscreen')
  if (button) button.textContent = isFullscreenActive() ? 'Minimizar' : 'Tela Cheia'
}

function toggleFullscreen() {
  const shell = app.querySelector<HTMLElement>('.grid-shell')
  if (!shell) return
  if (window.quadra) {
    nativeFullscreen = !nativeFullscreen
    updateFullscreenButton()
    window.quadra.setFullscreen(nativeFullscreen)
    scheduleSyncLayout()
    return
  }
  if (document.fullscreenElement) void document.exitFullscreen()
  else void shell.requestFullscreen().catch(() => {})
}

function confirmAction(message: string, confirmLabel = 'Confirmar'): Promise<boolean> {
  return new Promise((resolve) => {
    document.querySelector('.confirm:not(.ui-dialog)')?.remove()
    const backdrop = document.createElement('div')
    backdrop.className = 'confirm'
    backdrop.innerHTML = `<div class="confirm__dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <p id="confirm-title" class="confirm__message">${escapeHtml(message)}</p>
      <div class="confirm__actions"><button type="button" class="btn btn--ghost" data-cancel>Cancelar</button>
      <button type="button" class="btn btn--load" data-ok>${escapeHtml(confirmLabel)}</button></div>
    </div>`
    const finish = (value: boolean) => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(value)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false)
    }
    backdrop.querySelector('[data-cancel]')!.addEventListener('click', () => finish(false))
    backdrop.querySelector('[data-ok]')!.addEventListener('click', () => finish(true))
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(false) })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(backdrop)
    backdrop.querySelector<HTMLButtonElement>('[data-ok]')?.focus()
  })
}

/** Body of a dialog from the main process: "• " lines become a list, the other blocks paragraphs. */
function uiDialogBodyHtml(detail: string): string {
  const blocks: string[] = []
  let items: string[] = []
  const flush = () => {
    if (items.length) blocks.push(`<ul class="ui-dialog__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
    items = []
  }
  for (const line of detail.split('\n')) {
    const text = line.trim()
    if (text.startsWith('•')) items.push(text.replace(/^•\s*/, ''))
    else {
      flush()
      if (text) blocks.push(`<p class="ui-dialog__text">${escapeHtml(text)}</p>`)
    }
  }
  flush()
  return blocks.join('')
}

type UiDialogPayload = Parameters<Parameters<NonNullable<Window['quadra']>['onUiDialog']>[0]>[0]

/** Update prompts: the main process asks, the answer is the index of the button. Stacks over other dialogs. */
function showUiDialog(payload: UiDialogPayload) {
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm ui-dialog'
  const buttons = payload.buttons.map((label, index) => ({ label, index }))
  // The main button goes last (right), as in the other dialogs.
  buttons.sort((a, b) => Number(a.index === payload.defaultId) - Number(b.index === payload.defaultId))
  backdrop.innerHTML = `<div class="confirm__dialog release-notes__dialog ui-dialog__dialog" role="alertdialog" aria-modal="true" aria-labelledby="ui-dialog-message">
    <p class="release-notes__eyebrow">${escapeHtml(payload.title)}</p>
    <h2 id="ui-dialog-message" class="confirm__message">${escapeHtml(payload.message)}</h2>
    <div class="release-notes__scroll ui-dialog__body">${uiDialogBodyHtml(payload.detail)}</div>
    <div class="confirm__actions">${buttons.map(({ label, index }) => `<button type="button" class="btn ${index === payload.defaultId ? 'btn--load' : 'btn--ghost'}" data-response="${index}">${escapeHtml(label)}</button>`).join('')}</div>
  </div>`
  const finish = (response: number) => {
    document.removeEventListener('keydown', onKey, true)
    backdrop.remove()
    window.quadra?.respondUiDialog(payload.id, response)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !backdrop.isConnected) return
    event.preventDefault()
    event.stopPropagation()
    finish(payload.cancelId)
  }
  for (const button of backdrop.querySelectorAll<HTMLButtonElement>('[data-response]')) {
    button.addEventListener('click', () => finish(Number(button.dataset.response)))
  }
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(backdrop)
  backdrop.querySelector<HTMLButtonElement>(`[data-response="${payload.defaultId}"]`)?.focus()
}

function showReleaseNotes(release: Release) {
  document.querySelector('.confirm:not(.ui-dialog)')?.remove()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm release-notes'
  backdrop.innerHTML = `<div class="confirm__dialog release-notes__dialog" role="dialog" aria-modal="true" aria-labelledby="release-notes-title">
    <p class="release-notes__eyebrow">Quadra atualizado</p>
    <h2 id="release-notes-title" class="confirm__message">Novidades da versão ${escapeHtml(release.label)}</h2>
    <div class="release-notes__scroll">${releaseHistory(release).map((entry, index) => `<section class="release-notes__version">
      ${index > 0 ? `<h3>Versão ${escapeHtml(entry.label)}</h3>` : ''}
      <ul class="release-notes__list">${entry.notes.map((note) => `<li><strong>${escapeHtml(note.title)}</strong><p>${escapeHtml(note.body)}</p></li>`).join('')}</ul>
    </section>`).join('')}</div>
    <div class="confirm__actions"><button type="button" class="btn btn--load" data-ok>Entendi</button></div>
  </div>`
  const close = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  backdrop.querySelector('[data-ok]')!.addEventListener('click', close)
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close() })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(backdrop)
  backdrop.querySelector<HTMLButtonElement>('[data-ok]')?.focus()
}

/** The welcome guide: three steps, from the home button or by itself on a fresh install. */
function showFirstSteps() {
  document.querySelector('.confirm:not(.ui-dialog)')?.remove()
  markFirstStepsSeen()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm first-steps'
  backdrop.innerHTML = `<div class="confirm__dialog release-notes__dialog first-steps__dialog" role="dialog" aria-modal="true" aria-labelledby="first-steps-title">
    <p class="release-notes__eyebrow">Bem-vindo ao Quadra</p>
    <h2 id="first-steps-title" class="confirm__message">Acompanhe vários jogos ao mesmo tempo</h2>
    <div class="release-notes__scroll"><ol class="first-steps__list">${FIRST_STEPS.map((step) => `<li><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.body)}</p></li>`).join('')}</ol></div>
    <p class="first-steps__hint">Para ver isto de novo, use o botão <strong>Primeiros passos</strong> na tela inicial.</p>
    <div class="confirm__actions"><button type="button" class="btn btn--load" data-ok>Começar</button></div>
  </div>`
  const close = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  backdrop.querySelector('[data-ok]')!.addEventListener('click', close)
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close() })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(backdrop)
  backdrop.querySelector<HTMLButtonElement>('[data-ok]')?.focus()
}

/** Fresh install: the guide replaces "what's new" (nothing is new to a new user). `?first-steps=off|on` overrides for smokes. */
function showFirstStepsIfNew(): boolean {
  const override = new URLSearchParams(location.search).get('first-steps')
  if (window.quadra ? override === 'off' : override !== 'on') return false
  if (!shouldShowFirstSteps(readFirstStepsSeen(), readLastSeenVersion())) return false
  markVersionSeen(version)
  showFirstSteps()
  return true
}

/** Once per installed version, after an update (or a first install). `?release-notes=off|on` overrides for smokes. */
function showReleaseNotesIfNew() {
  const override = new URLSearchParams(location.search).get('release-notes')
  if (window.quadra ? override === 'off' : override !== 'on') return
  if (showFirstStepsIfNew()) return
  const release = releaseToShow(version, readLastSeenVersion())
  if (!release) return
  markVersionSeen(version)
  showReleaseNotes(release)
}

function setChromeInteractive(interactive: boolean) {
  if (lastChromeInteractive === interactive) return
  lastChromeInteractive = interactive
  const active = document.activeElement
  const editing = active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]')
  window.quadra?.setChromeInteractive(interactive, !interactive && !editing)
}

/** The alert output stays open while a game can alert, even with every panel muted. */
function syncAlertAudio() {
  setAlertAudioAwake(view === 'grid' && panels.some((panel) => panel.url && !panel.alertsOff))
}

function syncLayout() {
  syncAlertAudio()
  infoDrawer.sync()
  if (view === 'choose') {
    setChromeInteractive(true)
    window.quadra?.setLayout({ view: 'choose', panelCount: panels.length, mode: layoutMode, panels: [] })
    return
  }
  const payloadPanels = panels.flatMap((panel) => {
    const panelElement = app.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(panel.id)}"]`)
    if (!panelElement) return []
    const stage = panelElement.querySelector<HTMLElement>('[data-stage]')
    const rect = (stage ?? panelElement).getBoundingClientRect()
    const forceReload = forceReloadIds.has(panel.id)
    if (forceReload) forceReloadIds.delete(panel.id)
    return [{
      id: panel.id,
      url: panel.url,
      muted: panel.muted,
      editing: panelElement.classList.contains('is-editing'),
      forceReload,
      bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    }]
  })
  window.quadra?.setLayout({ view: 'grid', panelCount: panels.length, mode: layoutMode, panels: payloadPanels })
}

function scheduleSyncLayout() {
  if (layoutSyncFrame !== null) cancelAnimationFrame(layoutSyncFrame)
  layoutSyncFrame = requestAnimationFrame(() => {
    layoutSyncFrame = null
    syncLayout()
    updatePanelLabels()
  })
}

function panelAtPoint(x: number, y: number): PanelId | null {
  const stage = app.querySelector<HTMLElement>('#layout-stage')
  if (!stage) return null
  const bounds = stage.getBoundingClientRect()
  const px = (x - bounds.left) / bounds.width
  const py = (y - bounds.top) / bounds.height
  const rect = calculateLayout(layoutTree).rects.find((candidate) =>
    px >= candidate.x && px < candidate.x + candidate.width && py >= candidate.y && py < candidate.y + candidate.height)
  return rect?.panelId ?? null
}

function placeOverPanel(element: HTMLElement, id: PanelId) {
  const rect = calculateLayout(layoutTree).rects.find((candidate) => candidate.panelId === id)
  if (!rect) return
  element.style.left = `${rect.x * 100}%`
  element.style.top = `${rect.y * 100}%`
  element.style.width = `${rect.width * 100}%`
  element.style.height = `${rect.height * 100}%`
}

function updateDropIndicator(targetId: PanelId | null) {
  const stage = app.querySelector<HTMLElement>('#layout-stage')
  if (!stage) return
  let indicator = stage.querySelector<HTMLElement>('.drop-indicator')
  if (!targetId) {
    indicator?.classList.remove('is-visible')
    return
  }
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = 'drop-indicator'
    indicator.setAttribute('aria-hidden', 'true')
    indicator.innerHTML = '<span class="drop-indicator__label"></span>'
    stage.appendChild(indicator)
  }
  placeOverPanel(indicator, targetId)
  const role = highlighted.has(targetId) ? ' (principal)' : ''
  indicator.querySelector('.drop-indicator__label')!.textContent = `Trocar com Jogo ${panelIndex(targetId) + 1}${role}`
  indicator.classList.add('is-visible')
}

function moveDragGhost(x: number, y: number) {
  if (!dragState) return
  let ghost = document.querySelector<HTMLElement>('.drag-ghost')
  if (!ghost) {
    ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.textContent = `Jogo ${panelIndex(dragState.sourceId) + 1}`
    document.body.appendChild(ghost)
  }
  ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`
}

function startPanelDrag(id: PanelId, event: PointerEvent) {
  if (event.button !== 0 || panels.length < 2) return
  cancelPanelDrag()
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  setChromeInteractive(true)
  const abort = new AbortController()
  dragState = { sourceId: id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, targetId: null, abort }
  const { signal } = abort
  handle.addEventListener('pointermove', onPanelDragMove, { signal })
  handle.addEventListener('pointerup', onPanelDragEnd, { signal })
  handle.addEventListener('pointercancel', () => cancelPanelDrag(), { signal })
  handle.addEventListener('lostpointercapture', () => cancelPanelDrag(), { signal })
  document.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key !== 'Escape') return
    keyEvent.preventDefault()
    cancelPanelDrag()
  }, { signal })
}

function onPanelDragMove(event: PointerEvent) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  if (!dragState.active) {
    if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < DRAG_THRESHOLD_PX) return
    dragState.active = true
    document.body.classList.add('is-dragging')
    app.querySelector(`[data-panel-id="${CSS.escape(dragState.sourceId)}"]`)?.classList.add('is-drag-source')
  }
  const target = panelAtPoint(event.clientX, event.clientY)
  dragState.targetId = target && target !== dragState.sourceId ? target : null
  updateDropIndicator(dragState.targetId)
  moveDragGhost(event.clientX, event.clientY)
}

function onPanelDragEnd(event: PointerEvent) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const { sourceId, targetId, active } = dragState
  cancelPanelDrag()
  if (!active || !targetId || !panelById(sourceId) || !panelById(targetId)) return
  pushHistory()
  const result = swapPanels(panelOrder, [...highlighted], sourceId, targetId)
  panelOrder = result.order
  highlighted = new Set(result.highlighted)
  buildCurrentLayout(layoutMode)
  renderGrid()
}

function cancelPanelDrag() {
  if (!dragState) return
  const { abort, sourceId } = dragState
  dragState = null
  abort.abort()
  document.body.classList.remove('is-dragging')
  document.querySelector('.drag-ghost')?.remove()
  app.querySelector('.drop-indicator')?.remove()
  app.querySelector(`[data-panel-id="${CSS.escape(sourceId)}"]`)?.classList.remove('is-drag-source')
}

// The label ignores the mouse (clicks reach the video), so the × shows by
// geometry: only while the pointer is over the team names.
function updateLabelHover(x: number | null, y: number | null) {
  for (const chip of app.querySelectorAll<HTMLElement>('.panel__label-chip')) {
    const rect = chip.getBoundingClientRect()
    const over = x !== null && y !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    chip.closest('.panel__label')?.classList.toggle('is-hovered', over)
  }
}

function updateChromeHitTarget(x: number, y: number) {
  if (dragState) return
  if (view !== 'grid') {
    setChromeInteractive(true)
    return
  }
  updateLabelHover(x, y)
  const target = document.elementFromPoint(x, y)
  setChromeInteractive(Boolean(target?.closest('.toolbar,.back-corner, .panel__controls, .panel__auto-controls, .panel__overlay, .panel__live, .panel__label-dismiss, .panel--empty, .organize-panel, .info-drawer, .confirm')) || infoDrawer.isOverPanel(x, y))
}

let toolbarAbort: AbortController | null = null
let moreMenuAbort: AbortController | null = null
let toolbarResizeObserver: ResizeObserver | null = null
let toolbarHideTimer: number | null = null

function clearToolbarHideTimer() {
  if (toolbarHideTimer !== null) window.clearTimeout(toolbarHideTimer)
  toolbarHideTimer = null
}

function setToolbarVisible(visible: boolean) {
  if (!visible && dragState) return
  const shell = app.querySelector<HTMLElement>('.grid-shell')
  shell?.classList.toggle('is-toolbar-visible', visible)
  document.body.classList.toggle('is-cursor-hidden', !visible)
  window.quadra?.setCursorHidden(!visible)
  if (!visible) setChromeInteractive(false)
}

function scheduleToolbarHide() {
  clearToolbarHideTimer()
  if (view !== 'grid') return
  toolbarHideTimer = window.setTimeout(() => {
    toolbarHideTimer = null
    const protectedUiOpen = Boolean(document.querySelector(
      '.toolbar:hover, .toolbar__menu:not([hidden]), .organize-panel, .confirm',
    ))
    if (protectedUiOpen) {
      scheduleToolbarHide()
      return
    }
    setToolbarVisible(false)
  }, TOOLBAR_IDLE_MS)
}

let backHideTimer: number | null = null

function clearBackHideTimer() {
  if (backHideTimer !== null) window.clearTimeout(backHideTimer)
  backHideTimer = null
}

function setBackVisible(visible: boolean) {
  const shell = app.querySelector<HTMLElement>('.grid-shell')
  if (!shell) return
  shell.classList.toggle('is-back-visible', visible)
  // The top-left panel's own controls sit in the same corner: step aside while the button shows.
  // By geometry, not hit-testing: a playing panel has pointer-events: none and is invisible to elementsFromPoint.
  const corner = visible ? [...shell.querySelectorAll<HTMLElement>('.panel')].find((el) => {
    const r = el.getBoundingClientRect()
    return r.left <= 4 && r.top <= 4 && r.right > 4 && r.bottom > 4
  }) : null
  shell.querySelectorAll('.panel.has-back-button').forEach((el) => { if (el !== corner) el.classList.remove('has-back-button') })
  corner?.classList.add('has-back-button')
}

function scheduleBackHide() {
  clearBackHideTimer()
  backHideTimer = window.setTimeout(() => {
    backHideTimer = null
    if (document.querySelector('.back-corner:hover, .back-corner:focus-visible, .confirm')) {
      scheduleBackHide()
      return
    }
    setBackVisible(false)
  }, BACK_IDLE_MS)
}

/** Shown only while the mouse moves inside the top-left corner; hides 2 s after the last movement there. */
function revealBack(event: MouseEvent) {
  if (view !== 'grid') return
  if (event.clientX > BACK_ZONE.width || event.clientY > BACK_ZONE.height) return
  setBackVisible(true)
  scheduleBackHide()
}

function revealToolbar() {
  if (view !== 'grid') return
  setToolbarVisible(true)
  scheduleToolbarHide()
}

function bindToolbar() {
  toolbarAbort?.abort()
  toolbarResizeObserver?.disconnect()
  toolbarAbort = new AbortController()
  const { signal } = toolbarAbort
  const shell = app.querySelector<HTMLElement>('.grid-shell')
  const toolbar = app.querySelector<HTMLElement>('.toolbar')
  if (!shell || !toolbar) return
  const updateToolbarHeight = () => {
    shell.style.setProperty('--toolbar-height', `${toolbar.getBoundingClientRect().height}px`)
  }
  toolbarResizeObserver = new ResizeObserver(updateToolbarHeight)
  toolbarResizeObserver.observe(toolbar)
  updateToolbarHeight()
  revealToolbar()
  // Windows forwards mouse movement while the transparent overlay passes
  // clicks through to a video. Re-enable input as soon as it reaches a control.
  document.addEventListener('mousemove', (event) => {
    revealToolbar()
    revealBack(event)
    updateChromeHitTarget(event.clientX, event.clientY)
  }, { signal, passive: true })
  document.documentElement.addEventListener('mouseleave', () => updateLabelHover(null, null), { signal, passive: true })
  document.addEventListener('pointerdown', (event) => {
    updateChromeHitTarget(event.clientX, event.clientY)
    revealToolbar()
  }, { signal, passive: true })
  document.addEventListener('keydown', revealToolbar, { signal, passive: true })
  toolbar.addEventListener('pointerenter', () => setChromeInteractive(true), { signal })
  toolbar.addEventListener('focusin', () => setChromeInteractive(true), { signal })
  setChromeInteractive(Boolean(toolbar.matches(':hover')))
}

function bindMoreMenu() {
  moreMenuAbort?.abort()
  moreMenuAbort = new AbortController()
  const { signal } = moreMenuAbort
  const menu = app.querySelector<HTMLElement>('.toolbar__more')
  const trigger = app.querySelector<HTMLButtonElement>('#btn-more')
  const panel = app.querySelector<HTMLElement>('#toolbar-more-menu')
  if (!menu || !trigger || !panel) return
  const setOpen = (open: boolean) => {
    menu.classList.toggle('is-open', open)
    trigger.setAttribute('aria-expanded', String(open))
    panel.hidden = !open
  }
  trigger.addEventListener('click', (event) => { event.stopPropagation(); setOpen(panel.hasAttribute('hidden')) }, { signal })
  app.querySelector('#btn-bll-batch')?.addEventListener('click', () => { setOpen(false); openBatch('bll') }, { signal })
  app.querySelector('#btn-youtube-batch')?.addEventListener('click', () => { setOpen(false); openBatch('youtube') }, { signal })
  app.querySelector('#btn-auto-open')?.addEventListener('click', () => { setOpen(false); openAutoOpenDialog() }, { signal })
  app.querySelector('#btn-equal')?.addEventListener('click', () => { makeEqual(); setOpen(false) }, { signal })
  app.querySelector('#btn-auto')?.addEventListener('click', () => { organizeAutomatically(); setOpen(false) }, { signal })
  app.querySelector('#btn-undo')?.addEventListener('click', () => { undo(); setOpen(false) }, { signal })
  app.querySelector('#btn-clear-all')?.addEventListener('click', () => { clearAllPanels(); setOpen(false) }, { signal })
  app.querySelector('#btn-match-labels')?.addEventListener('click', () => {
    setShowMatchLabels(!showMatchLabels)
    setOpen(false)
  }, { signal })
  bindAlertControls(menu, signal)
  document.addEventListener('click', (event) => { if (!menu.contains(event.target as Node)) setOpen(false) }, { signal })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false) }, { signal })
}

function previewHtml(count: number): string {
  const ids = Array.from({ length: count }, (_, index) => `preview-${index}`)
  const tree = buildLayoutTree(ids)
  const description = getCompositions(count).find((entry) => entry.highlightCount === defaultHighlightCount(count))
  return `<div class="chooser__preview">${calculateLayout(tree).rects.map((rect) => `<span style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%"></span>`).join('')}</div><span class="chooser__composition">${escapeHtml(description?.label ?? `${count} sem destaques`)}</span>`
}

type UpdateCheckResult = Awaited<ReturnType<NonNullable<NonNullable<Window['quadra']>['checkForUpdate']>>>

function updateCheckMessage(result: UpdateCheckResult): string {
  switch (result) {
    case 'updated': return 'Você já está usando a versão mais recente.'
    case 'available': return 'Atualização disponível. Escolha uma opção na janela do Quadra.'
    case 'ready': return 'Atualização pronta. Escolha se deseja reiniciar e instalar.'
    case 'busy': return 'Uma consulta ou download já está em andamento.'
    case 'error': return 'Não foi possível consultar atualizações agora.'
    case 'disabled': return 'Atualizações automáticas ficam disponíveis no instalador Windows.'
  }
}

function bindUpdateCheck(): void {
  const button = app.querySelector<HTMLButtonElement>('#btn-check-updates')
  const status = app.querySelector<HTMLElement>('#update-status')
  if (!button || !status) return

  button.addEventListener('click', () => {
    if (button.disabled) return
    const check = window.quadra?.checkForUpdate
    if (!check) {
      status.textContent = updateCheckMessage('disabled')
      return
    }

    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    status.textContent = 'Consultando atualizações...'
    void check()
      .then((result) => { status.textContent = updateCheckMessage(result) })
      .catch(() => { status.textContent = updateCheckMessage('error') })
      .finally(() => {
        button.disabled = false
        button.removeAttribute('aria-busy')
      })
  })
}

function renderChoose() {
  cancelAutoMode()
  clearToolbarHideTimer()
  organizerDraft = null
  organizerChoices = []
  organizerBaselineKey = ''
  organizerAspect = 0
  organizerNotice = ''
  document.body.classList.remove('is-cursor-hidden')
  window.quadra?.setCursorHidden(false)
  pendingFocusPanelId = null
  bllsportTargetId = null
  window.quadra?.setWeddbetsTarget(null)
  window.quadra?.setBllsportTarget(null)
  document.body.classList.remove('is-grid')
  setChromeInteractive(true)
  app.innerHTML = `<main class="chooser"><div class="chooser__atmosphere" aria-hidden="true"></div><div class="chooser__content">
    <div class="brand-lockup"><p class="brand">Quadra</p><span class="app-version" aria-label="Versão ${APP_VERSION}">${APP_VERSION}</span></div>
    <h1>Quantas telas?</h1><p class="lede">Escolha de 1 a ${MAX_PANELS} jogos para acompanhar ao mesmo tempo.</p>
    <div class="chooser__start"><button type="button" class="btn btn--load" id="btn-start-one">Começar com uma tela</button><button type="button" class="btn btn--load btn--bll" id="btn-start-bll-batch">Abrir vários jogos da BLL</button><button type="button" class="btn btn--load btn--youtube" id="btn-start-youtube-batch">Abrir jogos ao vivo do YouTube</button><button type="button" class="btn btn--ghost btn--auto-open" id="btn-start-auto-open" aria-pressed="${autoOpenOn}">${autoOpenOn ? 'Modo Auto: ligado' : 'Modo Auto'}</button><button type="button" class="btn btn--ghost" id="btn-check-updates" aria-describedby="update-status">Verificar atualizações</button><button type="button" class="btn btn--ghost" id="btn-first-steps">Primeiros passos</button><button type="button" class="btn btn--ghost" id="btn-release-notes">Novidades</button><span id="update-status" role="status" aria-live="polite"></span></div>
    ${alertControlsHtml('chooser')}
    <div class="chooser__options" role="group" aria-label="Número de telas">
      ${Array.from({ length: MAX_PANELS }, (_, index) => index + 1).map((count) => `<button type="button" class="chooser__card" data-count="${count}">${previewHtml(count)}<span class="chooser__count">${count}</span><span class="chooser__label">${count === 1 ? 'tela' : 'telas'}</span></button>`).join('')}
    </div>
  </div></main>`
  app.querySelector<HTMLButtonElement>('#btn-start-one')?.addEventListener('click', startWithOnePanel)
  app.querySelector<HTMLButtonElement>('#btn-start-bll-batch')?.addEventListener('click', () => openBatch('bll'))
  app.querySelector<HTMLButtonElement>('#btn-start-youtube-batch')?.addEventListener('click', () => openBatch('youtube'))
  app.querySelector<HTMLButtonElement>('#btn-start-auto-open')?.addEventListener('click', openAutoOpenDialog)
  app.querySelector<HTMLButtonElement>('#btn-first-steps')?.addEventListener('click', showFirstSteps)
  app.querySelector<HTMLButtonElement>('#btn-release-notes')?.addEventListener('click', () => showReleaseNotes(RELEASES.find((release) => release.version === version) ?? RELEASES[0]))
  bindUpdateCheck()
  bindAlertControls(app)
  app.querySelectorAll<HTMLButtonElement>('.chooser__card').forEach((button) => button.addEventListener('click', () => selectCount(Number(button.dataset.count))))
  scheduleSyncLayout()
}

function organizerPreviewHtml(choice: OrganizerChoice): string {
  const selected = new Set(choice.result.highlighted)

  return `<span class="organize-preview" style="aspect-ratio:${organizerAspect}" aria-hidden="true">
    ${choice.rects.map((rect) => {
      const number = panelIndex(rect.panelId) + 1
      const principal = selected.has(rect.panelId)

      return `<span class="organize-preview__cell${principal ? ' is-principal' : ''}" data-preview-panel="${escapeHtml(rect.panelId)}" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%"><span>${principal ? '★ ' : ''}${number}</span></span>`
    }).join('')}
  </span>`
}

function organizePanelHtml(): string {
  const draft = organizerDraft
  if (!draft) return ''

  organizerAspect = viewportAspect()
  organizerChoices = buildOrganizerChoices(panelOrder, draft, organizerAspect)

  const valid = organizerDraftValid(panelOrder, draft)
  const selectedPosition = draft.position ?? 'none'
  const selectedChoice = organizerChoices.find((choice) => choice.positions.includes(selectedPosition))
  const numbers = draft.ids.map((id) => panelIndex(id) + 1).join(', ')
  const summary = !valid
    ? `Selecione ${draft.count} telas principais.`
    : draft.count === 0
      ? 'Prévia sem destaques.'
      : `Telas principais: ${numbers}. ${selectedChoice?.label ?? ''}.`

  return `<div class="organize-panel" role="dialog" aria-labelledby="organizer-title" aria-describedby="organizer-summary">
    <div class="organize-panel__header">
      <strong id="organizer-title">Organizar telas</strong>
      <button type="button" class="btn btn--ghost btn--icon" data-organize-close aria-label="Cancelar organização">×</button>
    </div>

    <div class="organize-panel__body">
      <fieldset class="organize-panel__section">
        <legend>1. Composição</legend>
        <div class="organize-panel__compositions">
          ${getCompositions(panels.length).map((entry) => {
            const count = entry.highlightCount
            const label = count === 0 ? 'Sem destaques' : count === 1 ? '1 principal' : `${count} principais`
            return `<button type="button" class="btn btn--ghost" data-composition="${count}" aria-pressed="${count === draft.count}">${label}</button>`
          }).join('')}
        </div>
      </fieldset>

      ${draft.count > 0 ? `<fieldset class="organize-panel__section">
        <legend>2. Quais telas?</legend>
        <p class="organize-panel__hint">${draft.ids.length} de ${draft.count} selecionadas</p>
        <div class="organize-panel__map">
          ${panels.map((panel, index) => {
            const selected = draft.ids.includes(panel.id)
            return `<button type="button" class="organize-panel__slot" data-map-panel="${escapeHtml(panel.id)}" aria-pressed="${selected}" aria-label="Tela ${index + 1}${selected ? ', principal selecionada' : ''}">${selected ? '★ ' : ''}${index + 1}</button>`
          }).join('')}
        </div>
      </fieldset>` : ''}

      <fieldset class="organize-panel__section">
        <legend>${draft.count === 0 ? '2. Prévia' : '3. Onde ficam?'}</legend>
        ${valid ? `<div class="organize-panel__positions">
          ${organizerChoices.map((choice) => {
            const selected = choice.positions.includes(selectedPosition)
            const description = draft.count === 0 ? choice.label : `${choice.label}. Telas principais: ${numbers}.`
            return `<button type="button" class="organize-position" data-organizer-position="${escapeHtml(choice.key)}" data-organizer-aliases="${escapeHtml(choice.positions.join(' '))}" aria-pressed="${selected}" aria-label="${escapeHtml(description)}">${organizerPreviewHtml(choice)}<span class="organize-position__label">${escapeHtml(choice.label)}</span></button>`
          }).join('')}
        </div>` : `<p class="organize-panel__hint">Selecione ${draft.count} telas para visualizar as posições.</p>`}
      </fieldset>

      <p id="organizer-summary" class="organize-panel__hint">${escapeHtml(summary)}</p>
      <p class="organize-panel__notice" role="status" aria-live="polite">${escapeHtml(organizerNotice)}</p>
    </div>

    <div class="organize-panel__actions">
      <button type="button" class="btn btn--ghost" data-undo-organize${history.length === 0 ? ' disabled' : ''}>Desfazer</button>
      <button type="button" class="btn btn--ghost" data-organize-cancel>Cancelar</button>
      <button type="button" class="btn btn--load" data-organize-apply${valid && selectedChoice ? '' : ' disabled'}>Aplicar</button>
    </div>
  </div>`
}

function bindOrganizerControls(): void {
  const panel = app.querySelector<HTMLElement>('.organize-panel')
  if (!panel) return

  panel.querySelectorAll<HTMLButtonElement>('[data-composition]').forEach((button) => button.addEventListener('click', () => {
    chooseOrganizerComposition(Number(button.dataset.composition))
  }))
  panel.querySelectorAll<HTMLButtonElement>('[data-map-panel]').forEach((button) => button.addEventListener('click', () => {
    toggleOrganizerPanel(button.dataset.mapPanel ?? '')
  }))
  panel.querySelectorAll<HTMLButtonElement>('[data-organizer-position]').forEach((button) => button.addEventListener('click', () => {
    chooseOrganizerPosition(button.dataset.organizerPosition ?? '')
  }))
  panel.querySelector('[data-organize-close]')?.addEventListener('click', () => setEditor(false))
  panel.querySelector('[data-organize-cancel]')?.addEventListener('click', () => setEditor(false))
  panel.querySelector('[data-organize-apply]')?.addEventListener('click', applyOrganizerDraft)
  panel.querySelector('[data-undo-organize]')?.addEventListener('click', undo)
}

function updateOrganizerPanel(focusSelector?: string): void {
  if (!editorOpen || !organizerDraft) return
  const panel = app.querySelector<HTMLElement>('.organize-panel')
  if (!panel) return

  const body = panel.querySelector<HTMLElement>('.organize-panel__body')
  const scrollTop = body?.scrollTop ?? 0
  let nextFocusSelector = focusSelector
  if (!nextFocusSelector) {
    const active = document.activeElement
    if (active instanceof HTMLElement && panel.contains(active)) {
      if (active.dataset.composition) nextFocusSelector = `[data-composition="${active.dataset.composition}"]`
      else if (active.dataset.mapPanel) nextFocusSelector = `[data-map-panel="${CSS.escape(active.dataset.mapPanel)}"]`
      else if (active.dataset.organizerPosition) nextFocusSelector = `[data-organizer-position="${CSS.escape(active.dataset.organizerPosition)}"]`
    }
  }

  panel.outerHTML = organizePanelHtml()
  bindOrganizerControls()
  app.querySelector<HTMLElement>('.organize-panel__body')?.scrollTo({ top: scrollTop })
  if (nextFocusSelector) app.querySelector<HTMLElement>(nextFocusSelector)?.focus({ preventScroll: true })
}

function renderGrid() {
  cancelPanelDrag()
  clearToolbarHideTimer()
  clearBackHideTimer()
  moreMenuAbort?.abort()
  moreMenuAbort = null
  toolbarAbort?.abort()
  toolbarAbort = null
  toolbarResizeObserver?.disconnect()
  document.body.classList.add('is-grid')
  const canUndo = history.length > 0
  app.innerHTML = `<div class="grid-shell is-toolbar-visible${editorOpen ? ' is-editor-open' : ''}">
    <button type="button" class="btn btn--ghost back-corner" id="btn-layout" aria-label="Voltar à escolha de telas">← Voltar</button>
    <div class="toolbar" role="toolbar" aria-label="Controles">
      <button type="button" class="btn btn--load" id="btn-open-all">Abrir todos</button>
      <button type="button" class="btn btn--ghost" id="btn-mute-all" aria-pressed="${allPanelsMuted()}">${allPanelsMuted() ? 'Ativar som de todos' : 'Mutar todos'}</button>
      <button type="button" class="btn btn--load" id="btn-add-panel"${panels.length >= MAX_PANELS ? ' disabled' : ''} aria-label="${panels.length >= MAX_PANELS ? `Limite de ${MAX_PANELS} telas atingido` : 'Adicionar uma tela'}" title="${panels.length >= MAX_PANELS ? `Limite de ${MAX_PANELS} telas atingido` : 'Adicionar uma tela'}">+ Adicionar tela</button>
      <button type="button" class="btn btn--danger" id="btn-remove-panel"${panels.length <= MIN_PANELS ? ' disabled' : ''} aria-label="${panels.length <= MIN_PANELS ? 'É necessário manter pelo menos uma tela' : 'Remover a última tela'}" title="${panels.length <= MIN_PANELS ? 'É necessário manter pelo menos uma tela' : 'Remover a última tela'}">- Remover tela</button>
      <button type="button" class="btn btn--ghost" id="btn-organize">${editorOpen ? 'Cancelar organização' : 'Organizar'}</button>
      <label class="toolbar__count"><span>Telas <output id="panel-count-status" aria-live="polite">${panels.length}/${MAX_PANELS}</output></span><select id="panel-count" aria-label="Quantidade de telas">${Array.from({ length: MAX_PANELS }, (_, index) => `<option value="${index + 1}"${index + 1 === panels.length ? ' selected' : ''}>${index + 1}</option>`).join('')}</select></label>
      <button type="button" class="btn btn--ghost" id="btn-fullscreen">${isFullscreenActive() ? 'Minimizar' : 'Tela Cheia'}</button>
      <div class="toolbar__more"><button type="button" class="btn btn--ghost btn--icon${autoOpenOn ? ' is-auto-open' : ''}" id="btn-more" aria-label="Mais opções${autoOpenOn ? ' (modo Auto ligado)' : ''}" aria-haspopup="menu" aria-expanded="false" aria-controls="toolbar-more-menu"><svg viewBox="0 0 24 24" width="1.25rem" height="1.25rem" fill="currentColor" aria-hidden="true" focusable="false" style="display:block"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
        <div class="toolbar__menu" id="toolbar-more-menu" role="menu" hidden>
          <div class="toolbar__menu-actions">
          <button type="button" class="btn btn--ghost" id="btn-bll-batch" role="menuitem">Abrir vários jogos da BLL…</button>
          <button type="button" class="btn btn--ghost" id="btn-youtube-batch" role="menuitem">Abrir jogos ao vivo do YouTube…</button>
          <button type="button" class="btn btn--ghost" id="btn-auto-open" role="menuitem">${autoOpenOn ? 'Modo Auto: ligado…' : 'Modo Auto…'}</button>
          <button type="button" class="btn btn--ghost" id="btn-auto" role="menuitem">Organizar automaticamente</button>
          <button type="button" class="btn btn--ghost" id="btn-equal" role="menuitem">Sem destaques</button>
          <button type="button" class="btn btn--ghost" id="btn-match-labels" role="menuitem" aria-pressed="${showMatchLabels}">${showMatchLabels ? 'Ocultar nomes dos jogos' : 'Mostrar nomes dos jogos'}</button>
          <button type="button" class="btn btn--ghost" id="btn-undo" role="menuitem"${canUndo ? '' : ' disabled'}>Desfazer</button>
          <button type="button" class="btn btn--ghost" id="btn-clear-all" role="menuitem">Limpar todos</button>
          </div>
          ${alertControlsHtml('menu')}
        </div>
      </div>
    </div>
    <div class="layout-stage grid grid--${panels.length}${editorOpen ? ' is-editing' : ''}" id="layout-stage" data-layout-mode="${layoutMode}">
      ${panels.map((panel, index) => `<div class="panel${panel.url ? ' panel--loaded' : ' panel--empty'}${highlighted.has(panel.id) ? ' is-highlighted' : ''}" data-panel-id="${escapeHtml(panel.id)}" data-slot="${index}">${panelInnerHtml(panel)}</div>`).join('')}
    </div>
    ${editorOpen ? organizePanelHtml() : ''}
  </div>`

  app.querySelectorAll<HTMLElement>('.panel').forEach(bindPanelForm)
  app.querySelector<HTMLButtonElement>('#btn-open-all')?.addEventListener('click', openAllPanels)
  app.querySelector<HTMLButtonElement>('#btn-mute-all')?.addEventListener('click', toggleAllMuted)
  app.querySelector<HTMLButtonElement>('#btn-add-panel')?.addEventListener('click', addPanel)
  app.querySelector<HTMLButtonElement>('#btn-remove-panel')?.addEventListener('click', removeLastPanel)
  app.querySelector<HTMLButtonElement>('#btn-organize')?.addEventListener('click', () => setEditor(!editorOpen))
  app.querySelector<HTMLSelectElement>('#panel-count')?.addEventListener('change', (event) => setPanelCount(Number((event.target as HTMLSelectElement).value)))
  app.querySelector<HTMLButtonElement>('#btn-fullscreen')?.addEventListener('click', toggleFullscreen)
  app.querySelector<HTMLButtonElement>('#btn-layout')?.addEventListener('click', () => {
    void confirmAction('Voltar à escolha de telas?', 'Voltar').then((ok) => {
      if (!ok) return
      if (document.fullscreenElement) void document.exitFullscreen()
      if (window.quadra && nativeFullscreen) {
        nativeFullscreen = false
        window.quadra.setFullscreen(false)
      }
      view = 'choose'
      editorOpen = false
      render()
    })
  })
  bindOrganizerControls()
  bindMoreMenu()
  bindToolbar()
  renderPanelElements()
  updatePanelLabels()
  applyAlertStates(app)
  updateAutoControls()
  updateHalftimeControls()
  updateFinishedControls()
  updateLiveControls()
  focusPendingPanel()
}

function render() {
  if (view === 'choose') { clearToolbarHideTimer(); clearBackHideTimer() }
  moreMenuAbort?.abort()
  moreMenuAbort = null
  toolbarAbort?.abort()
  toolbarAbort = null
  toolbarResizeObserver?.disconnect()
  if (view === 'choose') renderChoose()
  else renderGrid()
}

window.quadra?.onRequestLayout(() => scheduleSyncLayout())
window.quadra?.onFullscreenChange((on) => {
  nativeFullscreen = on
  updateFullscreenButton()
  scheduleSyncLayout()
})
window.quadra?.onWeddbetsPlayerOpened(({ panelId, url }) => useWeddbetsPlayer(panelId, url))
window.quadra?.onBllsportPlayerOpened(({ panelId, url }) => useBllsportPlayer(panelId, url))
window.quadra?.onBllsportTargetRequired(() => {
  bllsportTargetId = null
})
window.quadra?.onPanelTitle(({ panelId, title }) => {
  if (!panelById(panelId)) return
  if (!title) {
    panelTitles.delete(panelId)
  } else {
    panelTitles.set(panelId, title)
  }
  updatePanelLabels()
})
window.quadra?.onMatchScore(({ panelId, home, away, score }) => {
  if (!panelById(panelId)) return
  const parsed = parseScore(score)
  if (!parsed) {
    panelFeeds.delete(panelId)
    panelCrests.delete(panelId)
    panelClocks.delete(panelId)
  } else {
    const feed = panelFeeds.get(panelId) ?? { home: '', away: '', timeline: createScoreTimeline() }
    feed.home = home
    feed.away = away
    pushScore(feed.timeline, Date.now(), parsed)
    panelFeeds.set(panelId, feed)
  }
  updatePanelLabels()
})
window.quadra?.onMatchClock(({ panelId, clock }) => {
  if (!panelById(panelId)) return
  const timeline = panelClocks.get(panelId) ?? createClockTimeline()
  pushClock(timeline, Date.now(), clock)
  panelClocks.set(panelId, timeline)
  updatePanelLabels()
})
window.quadra?.onMatchCrests(({ panelId, home, away }) => {
  if (!panelById(panelId)) return
  if (!home && !away) panelCrests.delete(panelId)
  else panelCrests.set(panelId, { home, away })
  updatePanelLabels()
})
onAlertSettingsChange(() => {
  updateLiveControls()
  updatePanelLabels()
})
onAlertShown((panelId, payload) => {
  if (payload.kind === 'goal' || payload.kind === 'touchdown') startAutoGoal(panelId)
})
onVarReviewStarted((panelId) => startAutoGoal(panelId, 'var'))
window.quadra?.onMatchEvent((payload) => {
  if (view !== 'grid' || panelById(payload.panelId)?.alertsOff) return
  // 365Scores-linked panels trail the data: hold the alert as long as the panel's score is held.
  const delay = panelAlertDelayMs(payload.panelId)
  if (delay <= 0) {
    deliverMatchEvent(payload)
    return
  }
  const timers = pendingAlerts.get(payload.panelId) ?? new Set<number>()
  const timer = window.setTimeout(() => {
    timers.delete(timer)
    deliverMatchEvent(payload)
  }, delay)
  timers.add(timer)
  pendingAlerts.set(payload.panelId, timers)
})
window.quadra?.onMatchScorer((payload) => {
  if (view !== 'grid') return
  handleScorerName(payload.panelId, payload.eventId, payload.player, app)
})
window.quadra?.onLiveVar((payload) => {
  if (!panelById(payload.panelId)) return
  // Held as long as the panel's alerts, so the badge and the highlight show with the video, not before.
  const delay = panelAlertDelayMs(payload.panelId)
  if (delay <= 0) {
    deliverLiveVar(payload)
    return
  }
  const timers = pendingAlerts.get(payload.panelId) ?? new Set<number>()
  const timer = window.setTimeout(() => {
    timers.delete(timer)
    deliverLiveVar(payload)
  }, delay)
  timers.add(timer)
  pendingAlerts.set(payload.panelId, timers)
})
window.quadra?.onMatchEnded(({ panelId }) => onMatchEnded(panelId))
window.quadra?.onUiDialog(showUiDialog)
window.quadra?.onLiveMatch((status) => {
  if (!panelById(status.panelId)) return
  if (status.status === 'off') {
    panelLive.delete(status.panelId)
    panelDelayOverride.delete(status.panelId)
    clearPendingAlerts(status.panelId)
    deliverLiveVar({ panelId: status.panelId, review: null })
  } else {
    panelLive.set(status.panelId, status)
  }
  updateLiveControls()
  updatePanelLabels()
})
window.quadra?.onMatchInfoReady(({ panelId, ready }) => {
  if (ready && panelById(panelId)) matchInfoReady.add(panelId)
  else {
    matchInfoReady.delete(panelId)
    infoDrawer.forget(panelId)
  }
  updateLiveControls()
})
window.quadra?.onPanelVideoRect(({ panelId, rect }) => {
  if (!panelById(panelId)) return
  panelVideoRects.set(panelId, rect)
  updatePanelLabels()
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented) return
  if (!editorOpen) return
  if (document.querySelector('.confirm')) return

  event.preventDefault()
  setEditor(false)
})
window.addEventListener('resize', () => {
  if (view !== 'grid') {
    scheduleSyncLayout()
    return
  }
  if (layoutResizeFrame !== null) return
  layoutResizeFrame = requestAnimationFrame(() => {
    layoutResizeFrame = null
    const organizerUnchanged = organizerDraft !== null &&
      organizerDraftKey(organizerDraft, panels.length) === organizerBaselineKey

    buildCurrentLayout(layoutMode, true)
    renderPanelElements()

    if (editorOpen) {
      if (organizerUnchanged) resetOrganizerDraft()
      updateOrganizerPanel()
    }
  })
}, { passive: true })
document.addEventListener('fullscreenchange', updateFullscreenButton)
document.addEventListener('scroll', scheduleSyncLayout, { capture: true, passive: true })

render()
window.quadra?.ready()
showReleaseNotesIfNew()
