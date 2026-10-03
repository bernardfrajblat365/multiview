import './style.css'
import { version } from '../package.json'
import { normalizeUrl } from './routing'
import {
  buildLayoutTree,
  calculateLayout,
  defaultHighlightCount,
  getCompositions,
  resolveComposition,
  type HighlightPosition,
  type LayoutMode,
  type LayoutNode,
  type PanelId,
} from './layout'
import {
  buildOrganizerChoices,
  organizerDraftKey,
  organizerDraftValid,
  type OrganizerChoice,
  type OrganizerDraft,
} from './organizer'

type View = 'choose' | 'grid'
type Panel = { id: PanelId; url: string; draftUrl: string; muted: boolean }
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
const MAX_PANELS = 16
const HISTORY_LIMIT = 24
const TOOLBAR_IDLE_MS = 10_000
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
let weddbetsTargetId: PanelId | null = null
let bllsportTargetId: PanelId | null = null

function createPanel(): Panel {
  return { id: `panel-${panelSerial++}`, url: '', draftUrl: '', muted: allPanelsMuted() }
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
  captureDrafts()
  history = [...history.slice(-(HISTORY_LIMIT - 1)), cloneSnapshot()]
}

function restoreSnapshot(snapshot: LayoutSnapshot) {
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
  panel.url = next
  panel.draftUrl = next
  renderGrid()
}

function panelLabel(id: PanelId) {
  return `Jogo ${panelIndex(id) + 1}`
}

function openWeddbets(id: PanelId) {
  if (!panelById(id)) return
  weddbetsTargetId = id
  window.quadra?.openWeddbets(id, panelLabel(id))
}

function openBllsport(id: PanelId) {
  if (!panelById(id)) return
  bllsportTargetId = id
  window.quadra?.openBllsport(id, panelLabel(id))
}

