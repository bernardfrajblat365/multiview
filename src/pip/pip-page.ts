import './pip.css'
import { clampPipBar, type PipState } from '../pip.ts'

const bridge = window.quadraPip
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const barElement = byId<HTMLElement>('bar')
const matchElement = byId<HTMLElement>('match')
const clockElement = byId<HTMLElement>('clock')
const controlsElement = byId<HTMLElement>('controls')
const editorElement = byId<HTMLElement>('editor')
const promptElement = byId<HTMLElement>('prompt')
const finishedElement = byId<HTMLElement>('finished')

let editorOpen = false
let lastState: PipState | null = null
const lastHtml = new Map<HTMLElement, string>()

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/** Rewrites an element only when its markup changed, so an open list or a click in progress is never swallowed. */
function setHtml(element: HTMLElement, html: string) {
  if (lastHtml.get(element) === html) return
  lastHtml.set(element, html)
  element.innerHTML = html
}

function crestHtml(src: string | null) {
  return src?.startsWith('data:image/') ? `<img class="bar__crest" src="${escapeHtml(src)}" alt="" />` : ''
}

function delayLabel(seconds: number) {
  return seconds === 0 ? 'na hora' : `${seconds} s`
}

/** "⚽ Gol · 1 - 0": the number of the team that scored goes in a dark box. */
function alertHtml(alert: NonNullable<PipState['alert']>) {
  const match = alert.scorer ? /^(.*?)(\d+)(\s*[-–x]\s*)(\d+)$/.exec(alert.text) : null
  let text = escapeHtml(alert.text)
  if (match && alert.scorer) {
    const [, before, home, separator, away] = match
    const number = (value: string, scored: boolean) => scored ? `<span class="bar__badge-score--scored">${value}</span>` : value
    text = `${escapeHtml(before)}${number(home, alert.scorer === 'home')}${escapeHtml(separator)}${number(away, alert.scorer === 'away')}`
  }
  const player = alert.player ? ` · ${escapeHtml(alert.player)}` : ''
  return `<span class="bar__badge" role="status">${text}${player}</span>`
}

function matchHtml(state: PipState) {
  if (state.alert) return alertHtml(state.alert)
  if (state.varReview) return `<span class="bar__badge bar__badge--var" role="status">VAR ${escapeHtml(state.varReview.icon)} ${escapeHtml(state.varReview.text)}</span>`
  const match = state.match
  if (!match) return `<span class="bar__title" title="${escapeHtml(state.title)}">${escapeHtml(state.title || `Jogo ${state.index + 1}`)}</span>`
  const score = match.score ? `<span class="bar__score">${match.score.home} x ${match.score.away}</span>` : '<span class="bar__score">x</span>'
  return `${crestHtml(match.crests.home)}<span class="bar__team">${escapeHtml(match.home)}</span>${score}<span class="bar__team">${escapeHtml(match.away)}</span>${crestHtml(match.crests.away)}`
}

function controlsHtml(state: PipState) {
  const label = `jogo ${state.index + 1}`
  const delay = state.delay
  const delayButton = delay
    ? `<label class="btn btn--delay${delay.own !== null ? ' is-custom' : ''}" title="${escapeHtml(delay.title)}">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="5.5" /><path d="M8 6.2V9l1.8 1.3M6.3 1.8h3.4" /></svg><span aria-hidden="true">${delay.effective} s</span>
        <select data-delay aria-label="Atraso do placar e dos alertas deste painel">
          <option value="default"${delay.own === null ? ' selected' : ''}>${escapeHtml(delay.defaultLabel)}</option>
          ${delay.options.map((value) => `<option value="${value}"${delay.own === value ? ' selected' : ''}>${delayLabel(value)}</option>`).join('')}
        </select></label>`
    : ''
  const bell = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.2H2.8zM6.6 14.2a1.5 1.5 0 0 0 2.8 0" />${state.alertsOff ? '<path d="M2.2 2.2l11.6 11.6" />' : ''}</svg>`
  const alertsLabel = `${state.alertsOff ? 'Ativar' : 'Desativar'} alertas do ${label}`
  const muteLabel = `${state.muted ? 'Ativar som do' : 'Mutar'} ${label}`
  return `
    <button type="button" class="btn" data-cmd="mute" aria-pressed="${state.muted}" title="${muteLabel}" aria-label="${muteLabel}"><span aria-hidden="true">${state.muted ? '🔇' : '🔊'}</span><span class="btn__label">${state.muted ? 'Ativar som' : 'Mutar'}</span></button>
    <button type="button" class="btn" data-edit title="Editar URL" aria-label="Editar URL" aria-expanded="${editorOpen}">✎</button>
    <button type="button" class="btn" data-cmd="reload" title="Recarregar página" aria-label="Recarregar ${label}"><img src="./reload-icon.png" alt="" /></button>
    ${delayButton}
    <button type="button" class="btn" data-cmd="alerts" aria-pressed="${state.alertsOff}" title="${alertsLabel}" aria-label="${alertsLabel}">${bell}</button>
    <button type="button" class="btn btn--primary" data-cmd="return" title="Voltar para a grade" aria-label="Voltar para a grade">⧉<span class="btn__label">Voltar</span></button>`
}

