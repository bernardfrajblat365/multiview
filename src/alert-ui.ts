import { ALERT_SOUNDS, ALERT_SOUND_IDS, getAlertSound, playAlertSound } from './alert-sounds'
import { AUTO_HIGHLIGHT_OPTIONS, CLOSE_FINISHED_OPTIONS, SCORE_DELAY_OPTIONS, loadAlertSettings, saveAlertSettings, type AlertSettings } from './alert-settings'
import { ALERT_KINDS, formatPlayerName, type AlertKind } from './match-events'
import type { LiveVarPayload, VarReviewKind } from './livescore-365'

export type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; team?: 'home' | 'away' | 'match'; note?: string; label: string; eventId?: string; player?: string }

const GOAL_HOLD_MS = 45_000
const OTHER_HOLD_MS = 12_000
const KIND_ICON: Record<AlertKind, string> = { goal: '⚽', penalty: '🎯', red: '🟥', yellow: '🟨', var: '📺', touchdown: '🏈', 'field-goal': '🥅' }
const KIND_NAME: Record<AlertKind, string> = { goal: 'Gol', penalty: 'Pênalti', red: 'Cartão vermelho', yellow: 'Cartão amarelo', var: 'VAR', touchdown: 'Touchdown', 'field-goal': 'Field goal' }
// Checkbox labels: the 🟥/🟨 icon already says it's a card, so the seven kinds fit in one row.
const KIND_SHORT: Record<AlertKind, string> = { ...KIND_NAME, red: 'Vermelho', yellow: 'Amarelo' }

export type VarReviewState = NonNullable<LiveVarPayload['review']>
const VAR_REVIEW_ICON: Record<VarReviewKind, string> = { goal: '⚽', penalty: '🎯', red: '🟥', other: '📺' }
const VAR_REVIEW_NAME: Record<VarReviewKind, string> = { goal: 'gol', penalty: 'pênalti', red: 'cartão vermelho', other: 'lance' }

type ActiveAlert = {
  kind: AlertKind
  text: string
  scorer: 'home' | 'away' | null
  /** Id of the feed incident, to match a scorer name that arrives later. */
  eventId: string
  /** Who scored, once known: filled in when the name arrives; it never extends the alert. */
  player: string
  timer: ReturnType<typeof setTimeout>
}

let settings: AlertSettings = loadAlertSettings(ALERT_SOUND_IDS)
const active = new Map<string, ActiveAlert>()
/** VAR reviews in progress per panel: shown until the 365Scores feed drops them. */
const varReviews = new Map<string, VarReviewState>()
const listeners = new Set<(panelId: string, payload: MatchEventPayload) => void>()
/** Scorer names that arrived, by incident id: an alert held back by the panel delay picks its name up when it shows. */
const scorerNames = new Map<string, string>()
const MAX_SCORER_NAMES = 200
const settingsListeners = new Set<(settings: AlertSettings) => void>()

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function getAlertSettings() {
  return settings
}

/** Lets the layout code react to alerts (e.g. auto-highlighting a goal). */
export function onAlertShown(listener: (panelId: string, payload: MatchEventPayload) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Lets the panel labels react when the score delay changes. */
export function onAlertSettingsChange(listener: (settings: AlertSettings) => void) {
  settingsListeners.add(listener)
  return () => settingsListeners.delete(listener)
}

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  const rest = seconds % 60
  return rest ? `${Math.floor(seconds / 60)} min ${rest} s` : `${seconds / 60} min`
}

function scoreDelayLabel(value: number | null) {
  if (value === null) return 'Não mostrar'
  return value === 0 ? 'Na hora' : `${value} s depois`
}

function closeFinishedLabel(value: number | null) {
  if (value === null) return 'Não fechar'
  return value === 0 ? 'Na hora' : `${durationLabel(value)} depois`
}

