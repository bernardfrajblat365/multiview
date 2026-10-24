import './style.css'
import { version } from '../package.json'
import { normalizeUrl } from './routing'
import { batchCapacity, groupByCompetition, planBatchOpen, type BllEvent, type BllEventGroup } from './bll-batch'
import {
  DEFAULT_YOUTUBE_CHANNELS,
  loadYoutubeChannels,
  MAX_YOUTUBE_CHANNELS,
  saveYoutubeChannels,
  type YoutubeChannel,
  type YoutubeChannelResult,
  type YoutubeLivesResult,
} from './youtube-lives'
import { alertControlsHtml, applyAlertStates, bindAlertControls, clearAlert, getAlertSettings, handleMatchEvent, onAlertSettingsChange, onAlertShown, type MatchEventPayload } from './alert-ui'
import { LIVE_DELAY_OPTIONS } from './alert-settings'
import { RELEASES, markVersionSeen, readLastSeenVersion, releaseToShow, type Release } from './release-notes'
import type { LiveMatchStatus } from './livescore-365'
import { AUTO_MIN_PANELS, composeHighlighted, expireAutos, registerGoal, secondsLeft, type AutoEntry } from './auto-highlight'
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
  splitMatchTeams,
  type MatchScore,
  type NormRect,
} from './match-label'
import { createScoreTimeline, nextScoreChangeAt, pushScore, visibleScore, type ScoreTimeline } from './score-delay'
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
/** Panels promoted to highlights by a goal; they return to the user's layout after 45 s. */
type AutoBaseline = { highlighted: PanelId[]; mode: LayoutMode; position: HighlightPosition | undefined; variant: string | undefined }
let autoEntries: AutoEntry[] = []
let autoBaseline: AutoBaseline | null = null
let autoTimer: number | null = null
const panelTitles = new Map<PanelId, string>()
const panelVideoRects = new Map<PanelId, NormRect | null>()
/** Per-panel dismiss; restored when the user opens/reloads the panel URL. */
const dismissedMatchLabels = new Set<PanelId>()
/** Teams and score history from the William Hill feed, per panel. */
const panelFeeds = new Map<PanelId, { home: string; away: string; timeline: ScoreTimeline }>()
/** Last score shown per panel, to flash the label when it changes. */
const shownScores = new Map<PanelId, string>()
const scoreFlashUntil = new Map<PanelId, number>()
const SCORE_FLASH_MS = 6000
let labelRefreshTimer: number | null = null
/** 365Scores link of each YouTube panel (and BLL panel without a William Hill feed), as reported by the main process. */
const panelLive = new Map<PanelId, LiveMatchStatus>()
/** Per-panel delay (s) chosen on a 365Scores-linked panel; memory only, like the rest of the panel state. */
const panelDelayOverride = new Map<PanelId, number>()
/** Alerts of 365Scores-linked panels waiting for the video to catch up with the data. */
const pendingAlerts = new Map<PanelId, Set<number>>()

function clearPendingAlerts(id: PanelId) {
  for (const timer of pendingAlerts.get(id) ?? []) window.clearTimeout(timer)
  pendingAlerts.delete(id)
}

function clearPanelMatchState(id: PanelId) {
  panelLive.delete(id)
  panelDelayOverride.delete(id)
  clearPendingAlerts(id)
  panelTitles.delete(id)
  panelVideoRects.delete(id)
  dismissedMatchLabels.delete(id)
  panelFeeds.delete(id)
  shownScores.delete(id)
  scoreFlashUntil.delete(id)
}

function clearAllPanelMatchState() {
  for (const id of [...pendingAlerts.keys()]) clearPendingAlerts(id)
  panelLive.clear()
  panelDelayOverride.clear()
  panelTitles.clear()
  panelVideoRects.clear()
  dismissedMatchLabels.clear()
  panelFeeds.clear()
  shownScores.clear()
  scoreFlashUntil.clear()
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
  for (const until of scoreFlashUntil.values()) consider(until)
  if (next === null) return
  labelRefreshTimer = window.setTimeout(() => {
    labelRefreshTimer = null
    updatePanelLabels()
  }, Math.max(0, next - now) + 30)
}

function panelMatch(id: PanelId, now: number): { home: string; away: string; score: MatchScore | null } | null {
  const feed = panelFeeds.get(id)
  const titleLabel = extractMatchLabel(panelTitles.get(id) ?? '')
  const titleTeams = titleLabel ? splitMatchTeams(titleLabel) : null
  const feedTeams = feed?.home && feed.away ? { home: feed.home, away: feed.away } : null
  const teams = titleTeams ?? feedTeams
  if (!teams) return null
  const delay = panelScoreDelayMs(id)
  let score = feed && delay !== null ? visibleScore(feed.timeline, now, delay) : null
  if (score && titleTeams && feedTeams) score = orientScore(titleTeams, feedTeams, score)
  return { ...teams, score }
}