function editorHtml(state: PipState) {
  return `
    <form data-form novalidate>
      <input type="url" name="url" inputmode="url" autocomplete="off" spellcheck="false" aria-label="URL do jogo" placeholder="Cole link YouTube ou URL e pressione Enter" value="${escapeHtml(state.url)}" />
      <button type="button" class="btn" data-cmd="bllsport" aria-pressed="${state.bllTarget}">BLL</button>
      <button type="button" class="btn" data-cmd="youtube">YouTube</button>
      <button type="button" class="btn" data-cmd="zapping">Zapping</button>
      <button type="submit" class="btn btn--primary">Abrir</button>
      <button type="button" class="btn" data-edit aria-label="Fechar edição">×</button>
    </form>`
}

function setEditor(open: boolean) {
  editorOpen = open
  editorElement.hidden = !open
  if (!open) {
    editorElement.replaceChildren()
  } else if (lastState) {
    editorElement.innerHTML = editorHtml(lastState)
    const input = editorElement.querySelector<HTMLInputElement>('input[name="url"]')
    input?.focus()
    input?.select()
  }
  if (lastState) setHtml(controlsElement, controlsHtml(lastState))
}

function render(state: PipState) {
  lastState = state
  document.body.classList.toggle('alert', Boolean(state.alert))
  for (const kind of ['goal', 'touchdown', 'penalty', 'red', 'yellow', 'var', 'field-goal']) {
    document.body.classList.toggle(`alert-${kind}`, state.alert?.kind === kind)
  }
  document.body.classList.toggle('var', Boolean(state.varReview))
  setHtml(matchElement, matchHtml(state))
  const clock = state.match?.clock
  clockElement.hidden = !clock || Boolean(state.alert)
  if (clock) {
    if (clockElement.textContent !== clock.text) clockElement.textContent = clock.text
    clockElement.classList.toggle('bar__clock--halftime', clock.halftime)
  }
  setHtml(controlsElement, controlsHtml(state))

  const prompt = state.prompt
  promptElement.hidden = !prompt
  if (prompt) {
    setHtml(promptElement, `<span class="bar__extra-title">Qual jogo é este? (365Scores)</span>${prompt.candidates.map((candidate) =>
      `<button type="button" class="btn btn--primary" data-choose="${candidate.id}" title="${escapeHtml(candidate.detail)}">${escapeHtml(candidate.label)}</button>`).join('')}<button type="button" class="btn" data-choose="none">Nenhum</button>`)
  }

  const finished = state.finished
  finishedElement.hidden = !finished
  if (finished) {
    setHtml(finishedElement, '<span class="bar__extra-title">Fim de jogo · fecha em <span data-seconds></span> s</span><button type="button" class="btn" data-cmd="keep-open">Manter aberto</button>')
    const seconds = finishedElement.querySelector('[data-seconds]')
    if (seconds) seconds.textContent = String(finished.secondsLeft)
  }
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cmd], [data-edit], [data-choose]')
  if (!target || !bridge) return
  if (target.dataset.edit !== undefined) {
    setEditor(!editorOpen)
    return
  }
  if (target.dataset.choose !== undefined) {
    const id = target.dataset.choose
    bridge.command({ type: 'choose-match', gameId: id === 'none' ? null : Number(id) })
    return
  }
  const type = target.dataset.cmd
  if (type === 'mute' || type === 'alerts' || type === 'reload' || type === 'bllsport' || type === 'youtube' || type === 'zapping' || type === 'keep-open' || type === 'return') {
    bridge.command({ type })
  }
})

document.addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-delay]')
  if (!select || !bridge) return
  bridge.command({ type: 'delay', value: select.value === 'default' ? 'default' : Number(select.value) })
})

document.addEventListener('submit', (event) => {
  event.preventDefault()
  const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-form]')
  if (!form || !bridge) return
  const input = form.elements.namedItem('url') as HTMLInputElement
  const url = input.value.trim()
  if (url) bridge.command({ type: 'url', url })
  setEditor(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editorOpen) setEditor(false)
})

// The bar grows to a second line (editor, prompt, end of game); the window gives the video what remains.
new ResizeObserver(() => bridge?.setBarHeight(clampPipBar(barElement.getBoundingClientRect().height))).observe(barElement)

bridge?.onState(render)
bridge?.ready()
