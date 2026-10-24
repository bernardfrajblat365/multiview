import { ALERT_SOUNDS, ALERT_SOUND_IDS, getAlertSound, playAlertSound } from './alert-sounds'
import { AUTO_HIGHLIGHT_OPTIONS, SCORE_DELAY_OPTIONS, loadAlertSettings, saveAlertSettings, type AlertSettings } from './alert-settings'
import type { AlertKind } from './match-events'

export type MatchEventPayload = { panelId: string; kind: AlertKind; teamName: string; minute: number; score: string; ownGoal: boolean; note?: string; label: string }

const GOAL_HOLD_MS = 45_000
const OTHER_HOLD_MS = 12_000
const KIND_ICON: Record<AlertKind, string> = { goal: '⚽', penalty: '🎯', red: '🟥', yellow: '🟨', var: '📺' }
const KIND_NAME: Record<AlertKind, string> = { goal: 'Gol', penalty: 'Pênalti', red: 'Cartão vermelho', yellow: 'Cartão amarelo', var: 'VAR' }

type ActiveAlert = { kind: AlertKind; text: string; timer: ReturnType<typeof setTimeout> }

let settings: AlertSettings = loadAlertSettings(ALERT_SOUND_IDS)
const active = new Map<string, ActiveAlert>()
const listeners = new Set<(panelId: string, payload: MatchEventPayload) => void>()
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

export function alertControlsHtml(idPrefix: string): string {
  const current = getAlertSound(settings.soundId)
  return `<div class="alert-controls" data-alert-controls>
    <div class="sound-picker" data-sound-picker>
      <button type="button" class="btn btn--ghost sound-picker__button" id="${idPrefix}-sound" aria-haspopup="listbox" aria-expanded="false" aria-controls="${idPrefix}-sound-list">Som do alerta: <strong data-sound-current>${escapeText(current.label)}</strong> ▾</button>
      <ul class="sound-picker__list" id="${idPrefix}-sound-list" role="listbox" aria-label="Som do alerta" hidden>
        ${ALERT_SOUNDS.map((sound, index) => `<li role="option" tabindex="-1" data-sound-id="${sound.id}" aria-selected="${sound.id === settings.soundId}"><span class="sound-picker__index">${index + 1}</span>${escapeText(sound.label)}</li>`).join('')}
      </ul>
    </div>
    <fieldset class="alert-kinds"><legend>Alertar em</legend>
      ${(Object.keys(KIND_NAME) as AlertKind[]).map((kind) => `<label><input type="checkbox" data-alert-kind="${kind}"${settings.kinds[kind] ? ' checked' : ''} /> ${KIND_ICON[kind]} ${KIND_NAME[kind]}</label>`).join('')}
    </fieldset>
    <div class="alert-auto"><label><input type="checkbox" data-auto-highlight${settings.autoHighlight ? ' checked' : ''} /> Destacar o jogo do gol (3+ telas) por</label>
      <select data-auto-highlight-sec aria-label="Tempo do destaque do gol"${settings.autoHighlight ? '' : ' disabled'}>
        ${AUTO_HIGHLIGHT_OPTIONS.map((value) => `<option value="${value}"${settings.autoHighlightSec === value ? ' selected' : ''}>${durationLabel(value)}</option>`).join('')}
      </select>
    </div>
    <label class="alert-score-delay" title="O feed costuma chegar antes do vídeo; o atraso evita ver o gol no placar antes de vê-lo na tela. Nas lives do YouTube vale também para alertas e destaque, e cada painel pode ter o seu">Placar no painel
      <select data-score-delay>
        ${[null, ...SCORE_DELAY_OPTIONS].map((value) => `<option value="${value ?? 'off'}"${settings.scoreDelaySec === value ? ' selected' : ''}>${scoreDelayLabel(value)}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="btn btn--ghost" data-open-monitor title="Mostra os logs da engine que escaneia os lances">Monitor de lances</button>
  </div>`
}

export function bindAlertControls(root: ParentNode, signal?: AbortSignal) {
  for (const controls of root.querySelectorAll<HTMLElement>('[data-alert-controls]')) {
    const button = controls.querySelector<HTMLButtonElement>('.sound-picker__button')
    const list = controls.querySelector<HTMLElement>('.sound-picker__list')
    const label = controls.querySelector<HTMLElement>('[data-sound-current]')
    if (!button || !list || !label) continue
    const setOpen = (open: boolean) => {
      list.hidden = !open
      button.setAttribute('aria-expanded', String(open))
      if (open) list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    }
    const choose = (id: string) => {
      settings = { ...settings, soundId: id }
      saveAlertSettings(settings)
      label.textContent = getAlertSound(id).label
      for (const option of list.querySelectorAll<HTMLElement>('[data-sound-id]')) {
        option.setAttribute('aria-selected', String(option.dataset.soundId === id))
      }
      playAlertSound(id, { force: true })
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      setOpen(list.hasAttribute('hidden'))
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
    document.addEventListener('click', (event) => { if (!controls.contains(event.target as Node)) setOpen(false) }, { signal })
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
    controls.querySelector('[data-open-monitor]')?.addEventListener('click', () => window.quadra?.openMonitor(), { signal })
  }
}

export function clearAlert(panelId: string, root: ParentNode) {
  const alert = active.get(panelId)
  if (alert) clearTimeout(alert.timer)
  active.delete(panelId)
  applyAlertStates(root)
}

/** Idempotent: re-applies the ring/badge to panels, also after the grid re-renders. */
export function applyAlertStates(root: ParentNode) {
  for (const panelElement of root.querySelectorAll<HTMLElement>('.panel[data-panel-id]')) {
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
      overlay.innerHTML = '<span class="panel__alert-badge" role="status"></span>'
      panelElement.append(overlay)
    }
    const badge = overlay.querySelector<HTMLElement>('.panel__alert-badge')!
    if (badge.textContent !== alert.text) badge.textContent = alert.text
  }
}

export function clearAllAlerts(root: ParentNode) {
  for (const alert of active.values()) clearTimeout(alert.timer)
  active.clear()
  applyAlertStates(root)
}

/** Returns true when the event was shown (type enabled and panel present). */
export function handleMatchEvent(payload: MatchEventPayload, root: ParentNode, panelExists: (panelId: string) => boolean): boolean {
  if (!settings.kinds[payload.kind] || !panelExists(payload.panelId)) return false
  const score = payload.score ? ` · ${payload.score}` : ''
  const note = payload.note ? ` (${payload.note})` : payload.ownGoal ? ' (contra)' : ''
  const text = `${KIND_ICON[payload.kind]} ${payload.label}${note}${payload.kind === 'goal' || payload.kind === 'var' ? score : ''}`
  const previous = active.get(payload.panelId)
  if (previous) clearTimeout(previous.timer)
  const hold = payload.kind === 'goal' ? GOAL_HOLD_MS : OTHER_HOLD_MS
  active.set(payload.panelId, {
    kind: payload.kind,
    text,
    timer: setTimeout(() => clearAlert(payload.panelId, root), hold),
  })
  applyAlertStates(root)
  playAlertSound(settings.soundId)
  for (const listener of listeners) listener(payload.panelId, payload)
  return true
}
