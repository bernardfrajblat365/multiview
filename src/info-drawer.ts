import {
  INFO_TABS,
  formatRating,
  initialsOf,
  photoKey,
  ratingTone,
  type InfoTabId,
  type LineupPerson,
  type LineupPlayer,
  type LineupTeam,
  type MatchInfoResult,
  type PhotoRef,
} from './match-info'

/** O que a gaveta precisa saber do resto do app. */
export type InfoDrawerDeps = {
  panelElement: (panelId: string) => HTMLElement | null
  /** Grade aberta, painel existente, jogo com informações e organizador fechado. */
  canOpen: (panelId: string) => boolean
  /** Escudos do painel, na ordem do feed. */
  crests: (panelId: string) => [string | null, string | null]
  /** Qual time aparece primeiro no rótulo (0: o primeiro do feed). */
  firstTeam: (panelId: string) => 0 | 1
  /** A gaveta abriu ou fechou: os botões do painel atualizam o `aria-expanded`. */
  onChange: () => void
}

const REFRESH_MS = 60_000
const NARROW_PANEL_PX = 420
const SKELETON_ROWS = 11

function esc(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

const SHIRT_ICON = '<svg class="panel__info-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 2 2 3.6 3 6.4l1.6-.5V14h6.8V5.9l1.6.5 1-2.8L10.4 2c-.3.9-1.2 1.5-2.4 1.5S5.9 2.9 5.6 2Z" /></svg>'

/** O botão de camisa dos controles do painel, criado e removido conforme o painel tem (ou não) informações. */
export function updateInfoButton(panelElement: HTMLElement, ready: boolean, open: boolean) {
  const controls = panelElement.querySelector<HTMLElement>(':scope > .panel__controls')
  let button = controls?.querySelector<HTMLButtonElement>(':scope > .panel__info') ?? null
  if (!controls || !ready) {
    button?.remove()
    return
  }
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn--ghost btn--icon panel__info'
    button.dataset.info = ''
    button.title = 'Escalação'
    button.setAttribute('aria-label', 'Escalação do jogo')
    button.innerHTML = SHIRT_ICON
    // Antes do ⏱ (ou do 🔔, ou da lixeira): ✎ ↻ 👕 ⏱ 🔔 🗑.
    controls.insertBefore(button, controls.querySelector(':scope > .panel__delay') ?? controls.querySelector(':scope > .panel__alerts') ?? controls.querySelector(':scope > .panel__remove'))
  }
  button.setAttribute('aria-expanded', String(open))
  button.classList.toggle('is-open', open)
}

type LoadState = { kind: 'loading' } | { kind: 'result'; result: MatchInfoResult }