function useSportsCatalogPlayer(
  panelId: PanelId,
  url: string,
  setTargetId: (id: PanelId | null) => void,
  syncTarget: (id: PanelId | null, label?: string) => void,
) {
  const panel = panelById(panelId)
  if (!panel || view !== 'grid') return
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
    (id) => { weddbetsTargetId = id },
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

function openAllPanels() {
  panels = panels.map((panel) => {
    const input = app.querySelector<HTMLInputElement>(`[data-panel-id="${CSS.escape(panel.id)}"] input[name="url"]`)
    const url = input ? normalizeUrl(input.value) : panel.url
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

function toggleAllMuted() {
  const muted = !allPanelsMuted()
  for (const panel of panels) panel.muted = muted
  updateAudioControls()
}

function clearAllPanels() {
  pushHistory()
  panels = panels.map((panel) => ({ ...panel, url: '', draftUrl: '' }))
  renderGrid()
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
      <button type="button" class="btn btn--weddbets${weddbetsTargetId === panel.id ? ' is-target' : ''}" data-weddbets aria-pressed="${weddbetsTargetId === panel.id}" aria-label="Escolher jogo no WeddBets para o jogo ${index + 1}" title="Abrir WeddBets para este painel">WeddBets</button>
      <button type="button" class="btn btn--bllsport${bllsportTargetId === panel.id ? ' is-target' : ''}" data-bllsport aria-pressed="${bllsportTargetId === panel.id}" aria-label="Escolher jogo no BLL para o jogo ${index + 1}" title="Abrir BLL para este painel">BLL</button>
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
      <button type="button" class="btn btn--ghost panel__mute" data-mute aria-pressed="${panel.muted}" aria-label="${panel.muted ? 'Ativar som do' : 'Mutar'} jogo ${panelIndex(panel.id) + 1}" title="${panel.muted ? 'Ativar som do' : 'Mutar'} jogo ${panelIndex(panel.id) + 1}">${panel.muted ? 'Ativar som' : 'Mutar'}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-highlight aria-pressed="${isHighlighted}" aria-label="${isHighlighted ? 'Remover destaque' : 'Destacar jogo'}" title="${isHighlighted ? 'Remover destaque' : 'Destacar jogo'}">${isHighlighted ? '★' : '☆'}</button>
      ${panel.url ? '<button type="button" class="btn btn--ghost btn--icon" data-edit aria-label="Editar URL" title="Editar URL">✎</button>' : ''}
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
  panelElement.querySelector('[data-remove]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    removePanel(id)
  })
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

function setChromeInteractive(interactive: boolean) {
  if (lastChromeInteractive === interactive) return
  lastChromeInteractive = interactive
  window.quadra?.setChromeInteractive(interactive)
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
    return [{
      id: panel.id,
      url: panel.url,
      muted: panel.muted,
      editing: panelElement.classList.contains('is-editing'),
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
  })
}

function updateChromeHitTarget(x: number, y: number) {
  if (view !== 'grid') {
    setChromeInteractive(true)
    return
  }
  const target = document.elementFromPoint(x, y)
  setChromeInteractive(Boolean(target?.closest('.toolbar, .panel__controls, .panel__overlay, .panel--empty, .organize-panel, .confirm')))
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
    updateChromeHitTarget(event.clientX, event.clientY)
  }, { signal, passive: true })
  document.addEventListener('pointerdown', revealToolbar, { signal, passive: true })
  document.addEventListener('keydown', revealToolbar, { signal, passive: true })
  toolbar.addEventListener('pointerenter', () => setChromeInteractive(true), { signal })
  toolbar.addEventListener('focusin', () => setChromeInteractive(true), { signal })
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
  app.querySelector('#btn-equal')?.addEventListener('click', () => { makeEqual(); setOpen(false) }, { signal })
  app.querySelector('#btn-auto')?.addEventListener('click', () => { organizeAutomatically(); setOpen(false) }, { signal })
  app.querySelector('#btn-undo')?.addEventListener('click', () => { undo(); setOpen(false) }, { signal })
  app.querySelector('#btn-clear-all')?.addEventListener('click', () => { clearAllPanels(); setOpen(false) }, { signal })
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
  clearToolbarHideTimer()
  organizerDraft = null
  organizerChoices = []
  organizerBaselineKey = ''
  organizerAspect = 0
  organizerNotice = ''
  document.body.classList.remove('is-cursor-hidden')
  window.quadra?.setCursorHidden(false)
  pendingFocusPanelId = null
  weddbetsTargetId = null
  bllsportTargetId = null
  window.quadra?.setWeddbetsTarget(null)
  window.quadra?.setBllsportTarget(null)
  document.body.classList.remove('is-grid')
  setChromeInteractive(true)
  app.innerHTML = `<main class="chooser"><div class="chooser__atmosphere" aria-hidden="true"></div><div class="chooser__content">
    <div class="brand-lockup"><p class="brand">Quadra</p><span class="app-version" aria-label="Versão ${APP_VERSION}">${APP_VERSION}</span></div>
    <h1>Quantas telas?</h1><p class="lede">Escolha de 1 a 16 jogos para acompanhar ao mesmo tempo.</p>
    <div class="chooser__start"><button type="button" class="btn btn--load" id="btn-start-one">Começar com uma tela</button><span>Adicione outras telas quando quiser.</span><button type="button" class="btn btn--ghost" id="btn-check-updates" aria-describedby="update-status">Verificar atualizações</button><span id="update-status" role="status" aria-live="polite"></span></div>
    <div class="chooser__options" role="group" aria-label="Número de telas">
      ${Array.from({ length: MAX_PANELS }, (_, index) => index + 1).map((count) => `<button type="button" class="chooser__card" data-count="${count}">${previewHtml(count)}<span class="chooser__count">${count}</span><span class="chooser__label">${count === 1 ? 'tela' : 'telas'}</span></button>`).join('')}
    </div>
  </div></main>`
  app.querySelector<HTMLButtonElement>('#btn-start-one')?.addEventListener('click', startWithOnePanel)
  bindUpdateCheck()
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
  clearToolbarHideTimer()
  moreMenuAbort?.abort()
  moreMenuAbort = null
  toolbarAbort?.abort()
  toolbarAbort = null
  toolbarResizeObserver?.disconnect()
  document.body.classList.add('is-grid')
  const canUndo = history.length > 0
  app.innerHTML = `<div class="grid-shell is-toolbar-visible${editorOpen ? ' is-editor-open' : ''}">
    <div class="toolbar" role="toolbar" aria-label="Controles">
      <button type="button" class="btn btn--load" id="btn-open-all">Abrir todos</button>
      <button type="button" class="btn btn--ghost" id="btn-mute-all" aria-pressed="${allPanelsMuted()}">${allPanelsMuted() ? 'Ativar som de todos' : 'Mutar todos'}</button>
      <button type="button" class="btn btn--load" id="btn-add-panel"${panels.length >= MAX_PANELS ? ' disabled' : ''} aria-label="${panels.length >= MAX_PANELS ? 'Limite de 16 telas atingido' : 'Adicionar uma tela'}" title="${panels.length >= MAX_PANELS ? 'Limite de 16 telas atingido' : 'Adicionar uma tela'}">+ Adicionar tela</button>
      <button type="button" class="btn btn--danger" id="btn-remove-panel"${panels.length <= MIN_PANELS ? ' disabled' : ''} aria-label="${panels.length <= MIN_PANELS ? 'É necessário manter pelo menos uma tela' : 'Remover a última tela'}" title="${panels.length <= MIN_PANELS ? 'É necessário manter pelo menos uma tela' : 'Remover a última tela'}">- Remover tela</button>
      <button type="button" class="btn btn--ghost" id="btn-organize">${editorOpen ? 'Cancelar organização' : 'Organizar'}</button>
      <button type="button" class="btn btn--ghost" id="btn-layout">Voltar</button>
      <label class="toolbar__count"><span>Telas <output id="panel-count-status" aria-live="polite">${panels.length}/${MAX_PANELS}</output></span><select id="panel-count" aria-label="Quantidade de telas">${Array.from({ length: MAX_PANELS }, (_, index) => `<option value="${index + 1}"${index + 1 === panels.length ? ' selected' : ''}>${index + 1}</option>`).join('')}</select></label>
      <button type="button" class="btn btn--ghost" id="btn-fullscreen">${isFullscreenActive() ? 'Minimizar' : 'Tela Cheia'}</button>
      <div class="toolbar__more"><button type="button" class="btn btn--ghost btn--icon" id="btn-more" aria-label="Mais opções" aria-haspopup="menu" aria-expanded="false" aria-controls="toolbar-more-menu">⋯</button>
        <div class="toolbar__menu" id="toolbar-more-menu" role="menu" hidden>
          <button type="button" class="btn btn--ghost" id="btn-auto" role="menuitem">Organizar automaticamente</button>
          <button type="button" class="btn btn--ghost" id="btn-equal" role="menuitem">Sem destaques</button>
          <button type="button" class="btn btn--ghost" id="btn-undo" role="menuitem"${canUndo ? '' : ' disabled'}>Desfazer</button>
          <button type="button" class="btn btn--ghost" id="btn-clear-all" role="menuitem">Limpar todos</button>
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
  focusPendingPanel()
}

function render() {
  if (view === 'choose') clearToolbarHideTimer()
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
window.quadra?.onWeddbetsTargetRequired(() => {
  weddbetsTargetId = null
})
window.quadra?.onBllsportPlayerOpened(({ panelId, url }) => useBllsportPlayer(panelId, url))
window.quadra?.onBllsportTargetRequired(() => {
  bllsportTargetId = null
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