function labelSpan(className: string, text: string) {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
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
    if (scoreText && previousScore && previousScore !== scoreText) scoreFlashUntil.set(id, now + SCORE_FLASH_MS)
    if (scoreText) shownScores.set(id, scoreText)
    const flashUntil = scoreFlashUntil.get(id) ?? 0
    if (flashUntil && flashUntil <= now) scoreFlashUntil.delete(id)
    const flashing = flashUntil > now

    const placement = placeMatchLabel({
      panelWidth: panelElement.clientWidth || 1,
      panelHeight: panelElement.clientHeight || 1,
      videoRect: panelVideoRects.has(id) ? panelVideoRects.get(id) ?? null : null,
      home: match.home,
      away: match.away,
      score: match.score,
    })
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
    labelElement.setAttribute('aria-label', scoreText ? `${match.home} ${scoreText} ${match.away}` : label)
    labelElement.style.setProperty('--label-x', `${placement.box.x * 100}%`)
    labelElement.style.setProperty('--label-y', `${placement.box.y * 100}%`)
    labelElement.style.setProperty('--label-w', `${placement.box.width * 100}%`)
    labelElement.style.setProperty('--label-h', `${placement.box.height * 100}%`)
    labelElement.style.setProperty('--label-font', `${placement.fontPx}px`)

    // Rebuild the content only when it changes, so the flash animation is not restarted by every poll.
    const contentKey = [placement.mode, placement.layout, match.home, match.away, scoreText].join('|')
    if (labelElement.dataset.contentKey === contentKey) continue
    labelElement.dataset.contentKey = contentKey
    const dismiss = ensureMatchLabelDismiss(labelElement, id)
    const chip = document.createElement('div')
    chip.className = 'panel__label-chip'
    chip.setAttribute('aria-hidden', 'true')
    if (placement.layout === 'inline') {
      chip.append(
        labelSpan('panel__label-team', match.home),
        labelSpan(match.score ? 'panel__label-score' : 'panel__label-vs', match.score ? scoreText : 'x'),
        labelSpan('panel__label-team', match.away),
      )
    } else {
      for (const [team, goals] of [[match.home, match.score?.home], [match.away, match.score?.away]] as const) {
        const row = document.createElement('div')
        row.className = 'panel__label-row'
        row.append(labelSpan('panel__label-team', team))
        if (goals !== undefined) row.append(labelSpan('panel__label-goals', String(goals)))
        chip.append(row)
      }
    }
    chip.append(dismiss)
    labelElement.replaceChildren(chip)
  }
  scheduleLabelRefresh(now)
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
  captureDrafts()
  history = [...history.slice(-(HISTORY_LIMIT - 1)), cloneSnapshot()]
}

function restoreSnapshot(snapshot: LayoutSnapshot) {
  cancelAutoMode()
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
    let controls = panelElement.querySelector<HTMLElement>(':scope > .panel__auto-controls')
    if (!entry) {
      controls?.remove()
      continue
    }
    if (!controls) {
      controls = document.createElement('div')
      controls.className = 'panel__auto-controls'
      controls.innerHTML = '<span class="panel__auto-count" data-auto-count></span><button type="button" class="btn btn--load" data-auto-pin title="Manter este jogo em destaque">📌 Fixar</button><button type="button" class="btn btn--ghost" data-auto-back title="Voltar ao layout anterior agora">↩ Voltar</button>'
      panelElement.append(controls)
    }
    const count = controls.querySelector<HTMLElement>('[data-auto-count]')
    const text = `Gol! ${secondsLeft(entry, now)} s`
    if (count && count.textContent !== text) count.textContent = text
  }
}

function tickAuto() {
  const { autos, changed } = expireAutos(autoEntries, Date.now())
  autoEntries = autos
  if (changed) applyAutoLayout()
  else updateAutoControls()
}