function soundPickerHtml(idPrefix: string, kind: AlertKind) {
  const selected = settings.sounds[kind]
  const name = `Som do alerta de ${KIND_NAME[kind]}`
  return `<div class="sound-picker" data-sound-picker="${kind}">
      <button type="button" class="btn btn--ghost sound-picker__button" id="${idPrefix}-sound-${kind}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${idPrefix}-sound-${kind}-list" aria-label="${name}: ${escapeText(getAlertSound(selected).label)}" title="${name}"><strong data-sound-current>${escapeText(getAlertSound(selected).label)}</strong> ▾</button>
      <ul class="sound-picker__list" id="${idPrefix}-sound-${kind}-list" role="listbox" aria-label="${name}" hidden>
        ${ALERT_SOUNDS.map((sound, index) => `<li role="option" tabindex="-1" data-sound-id="${sound.id}" aria-selected="${sound.id === selected}"><span class="sound-picker__index">${index + 1}</span>${escapeText(sound.label)}</li>`).join('')}
      </ul>
    </div>`
}

export function alertControlsHtml(idPrefix: string): string {
  return `<div class="alert-controls" data-alert-controls>
    <fieldset class="alert-kinds"><legend>Alertar em · som</legend>
      ${ALERT_KINDS.map((kind) => `<div class="alert-kind"><label title="${KIND_NAME[kind]}"><input type="checkbox" data-alert-kind="${kind}"${settings.kinds[kind] ? ' checked' : ''} /> ${KIND_ICON[kind]} ${KIND_SHORT[kind]}</label>${soundPickerHtml(idPrefix, kind)}</div>`).join('')}
    </fieldset>
    <div class="alert-auto"><label><input type="checkbox" data-auto-highlight${settings.autoHighlight ? ' checked' : ''} /> Destacar o jogo do gol, touchdown ou VAR (3+ telas) por</label>
      <select data-auto-highlight-sec aria-label="Tempo do destaque do gol"${settings.autoHighlight ? '' : ' disabled'}>
        ${AUTO_HIGHLIGHT_OPTIONS.map((value) => `<option value="${value}"${settings.autoHighlightSec === value ? ' selected' : ''}>${durationLabel(value)}</option>`).join('')}
      </select>
    </div>
    <div class="alert-auto"><label title="Quando um jogo seu em destaque vai para o intervalo, ele troca de lugar com o jogo rolando mais interessante e volta quando o 2º tempo começa (3+ telas)"><input type="checkbox" data-halftime-swap${settings.halftimeSwap ? ' checked' : ''} /> Trocar o destaque no intervalo</label></div>
    <label class="alert-score-delay" title="O feed costuma chegar antes do vídeo; o atraso evita ver o gol no placar antes de vê-lo na tela. Nas lives do YouTube vale também para alertas e destaque, e cada painel pode ter o seu">Placar no painel
      <select data-score-delay>
        ${[null, ...SCORE_DELAY_OPTIONS].map((value) => `<option value="${value ?? 'off'}"${settings.scoreDelaySec === value ? ' selected' : ''}>${scoreDelayLabel(value)}</option>`).join('')}
      </select>
    </label>
    <label class="alert-close-finished" title="Quando o feed William Hill (jogos da BLL) disser que o jogo acabou. A contagem começa depois do atraso do placar e o painel mostra um botão para mantê-lo aberto">Fechar o painel quando o jogo acabar
      <select data-close-finished>
        ${[null, ...CLOSE_FINISHED_OPTIONS].map((value) => `<option value="${value ?? 'off'}"${settings.closeFinishedSec === value ? ' selected' : ''}>${closeFinishedLabel(value)}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="btn btn--ghost" data-open-monitor title="Mostra os logs da engine que escaneia os lances">Monitor de lances</button>
  </div>`
}

export function bindAlertControls(root: ParentNode, signal?: AbortSignal) {
  for (const controls of root.querySelectorAll<HTMLElement>('[data-alert-controls]')) {
    for (const picker of controls.querySelectorAll<HTMLElement>('[data-sound-picker]')) {
      const button = picker.querySelector<HTMLButtonElement>('.sound-picker__button')
      const list = picker.querySelector<HTMLElement>('.sound-picker__list')
      const label = picker.querySelector<HTMLElement>('[data-sound-current]')
      if (!button || !list || !label) continue
      const kind = picker.dataset.soundPicker as AlertKind
      const setOpen = (open: boolean) => {
        list.hidden = !open
        button.setAttribute('aria-expanded', String(open))
        if (open) list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
      }
      const choose = (id: string) => {
        settings = { ...settings, sounds: { ...settings.sounds, [kind]: id } }
        saveAlertSettings(settings)
        label.textContent = getAlertSound(id).label
        button.setAttribute('aria-label', `Som do alerta de ${KIND_NAME[kind]}: ${getAlertSound(id).label}`)
        for (const option of list.querySelectorAll<HTMLElement>('[data-sound-id]')) {
          option.setAttribute('aria-selected', String(option.dataset.soundId === id))
        }
        playAlertSound(id, { force: true })
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const open = list.hasAttribute('hidden')
        // Only one list open at a time: the other pickers never see this click.
        if (open) {
          for (const other of controls.querySelectorAll<HTMLElement>('[data-sound-picker]')) {
            if (other === picker) continue
            other.querySelector<HTMLElement>('.sound-picker__list')?.toggleAttribute('hidden', true)
            other.querySelector('.sound-picker__button')?.setAttribute('aria-expanded', 'false')
          }
        }
        setOpen(open)
      }, { signal })
      list.addEventListener('click', (event) => {
        event.stopPropagation()
        const option = (event.target as HTMLElement).closest<HTMLElement>('[data-sound-id]')
        if (option?.dataset.soundId) choose(option.dataset.soundId)
      }, { signal })
      list.addEventListener('keydown', (event) => {
        const options = [...list.querySelectorAll<HTMLElement>('[data-sound-id]')]
        const index = options.indexOf(document.activeElement as HTMLElement)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
        } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
          event.preventDefault()
          choose(options[index].dataset.soundId!)
        } else if (event.key === 'Escape') {
          setOpen(false)
          button.focus()
        }
      }, { signal })
      document.addEventListener('click', (event) => { if (!picker.contains(event.target as Node)) setOpen(false) }, { signal })
    }
    for (const box of controls.querySelectorAll<HTMLInputElement>('[data-alert-kind]')) {
      box.addEventListener('change', () => {
        settings = { ...settings, kinds: { ...settings.kinds, [box.dataset.alertKind as AlertKind]: box.checked } }
        saveAlertSettings(settings)
      }, { signal })
    }
    const autoSec = controls.querySelector<HTMLSelectElement>('[data-auto-highlight-sec]')
    controls.querySelector<HTMLInputElement>('[data-auto-highlight]')?.addEventListener('change', (event) => {
      settings = { ...settings, autoHighlight: (event.target as HTMLInputElement).checked }
      saveAlertSettings(settings)
      if (autoSec) autoSec.disabled = !settings.autoHighlight
    }, { signal })
    controls.querySelector<HTMLInputElement>('[data-halftime-swap]')?.addEventListener('change', (event) => {
      settings = { ...settings, halftimeSwap: (event.target as HTMLInputElement).checked }
      saveAlertSettings(settings)
      for (const listener of settingsListeners) listener(settings)
    }, { signal })
    autoSec?.addEventListener('change', () => {
      settings = { ...settings, autoHighlightSec: Number(autoSec.value) }
      saveAlertSettings(settings)
    }, { signal })
    controls.querySelector<HTMLSelectElement>('[data-score-delay]')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      settings = { ...settings, scoreDelaySec: value === 'off' ? null : Number(value) }
      saveAlertSettings(settings)
      for (const listener of settingsListeners) listener(settings)
    }, { signal })
    controls.querySelector<HTMLSelectElement>('[data-close-finished]')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      settings = { ...settings, closeFinishedSec: value === 'off' ? null : Number(value) }
      saveAlertSettings(settings)
    }, { signal })
    controls.querySelector('[data-open-monitor]')?.addEventListener('click', () => window.quadra?.openMonitor(), { signal })
  }
}

export function clearAlert(panelId: string, root: ParentNode) {
  const alert = active.get(panelId)
  if (alert) clearTimeout(alert.timer)
  active.delete(panelId)
  applyAlertStates(root)
}

/** The goal's score, with the number of the team that scored boxed (own goals get no box: the side isn't certain). */
function renderAlertText(label: HTMLElement, alert: ActiveAlert) {
  const match = alert.scorer ? /^(.*?)(\d+)(\s*[-–x]\s*)(\d+)$/.exec(alert.text) : null
  if (!match || !alert.scorer) {
    label.textContent = alert.text
    return
  }
  const [, before, home, separator, away] = match
  const number = (value: string, scored: boolean) => {
    const span = document.createElement('span')
    span.className = scored ? 'panel__alert-score panel__alert-score--scored' : 'panel__alert-score'
    span.textContent = value
    return span
  }
  label.replaceChildren(before, number(home, alert.scorer === 'home'), separator, number(away, alert.scorer === 'away'))
}

/** " · M. Frandsen" after the alert text, as its own span so it can be styled and updated alone. */
function appendPlayer(label: HTMLElement, player: string) {
  if (!player) return
  const span = document.createElement('span')
  span.className = 'panel__alert-player'
  span.textContent = ` · ${formatPlayerName(player)}`
  label.append(span)
}

export function varReviewText(review: VarReviewState) {
  const who = review.player || review.teamName
  return `Revisão: ${VAR_REVIEW_NAME[review.kind]}${review.minute ? ` · ${review.minute}'` : ''}${who ? ` ${who}` : ''}`
}

export function hasVarReview(panelId: string) {
  return varReviews.has(panelId)
}

/**
 * Starts, updates or (with null) ends a panel's VAR review. Returns true when a review starts, which plays
 * the VAR sound once; the VAR alert type being off hides the review altogether.
 */
export function setVarReview(panelId: string, review: VarReviewState | null, root: ParentNode, panelExists: (panelId: string) => boolean): boolean {
  if (!review || !settings.kinds.var || !panelExists(panelId)) {
    clearVarReview(panelId, root)
    return false
  }
  const started = !varReviews.has(panelId)
  varReviews.set(panelId, review)
  applyAlertStates(root)
  if (started) {
    playAlertSound(settings.sounds.var)
    for (const listener of varListeners) listener(panelId)
  }
  return started
}

export function clearVarReview(panelId: string, root: ParentNode) {
  if (!varReviews.delete(panelId)) return
  applyAlertStates(root)
}

const varListeners = new Set<(panelId: string) => void>()

/** Lets the layout code react to a VAR review starting (highlighting its game). */
export function onVarReviewStarted(listener: (panelId: string) => void) {
  varListeners.add(listener)
  return () => varListeners.delete(listener)
}

/** The blue dashed ring and "VAR" badge of a review in progress. */
function applyVarState(panelElement: HTMLElement) {
  const review = varReviews.get(panelElement.dataset.panelId ?? '')
  let overlay = panelElement.querySelector<HTMLElement>(':scope > .panel__var')
  panelElement.classList.toggle('panel--var', Boolean(review))
  if (!review) {
    overlay?.remove()
    return
  }
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'panel__var'
    overlay.innerHTML = '<span class="panel__var-badge" role="status"><span class="panel__var-tag">VAR</span><span class="panel__var-icon" aria-hidden="true"></span><span class="panel__var-text"></span></span>'
    panelElement.append(overlay)
  }
  const text = varReviewText(review)
  const label = overlay.querySelector<HTMLElement>('.panel__var-text')!
  if (label.textContent !== text) {
    label.textContent = text
    overlay.querySelector<HTMLElement>('.panel__var-icon')!.textContent = VAR_REVIEW_ICON[review.kind]
    overlay.querySelector<HTMLElement>('.panel__var-badge')!.title = `VAR em andamento — ${text}`
  }
}

/** Idempotent: re-applies the ring/badge to panels, also after the grid re-renders. */
export function applyAlertStates(root: ParentNode) {
  for (const panelElement of root.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
    applyVarState(panelElement)
    const alert = active.get(panelElement.dataset.panelId ?? '')
    let overlay = panelElement.querySelector<HTMLElement>(':scope > .panel__alert')
    for (const kind of Object.keys(KIND_NAME)) panelElement.classList.toggle(`panel--alert-${kind}`, alert?.kind === kind)
    panelElement.classList.toggle('panel--alert', Boolean(alert))
    if (!alert) {
      overlay?.remove()
      continue
    }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'panel__alert'
      overlay.innerHTML = '<span class="panel__alert-badge" role="status"><span class="panel__alert-text"></span></span>'
      panelElement.append(overlay)
    }
    // The goal's Fixar/Voltar controls live inside the badge, so only the text span is rewritten.
    const label = overlay.querySelector<HTMLElement>('.panel__alert-text')!
    const key = `${alert.scorer ?? ''}|${alert.text}|${alert.player}`
    if (label.dataset.key !== key) {
      label.dataset.key = key
      renderAlertText(label, alert)
      appendPlayer(label, alert.player)
    }
  }
}

export function clearAllAlerts(root: ParentNode) {
  for (const alert of active.values()) clearTimeout(alert.timer)
  active.clear()
  varReviews.clear()
  applyAlertStates(root)
}

/**
 * A goal's scorer arrived after its alert. It joins the alert on screen (the timer keeps running, so name,
 * alert and highlight all leave together), or waits for an alert that is still held back by the panel delay.
 */
export function handleScorerName(panelId: string, eventId: string, player: string, root: ParentNode) {
  if (!eventId || !player.trim()) return
  if (scorerNames.size >= MAX_SCORER_NAMES) scorerNames.delete(scorerNames.keys().next().value!)
  scorerNames.set(eventId, player.trim().slice(0, 80))
  const alert = active.get(panelId)
  if (!alert || alert.eventId !== eventId || alert.player) return
  alert.player = scorerNames.get(eventId)!
  applyAlertStates(root)
}

/**
 * Returns true when the event was shown (type enabled and panel present). `goalHoldMs` replaces the usual
 * time of a goal alert, so the alert can leave together with the goal highlight.
 */
export function handleMatchEvent(payload: MatchEventPayload, root: ParentNode, panelExists: (panelId: string) => boolean, goalHoldMs?: number): boolean {
  if (!settings.kinds[payload.kind] || !panelExists(payload.panelId)) return false
  const score = payload.score ? ` · ${payload.score}` : ''
  const note = payload.note ? ` (${payload.note})` : payload.ownGoal ? ' (contra)' : ''
  const text = `${KIND_ICON[payload.kind]} ${payload.label}${note}${payload.kind === 'yellow' || payload.kind === 'red' || payload.kind === 'penalty' ? '' : score}`
  const previous = active.get(payload.panelId)
  if (previous) clearTimeout(previous.timer)
  const hold = payload.kind === 'goal' || payload.kind === 'touchdown' ? goalHoldMs ?? GOAL_HOLD_MS : OTHER_HOLD_MS
  const scorerKnown = payload.kind === 'goal' || payload.kind === 'touchdown' || payload.kind === 'field-goal'
  active.set(payload.panelId, {
    kind: payload.kind,
    text,
    eventId: payload.eventId ?? '',
    player: scorerKnown ? payload.player?.trim() || (payload.eventId ? scorerNames.get(payload.eventId) : '') || '' : '',
    scorer: (payload.kind === 'goal' || payload.kind === 'touchdown' || payload.kind === 'field-goal') && !payload.ownGoal && (payload.team === 'home' || payload.team === 'away') ? payload.team : null,
    timer: setTimeout(() => clearAlert(payload.panelId, root), hold),
  })
  applyAlertStates(root)
  playAlertSound(settings.sounds[payload.kind])
  for (const listener of listeners) listener(payload.panelId, payload)
  return true
}