export function createInfoDrawer(deps: InfoDrawerDeps) {
  let panelId: string | null = null
  let tab: InfoTabId = 'lineup'
  let state: LoadState = { kind: 'loading' }
  let element: HTMLElement | null = null
  let requestToken = 0
  let refreshTimer: number | null = null
  const teamChoice = new Map<string, 0 | 1>()
  /** Fotos já resolvidas (null: o jogador não tem foto). Ficam na memória: reabrir a gaveta é instantâneo. */
  const photos = new Map<string, string | null>()
  const photoRequested = new Set<string>()

  function selectedTeam(id: string): 0 | 1 {
    return teamChoice.get(id) ?? deps.firstTeam(id)
  }

  function avatarHtml(name: string, ref: PhotoRef | null) {
    const key = ref ? photoKey(ref) : ''
    const url = key ? photos.get(key) : null
    const inner = url ? `<img src="${esc(url)}" alt="" />` : esc(initialsOf(name))
    return `<span class="info-avatar"${key ? ` data-photo="${esc(key)}"` : ''}${url ? ' data-has-photo' : ''} aria-hidden="true">${inner}</span>`
  }

  function playerRowHtml(player: LineupPlayer) {
    const tone = ratingTone(player.rating)
    const position = player.position ? `<span class="info-row__pos" title="${esc(player.position)}">${esc(player.positionShort)}</span>` : ''
    return `<li class="info-row" data-info-row>
      <span class="info-row__number">${player.number ?? ''}</span>
      ${avatarHtml(player.name, player.photo)}
      <span class="info-row__who"><span class="info-row__name" title="${esc(player.name)}">${esc(player.name)}</span>${position}</span>
      <span class="info-row__rating info-row__rating--${tone}">${formatRating(player.rating)}</span>
    </li>`
  }

  // Mesma grade dos jogadores, logo abaixo deles, com "Técnico" no lugar da posição.
  function coachHtml(coach: LineupPerson) {
    return `<div class="info-row info-coach" data-info-coach>
      <span class="info-row__number"></span>
      ${avatarHtml(coach.name, coach.photo)}
      <span class="info-row__who"><span class="info-row__name" title="${esc(coach.name)}">${esc(coach.name)}</span><span class="info-coach__label">Técnico</span></span>
    </div>`
  }

  function teamButtonHtml(id: string, team: LineupTeam, index: 0 | 1, selected: boolean) {
    const crest = deps.crests(id)[index]
    return `<button type="button" role="tab" class="info-team${selected ? ' is-selected' : ''}" aria-selected="${selected}" data-info-team="${index}" title="${esc(team.name)}">${crest ? `<img src="${esc(crest)}" alt="" />` : ''}<span>${esc(team.name)}</span></button>`
  }

  function bodyHtml(id: string) {
    if (state.kind === 'loading') {
      return `<div class="info-skeleton" aria-busy="true">${'<div class="info-skeleton__row"></div>'.repeat(SKELETON_ROWS)}</div>`
    }
    const result = state.result
    if (result.status === 'none') return '<p class="info-message" data-info-message>Escalação ainda não divulgada</p>'
    if (result.status === 'error') return '<p class="info-message" data-info-message>Não foi possível carregar o 365Scores</p><button type="button" class="btn btn--load info-retry" data-info-retry>Tentar de novo</button>'
    if (result.status !== 'ok') return ''
    const index = selectedTeam(id)
    const team = result.teams[index]
    const note = result.source === 'wh' ? 'Fonte: William Hill' : team.confirmed ? 'Escalação confirmada' : 'Escalação provável'
    return `<div class="info-teams" role="tablist" aria-label="Time">${result.teams.map((item, i) => teamButtonHtml(id, item, i as 0 | 1, i === index)).join('')}</div>
      <p class="info-note" data-info-note>${note}</p>
      <ol class="info-list${result.source === 'wh' ? ' is-wh' : ''}" data-info-list>${team.players.map(playerRowHtml).join('')}</ol>
      ${team.coach ? coachHtml(team.coach) : ''}`
  }

  function tabsHtml() {
    return INFO_TABS.map((item) => `<button type="button" role="tab" class="info-tab${item.id === tab ? ' is-selected' : ''}" aria-selected="${item.id === tab}" data-info-tab="${item.id}">${esc(item.label)}</button>`).join('')
  }

  function render() {
    if (!element || !panelId) return
    const list = element.querySelector<HTMLElement>('[data-info-list]')
    const scroll = list?.scrollTop ?? 0
    const body = element.querySelector<HTMLElement>('[data-info-body]')
    if (body) body.innerHTML = bodyHtml(panelId)
    const restored = element.querySelector<HTMLElement>('[data-info-list]')
    if (restored) restored.scrollTop = scroll
    loadPhotos()
  }

  /** As fotos chegam depois do texto: o time escolhido primeiro, depois o outro. */
  function loadPhotos() {
    if (state.kind !== 'result' || state.result.status !== 'ok' || !panelId) return
    const result = state.result
    const first = selectedTeam(panelId)
    for (const team of [result.teams[first], result.teams[first === 0 ? 1 : 0]]) {
      const refs: PhotoRef[] = []
      for (const person of [...team.players, ...(team.coach ? [team.coach] : [])]) {
        const ref = person.photo
        if (ref && !photoRequested.has(photoKey(ref))) {
          photoRequested.add(photoKey(ref))
          refs.push(ref)
        }
      }
      if (refs.length === 0) continue
      void window.quadra?.getAthletePhotos(refs.slice(0, 30)).then((found) => {
        for (const ref of refs) {
          const key = photoKey(ref)
          const url = found[key] ?? null
          photos.set(key, url)
          if (!url) continue
          for (const avatar of element?.querySelectorAll<HTMLElement>(`[data-photo="${key}"]`) ?? []) {
            avatar.innerHTML = `<img src="${esc(url)}" alt="" />`
            avatar.dataset.hasPhoto = ''
          }
        }
      }).catch(() => {
        // Sem resposta: tenta de novo na próxima abertura.
        for (const ref of refs) photoRequested.delete(photoKey(ref))
      })
    }
  }

  async function fetchInfo(id: string, showLoading: boolean) {
    const token = ++requestToken
    if (showLoading) {
      state = { kind: 'loading' }
      render()
    }
    let result: MatchInfoResult
    try {
      result = window.quadra ? await window.quadra.getMatchInfo({ panelId: id, tab }) : { status: 'error' }
    } catch {
      result = { status: 'error' }
    }
    if (token !== requestToken || panelId !== id) return
    if (result.status === 'no-game') {
      close()
      return
    }
    // Uma atualização que falhou não apaga a escalação que já está na tela.
    if (!(result.status === 'error' && state.kind === 'result' && state.result.status === 'ok')) state = { kind: 'result', result }
    render()
    scheduleRefresh()
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer)
    refreshTimer = null
    // As notas mudam com o jogo andando; fechada ou com o jogo parado, a gaveta não busca nada.
    if (!panelId || state.kind !== 'result' || state.result.status !== 'ok' || !state.result.live) return
    const id = panelId
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null
      if (panelId === id) void fetchInfo(id, false)
    }, REFRESH_MS)
  }

  function position() {
    if (!element || !panelId) return
    const panel = deps.panelElement(panelId)
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const width = rect.width < NARROW_PANEL_PX ? rect.width : Math.min(340, Math.max(240, rect.width * 0.42))
    element.style.left = `${Math.round(rect.right - width)}px`
    element.style.top = `${Math.round(rect.top)}px`
    element.style.width = `${Math.round(width)}px`
    // A altura segue o conteúdo da aba; o painel é só o limite (a lista rola se não couber).
    element.style.maxHeight = `${Math.round(rect.height)}px`
  }

  /** Retângulo do painel com a gaveta aberta: clicar nele (fora da gaveta) fecha a gaveta. */
  function panelRect() {
    return panelId ? deps.panelElement(panelId)?.getBoundingClientRect() ?? null : null
  }

  function isOverPanel(x: number, y: number) {
    const rect = panelRect()
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  }

  function open(id: string) {
    if (!deps.canOpen(id)) return
    if (panelId === id && element) return
    const moved = element !== null
    if (!element) {
      element = document.createElement('aside')
      element.className = 'info-drawer'
      element.setAttribute('role', 'dialog')
      element.setAttribute('aria-label', 'Informações do jogo')
      element.innerHTML = `<div class="info-drawer__head"><div class="info-tabs" role="tablist" data-info-tabs></div><button type="button" class="info-drawer__close" data-info-close aria-label="Fechar" title="Fechar (Esc)">×</button></div><div class="info-drawer__body" data-info-body></div>`
      element.addEventListener('click', onClick)
      document.body.append(element)
    }
    panelId = id
    tab = 'lineup'
    element.dataset.panelId = id
    const tabs = element.querySelector<HTMLElement>('[data-info-tabs]')
    if (tabs) tabs.innerHTML = tabsHtml()
    position()
    // Deslizar só quando a gaveta aparece; mudar de painel apenas a move.
    if (!moved) element.classList.add('is-entering')
    void fetchInfo(id, true)
    deps.onChange()
  }

  function close() {
    if (!element && panelId === null) return
    requestToken += 1
    if (refreshTimer !== null) window.clearTimeout(refreshTimer)
    refreshTimer = null
    element?.remove()
    element = null
    panelId = null
    state = { kind: 'loading' }
    deps.onChange()
  }

  function toggle(id: string) {
    if (panelId === id) close()
    else open(id)
  }

  function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.closest('[data-info-close]')) {
      close()
      return
    }
    if (!panelId) return
    const team = target.closest<HTMLElement>('[data-info-team]')?.dataset.infoTeam
    if (team === '0' || team === '1') {
      teamChoice.set(panelId, team === '1' ? 1 : 0)
      render()
      return
    }
    if (target.closest('[data-info-retry]')) void fetchInfo(panelId, true)
  }

  /** Reposiciona sobre o painel, ou fecha se ele não pode mais mostrar a gaveta. */
  function sync() {
    if (!panelId) return
    if (!deps.canOpen(panelId) || !deps.panelElement(panelId)) {
      close()
      return
    }
    position()
  }

  /** O painel perdeu o jogo ou foi removido. */
  function forget(id: string) {
    teamChoice.delete(id)
    if (panelId === id) close()
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !panelId) return
    if (document.querySelector('.confirm')) return
    event.preventDefault()
    close()
  })

  // Com a gaveta aberta, o painel inteiro fica com o overlay (ver `isOverPanel` no hit-test):
  // um clique no vídeo fecha a gaveta em vez de chegar ao player. Os botões do painel seguem normais.
  document.addEventListener('mousedown', (event) => {
    if (!panelId || event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('.info-drawer, .panel__controls, .confirm')) return
    if (isOverPanel(event.clientX, event.clientY)) close()
  }, true)

  return { toggle, close, sync, forget, isOverPanel, openPanelId: () => panelId }
}