function startAutoGoal(panelId: PanelId) {
  if (view !== 'grid' || panels.length < AUTO_MIN_PANELS || !getAlertSettings().autoHighlight) return
  if (!autoBaseline) {
    autoBaseline = { highlighted: [...highlighted], mode: layoutMode, position: highlightPosition, variant: compositionVariant }
  }
  const result = registerGoal(autoEntries, panelId, Date.now(), panels.length, autoBaseline.highlighted, panels.map((panel) => panel.id))
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
  const key = `${live.label}|${live.coverage}|${own ?? 'default'}|${globalSec}`
  if (button?.dataset.key === key) return
  if (!button) {
    button = document.createElement('label')
    button.className = 'btn btn--ghost panel__delay'
    controls.insertBefore(button, controls.querySelector(':scope > .panel__alerts') ?? controls.querySelector(':scope > .panel__remove'))
  }
  button.dataset.key = key
  const effective = own ?? globalSec ?? 0
  const defaultLabel = globalSec === null ? 'Padrão (placar oculto, alertas na hora)' : `Padrão (${liveDelayLabel(globalSec)})`
  const coverage = live.coverage === 'score' ? ' · só placar' : ''
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

/** Shows an alert now; a goal the VAR cancelled also undoes that panel's goal highlight. */
function deliverMatchEvent(payload: MatchEventPayload) {
  if (view !== 'grid' || panelById(payload.panelId)?.alertsOff) return
  if (payload.kind === 'var' && payload.note === 'gol anulado') releaseAutoPanel(payload.panelId)
  handleMatchEvent(payload, app, (panelId) => Boolean(panelById(panelId)))
}

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const panelId = target.closest<HTMLElement>('.panel')?.dataset.panelId
  if (!panelId) return
  if (target.closest('[data-auto-pin]')) pinAutoPanel(panelId)
  else if (target.closest('[data-auto-back]')) releaseAutoPanel(panelId)
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
    for (const id of removed) clearPanelMatchState(id)
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
  if (panel.url !== next) clearPanelMatchState(id)
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

function applyBatch(urls: string[], source: BatchSource) {
  if (view !== 'grid') return
  const plan = planBatchOpen(panels, urls, MAX_PANELS)
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

function batchListHtml(groups: BllEventGroup<BatchEvent>[], fromChooser: boolean) {
  const open = new Set(fromChooser ? [] : panels.map((panel) => panel.url).filter(Boolean))
  return groups.map((group, groupIndex) => `<fieldset class="bll-batch__group">
    <legend><label><input type="checkbox" data-group="${groupIndex}"> ${escapeHtml(group.competition)} <span class="bll-batch__count">(${group.events.length})</span></label></legend>
    ${group.events.map((event) => {
      const isOpen = open.has(event.url)
      return `<label class="bll-batch__item${isOpen ? ' is-open' : ''}"><input type="checkbox" data-url="${escapeHtml(event.url)}" data-group-item="${groupIndex}"${isOpen ? ' checked disabled' : ''}>
        ${event.time ? `<span class="bll-batch__time">${escapeHtml(event.time)}</span> ` : ''}<span>${escapeHtml(event.name)}</span>${event.channel && event.channel !== group.competition ? ` <small class="bll-batch__channel">${escapeHtml(event.channel)}</small>` : ''}${isOpen ? ' <small>já aberto</small>' : ''}</label>`
    }).join('')}
  </fieldset>`).join('')
}

const YOUTUBE_ERRORS: Record<Exclude<YoutubeLivesResult['status'], 'ok'>, string> = {
  'no-key': 'Falta a chave da YouTube Data API. Coloque QUADRA_YOUTUBE_API_KEY=... no arquivo .env e clique em Atualizar lista.',
  'invalid-key': 'A chave da YouTube Data API foi recusada. Confira QUADRA_YOUTUBE_API_KEY no .env e as restrições da chave no Google Cloud.',
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

function openBatch(source: BatchSource) {
  const config = BATCH_SOURCES[source]
  const fromChooser = view === 'choose'
  document.querySelector('.confirm')?.remove()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm bll-batch'
  backdrop.innerHTML = `<div class="confirm__dialog bll-batch__dialog" role="dialog" aria-modal="true" aria-labelledby="bll-batch-title">
    <p id="bll-batch-title" class="confirm__message">${config.title}</p>
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
    list.innerHTML = batchListHtml(groupByCompetition(result.events), fromChooser)
    updateSelection()
  }
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
    else applyBatch(urls, source)
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

function openAllPanels() {
  panels = panels.map((panel) => {
    const input = app.querySelector<HTMLInputElement>(`[data-panel-id="${CSS.escape(panel.id)}"] input[name="url"]`)
    const url = input ? normalizeUrl(input.value) : panel.url
    if (panel.url !== url) clearPanelMatchState(panel.id)
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
    releaseAutoPanel(id)
  }
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
    document.querySelector('.confirm')?.remove()
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

function showReleaseNotes(release: Release) {
  document.querySelector('.confirm')?.remove()
  const backdrop = document.createElement('div')
  backdrop.className = 'confirm release-notes'
  backdrop.innerHTML = `<div class="confirm__dialog release-notes__dialog" role="dialog" aria-modal="true" aria-labelledby="release-notes-title">
    <p class="release-notes__eyebrow">Quadra atualizado</p>
    <h2 id="release-notes-title" class="confirm__message">Novidades da versão ${escapeHtml(release.label)}</h2>
    <ul class="release-notes__list">${release.notes.map((note) => `<li><strong>${escapeHtml(note.title)}</strong><p>${escapeHtml(note.body)}</p></li>`).join('')}</ul>
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

/** Once per installed version, after an update (or a first install). `?release-notes=off|on` overrides for smokes. */
function showReleaseNotesIfNew() {
  const override = new URLSearchParams(location.search).get('release-notes')
  if (window.quadra ? override === 'off' : override !== 'on') return
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

function syncLayout() {
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

function updateChromeHitTarget(x: number, y: number) {
  if (dragState) return
  if (view !== 'grid') {
    setChromeInteractive(true)
    return
  }
  const target = document.elementFromPoint(x, y)
  setChromeInteractive(Boolean(target?.closest('.toolbar, .back-corner, .panel__controls, .panel__auto-controls, .panel__overlay, .panel__live, .panel__label-dismiss, .panel--empty, .organize-panel, .confirm')))
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
    <div class="chooser__start"><button type="button" class="btn btn--load" id="btn-start-one">Começar com uma tela</button><button type="button" class="btn btn--load btn--bll" id="btn-start-bll-batch">Abrir vários jogos da BLL</button><button type="button" class="btn btn--load btn--youtube" id="btn-start-youtube-batch">Abrir jogos ao vivo do YouTube</button><button type="button" class="btn btn--ghost" id="btn-check-updates" aria-describedby="update-status">Verificar atualizações</button><button type="button" class="btn btn--ghost" id="btn-release-notes">Novidades</button><span id="update-status" role="status" aria-live="polite"></span></div>
    ${alertControlsHtml('chooser')}
    <div class="chooser__options" role="group" aria-label="Número de telas">
      ${Array.from({ length: MAX_PANELS }, (_, index) => index + 1).map((count) => `<button type="button" class="chooser__card" data-count="${count}">${previewHtml(count)}<span class="chooser__count">${count}</span><span class="chooser__label">${count === 1 ? 'tela' : 'telas'}</span></button>`).join('')}
    </div>
  </div></main>`
  app.querySelector<HTMLButtonElement>('#btn-start-one')?.addEventListener('click', startWithOnePanel)
  app.querySelector<HTMLButtonElement>('#btn-start-bll-batch')?.addEventListener('click', () => openBatch('bll'))
  app.querySelector<HTMLButtonElement>('#btn-start-youtube-batch')?.addEventListener('click', () => openBatch('youtube'))
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
      <div class="toolbar__more"><button type="button" class="btn btn--ghost btn--icon" id="btn-more" aria-label="Mais opções" aria-haspopup="menu" aria-expanded="false" aria-controls="toolbar-more-menu"><svg viewBox="0 0 24 24" width="1.25rem" height="1.25rem" fill="currentColor" aria-hidden="true" focusable="false" style="display:block"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
        <div class="toolbar__menu" id="toolbar-more-menu" role="menu" hidden>
          <button type="button" class="btn btn--ghost" id="btn-bll-batch" role="menuitem">Abrir vários jogos da BLL…</button>
          <button type="button" class="btn btn--ghost" id="btn-youtube-batch" role="menuitem">Abrir jogos ao vivo do YouTube…</button>
          <button type="button" class="btn btn--ghost" id="btn-auto" role="menuitem">Organizar automaticamente</button>
          <button type="button" class="btn btn--ghost" id="btn-equal" role="menuitem">Sem destaques</button>
          <button type="button" class="btn btn--ghost" id="btn-match-labels" role="menuitem" aria-pressed="${showMatchLabels}">${showMatchLabels ? 'Ocultar nomes dos jogos' : 'Mostrar nomes dos jogos'}</button>
          <button type="button" class="btn btn--ghost" id="btn-undo" role="menuitem"${canUndo ? '' : ' disabled'}>Desfazer</button>
          <button type="button" class="btn btn--ghost" id="btn-clear-all" role="menuitem">Limpar todos</button>
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
  } else {
    const feed = panelFeeds.get(panelId) ?? { home: '', away: '', timeline: createScoreTimeline() }
    feed.home = home
    feed.away = away
    pushScore(feed.timeline, Date.now(), parsed)
    panelFeeds.set(panelId, feed)
  }
  updatePanelLabels()
})
onAlertSettingsChange(() => {
  updateLiveControls()
  updatePanelLabels()
})
onAlertShown((panelId, payload) => {
  if (payload.kind === 'goal') startAutoGoal(panelId)
})
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
window.quadra?.onLiveMatch((status) => {
  if (!panelById(status.panelId)) return
  if (status.status === 'off') {
    panelLive.delete(status.panelId)
    panelDelayOverride.delete(status.panelId)
    clearPendingAlerts(status.panelId)
  } else {
    panelLive.set(status.panelId, status)
  }
  updateLiveControls()
  updatePanelLabels()
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
