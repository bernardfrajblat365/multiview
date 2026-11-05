import {
  INFO_TABS,
  OUTCOME_LETTER,
  crestKeyOf,
  formatGameDate,
  formatOdd,
  formatRating,
  initialsOf,
  photoKey,
  ratingTone,
  type InfoTabId,
  type LineupPerson,
  type LineupPlayer,
  type LineupTeam,
  type MatchInfoResult,
  type MatchStat,
  type StatsSection,
  type PhotoRef,
  type FanVote,
  type GameOdds,
  type GamesInfo,
  type OddsMarket,
  type RecentGame,
  type StandingRow,
  type StandingsTable,
  type TeamForm,
} from './match-info'
import type { TeamRef365 } from './livescore-365'

const ICON_GOAL = new URL('./assets/lineup/goal.png', import.meta.url).href
const ICON_ASSIST = new URL('./assets/lineup/assist.png', import.meta.url).href
const ICON_YELLOW = new URL('./assets/lineup/yellow-card.png', import.meta.url).href
const ICON_RED = new URL('./assets/lineup/red-card.png', import.meta.url).href

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

const EMPTY_MESSAGE: Record<InfoTabId, string> = {
  lineup: 'Escalação ainda não divulgada',
  standings: 'Este jogo não tem tabela de campeonato',
  odds: 'Sem odds abertas para este jogo',
  games: 'Sem jogos anteriores destes times',
  stats: 'Ainda sem estatísticas para este jogo',
}

const OUTCOME_NAME = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' } as const
const NARROW_PANEL_PX = 420
const SKELETON_ROWS = 11

function esc(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

const INFO_ICON = '<img class="panel__info-icon" src="./match-info-icon.png" alt="" aria-hidden="true" />'

/** O botão de estatísticas dos controles do painel, criado e removido conforme o painel tem (ou não) informações. */
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
    button.title = 'Escalação e estatísticas'
    button.setAttribute('aria-label', 'Escalação e estatísticas do jogo')
    button.innerHTML = INFO_ICON
    // Antes do ⏱ (ou do 🔔, ou da lixeira): ✎ ↻ 📊 ⏱ 🔔 🗑.
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
  /** O último resultado de cada aba: trocar de aba mostra o que já se sabe enquanto a busca nova roda. */
  const results = new Map<InfoTabId, MatchInfoResult>()
  let element: HTMLElement | null = null
  let requestToken = 0
  let refreshTimer: number | null = null
  const teamChoice = new Map<string, 0 | 1>()
  /** Fotos já resolvidas (null: o jogador não tem foto). Ficam na memória: reabrir a gaveta é instantâneo. */
  const photos = new Map<string, string | null>()
  const photoRequested = new Set<string>()
  const tableCrests = new Map<string, string | null>()
  const crestRequested = new Set<string>()

  function selectedTeam(id: string): 0 | 1 {
    return teamChoice.get(id) ?? deps.firstTeam(id)
  }

  function avatarHtml(name: string, ref: PhotoRef | null) {
    const key = ref ? photoKey(ref) : ''
    const url = key ? photos.get(key) : null
    const inner = url ? `<img src="${esc(url)}" alt="" />` : esc(initialsOf(name))
    return `<span class="info-avatar"${key ? ` data-photo="${esc(key)}"` : ''}${url ? ' data-has-photo' : ''} aria-hidden="true">${inner}</span>`
  }

  /** Ícones de gol / assistência / cartões ao lado do nome; só entram quando a contagem é > 0. */
  function eventIconsHtml(player: LineupPlayer) {
    const parts: string[] = []
    const labels: string[] = []
    const add = (count: number, src: string, singular: string, plural: string) => {
      if (count <= 0) return
      const label = count === 1 ? singular : `${count} ${plural}`
      labels.push(label)
      const badge = count > 1 ? `<span class="info-row__event-n">${count}</span>` : ''
      parts.push(`<span class="info-row__event" title="${esc(label)}"><img src="${esc(src)}" alt="" />${badge}</span>`)
    }
    add(player.goals, ICON_GOAL, 'Gol', 'gols')
    add(player.assists, ICON_ASSIST, 'Assistência', 'assistências')
    add(player.yellowCards, ICON_YELLOW, 'Cartão amarelo', 'cartões amarelos')
    add(player.redCards, ICON_RED, 'Cartão vermelho', 'cartões vermelhos')
    if (parts.length === 0) return ''
    return `<span class="info-row__events" aria-label="${esc(labels.join(', '))}">${parts.join('')}</span>`
  }

  function playerRowHtml(player: LineupPlayer) {
    const tone = ratingTone(player.rating)
    const position = player.position ? `<span class="info-row__pos" title="${esc(player.position)}">${esc(player.positionShort)}</span>` : ''
    const events = eventIconsHtml(player)
    return `<li class="info-row" data-info-row>
      <span class="info-row__number">${player.number ?? ''}</span>
      ${avatarHtml(player.name, player.photo)}
      <span class="info-row__who"><span class="info-row__name-line"><span class="info-row__name" title="${esc(player.name)}">${esc(player.name)}</span>${events}</span>${position}</span>
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

  function standingsRowHtml(row: StandingRow, table: StandingsTable, highlight: ReadonlySet<number>, showDraws: boolean, showPoints: boolean) {
    const zone = row.zone === null ? undefined : table.zones.find((item) => item.num === row.zone)
    const crestKey = row.crestRef ? crestKeyOf(row.crestRef) : ''
    const crest = crestKey ? tableCrests.get(crestKey) : null
    const marked = highlight.has(row.competitorId)
    const sign = row.diff > 0 ? '+' : ''
    return `<li class="info-standing${marked ? ' is-highlighted' : ''}" data-info-standing${marked ? ' data-highlighted' : ''}>
      <span class="info-standing__pos"${zone ? ` style="--zone:${zone.color}" title="${esc(zone.name)}"` : ''}>${row.position}</span>
      <span class="info-standing__team"><span class="info-standing__crest"${crestKey ? ` data-crest="${esc(crestKey)}"` : ''}>${crest ? `<img src="${esc(crest)}" alt="" />` : ''}</span><span class="info-standing__name" title="${esc(row.name)}">${esc(row.name)}</span></span>
      <span class="info-standing__num">${row.played}</span>
      <span class="info-standing__num info-standing__opt">${row.won}</span>
      ${showDraws ? `<span class="info-standing__num info-standing__opt">${row.drawn}</span>` : ''}
      <span class="info-standing__num info-standing__opt">${row.lost}</span>
      <span class="info-standing__num info-standing__opt">${sign}${row.diff}</span>
      ${showPoints ? `<span class="info-standing__num info-standing__pts">${row.points ?? '–'}</span>` : ''}
    </li>`
  }

  function standingsHtml(table: StandingsTable, highlight: readonly number[]) {
    const marked = new Set(highlight)
    const showDraws = table.rows.some((row) => row.drawn > 0)
    const showPoints = table.rows.some((row) => (row.points ?? 0) > 0)
    const head = `<div class="info-standing info-standing--head" aria-hidden="true"><span class="info-standing__pos">#</span><span class="info-standing__team">Time</span><span class="info-standing__num">J</span><span class="info-standing__num info-standing__opt">V</span>${showDraws ? '<span class="info-standing__num info-standing__opt">E</span>' : ''}<span class="info-standing__num info-standing__opt">D</span><span class="info-standing__num info-standing__opt">SG</span>${showPoints ? '<span class="info-standing__num info-standing__pts">P</span>' : ''}</div>`
    const title = [table.title, table.group].filter(Boolean).join(' · ')
    const legend = table.zones.length ? `<ul class="info-legend" data-info-legend>${table.zones.map((zone) => `<li style="--zone:${zone.color}"><span class="info-legend__dot"></span>${esc(zone.name)}</li>`).join('')}</ul>` : ''
    const rows = table.rows.map((row) => standingsRowHtml(row, table, marked, showDraws, showPoints)).join('')
    return `${title ? `<p class="info-note" data-info-note>${esc(title)}</p>` : ''}${head}<ol class="info-list info-table${showDraws ? '' : ' no-draws'}${showPoints ? '' : ' no-points'}" data-info-list>${rows}</ol>${legend}`
  }

  function crestSlotHtml(ref: TeamRef365 | null, className: string) {
    const key = ref ? crestKeyOf(ref) : ''
    const url = key ? tableCrests.get(key) : null
    return `<span class="${className}"${key ? ` data-crest="${esc(key)}"` : ''}>${url ? `<img src="${esc(url)}" alt="" />` : ''}</span>`
  }

  /** Uma linha por opção, nas mesmas colunas em todos os mercados: nome, odd, seta, odd de antes do jogo. */
  function oddsMarketHtml(market: OddsMarket) {
    const rows = market.options.map((option) => {
      const trend = option.trend ? `<span class="info-odd__trend info-odd__trend--${option.trend}" aria-label="${option.trend === 'up' ? 'subiu' : 'caiu'}">${option.trend === 'up' ? '▲' : '▼'}</span>` : '<span class="info-odd__trend"></span>'
      const before = `<span class="info-odd__pre"${option.prematch !== null ? ' title="Odd antes do jogo"' : ''}>${option.prematch !== null ? `antes ${formatOdd(option.prematch)}` : ''}</span>`
      return `<li class="info-odd" data-info-odd><span class="info-odd__label" title="${esc(option.label)}">${esc(option.label)}</span><span class="info-odd__rate">${formatOdd(option.rate)}</span>${trend}${before}</li>`
    }).join('')
    return `<section data-info-market><h3 class="info-section">${esc(market.title)}</h3><ol class="info-odds">${rows}</ol></section>`
  }

  /** Barra dividida com valor e nome embaixo de cada parte, em colunas iguais (votos dos torcedores e confronto direto). */
  function splitBarHtml(items: { value: string; weight: number; label: string }[]) {
    const bars = items.map((item, i) => `<span class="info-split__bar info-split__bar--${i}" style="flex-grow:${Math.max(item.weight, 1)}"></span>`).join('')
    const labels = items.map((item, i) => `<li class="info-split__item info-split__item--${i}"><span class="info-split__value">${esc(item.value)}</span><span class="info-split__label" title="${esc(item.label)}">${esc(item.label)}</span></li>`).join('')
    return `<div class="info-split__track" aria-hidden="true">${bars}</div><ul class="info-split__list" style="--n:${items.length}">${labels}</ul>`
  }

  function votesHtml(votes: FanVote[]) {
    return `<section data-info-votes><h3 class="info-section">Quem vai ganhar? · torcedores</h3>${splitBarHtml(votes.map((vote) => ({ value: `${vote.percentage}%`, weight: vote.percentage, label: vote.label })))}</section>`
  }

  function oddsHtml(odds: GameOdds, live: boolean) {
    const source = [odds.bookmaker ? `Odds: ${odds.bookmaker}` : 'Odds do 365Scores', live ? 'ao vivo' : ''].filter(Boolean).join(' · ')
    return `<p class="info-note" data-info-note>${esc(source)}</p><div class="info-list info-scroll" data-info-list>${odds.markets.map(oddsMarketHtml).join('')}${odds.votes.length ? votesHtml(odds.votes) : ''}</div>`
  }

  function recentGameHtml(game: RecentGame) {
    const letter = OUTCOME_LETTER[game.outcome]
    return `<li class="info-game" data-info-game title="${esc(game.competition)}">
      <span class="info-game__date">${esc(formatGameDate(game.startTime))}</span>
      <span class="info-game__where" title="${game.home ? 'Em casa' : 'Fora de casa'}">${game.home ? 'C' : 'F'}</span>
      <span class="info-game__team">${crestSlotHtml(game.opponentRef, 'info-game__crest')}<span class="info-game__name" title="${esc(game.opponent)}">${esc(game.opponent)}</span></span>
      <span class="info-game__score">${game.goalsFor}-${game.goalsAgainst}</span>
      <span class="info-form info-form--${game.outcome}" title="${OUTCOME_NAME[game.outcome]}">${letter}</span>
    </li>`
  }

  function formHtml(team: TeamForm) {
    if (team.games.length === 0) return '<p class="info-note">Sem jogos recentes</p>'
    const strip = team.games.slice(0, 5).map((game) => `<span class="info-form info-form--${game.outcome}" title="${OUTCOME_NAME[game.outcome]}">${OUTCOME_LETTER[game.outcome]}</span>`).join('')
    return `<div class="info-form-strip" data-info-form aria-label="Forma recente, do mais novo ao mais antigo">${strip}</div><ol class="info-games">${team.games.map(recentGameHtml).join('')}</ol>`
  }

  function h2hHtml(info: GamesInfo) {
    const { h2h, teams } = info
    if (h2h.total === 0) return '<section><h3 class="info-section">Confronto direto</h3><p class="info-note">Os times não se enfrentaram recentemente</p></section>'
    const games = h2h.games.map((game) => {
      const homeWon = game.winnerId === game.homeId
      const awayWon = game.winnerId === game.awayId
      return `<li class="info-h2h-game" data-info-h2h-game title="${esc(game.competition)}"><span class="info-game__date">${esc(formatGameDate(game.startTime))}</span><span class="info-h2h-game__home${homeWon ? ' is-winner' : ''}" title="${esc(game.home)}">${esc(game.home)}</span><span class="info-game__score">${game.homeScore}-${game.awayScore}</span><span class="info-h2h-game__away${awayWon ? ' is-winner' : ''}" title="${esc(game.away)}">${esc(game.away)}</span></li>`
    }).join('')
    return `<section><h3 class="info-section">Confronto direto · ${h2h.total} ${h2h.total === 1 ? 'jogo' : 'jogos'}</h3>
      <div data-info-h2h>${splitBarHtml([
        { value: String(h2h.wins[0]), weight: h2h.wins[0], label: teams[0].name },
        { value: String(h2h.draws), weight: h2h.draws, label: 'Empates' },
        { value: String(h2h.wins[1]), weight: h2h.wins[1], label: teams[1].name },
      ])}</div>
      <ol class="info-games info-h2h-games">${games}</ol></section>`
  }

  function gamesHtml(id: string, info: GamesInfo) {
    const index = selectedTeam(id)
    const buttons = info.teams.map((team, i) => {
      const selected = i === index
      const crest = deps.crests(id)[i] ?? (team.crestRef ? tableCrests.get(crestKeyOf(team.crestRef)) ?? null : null)
      return `<button type="button" role="tab" class="info-team${selected ? ' is-selected' : ''}" aria-selected="${selected}" data-info-team="${i}" title="${esc(team.name)}">${crest ? `<img src="${esc(crest)}" alt="" />` : ''}<span>${esc(team.name)}</span></button>`
    }).join('')
    return `<div class="info-list info-scroll" data-info-list>${h2hHtml(info)}<section><h3 class="info-section">Últimos jogos</h3><div class="info-teams" role="tablist" aria-label="Time">${buttons}</div>${formHtml(info.teams[index])}</section></div>`
  }

  /** Uma linha por estatística: valor de cada lado, nome no meio e a barra comparativa embaixo. */
  function statHtml(stat: MatchStat, order: readonly [0 | 1, 0 | 1]) {
    const side = (index: 0 | 1) => stat.better === index ? ' is-better' : ''
    const [left, right] = order
    return `<li class="info-stat" data-info-stat>
      <div class="info-stat__line"><span class="info-stat__value${side(left)}">${esc(stat.values[left])}</span><span class="info-stat__name" title="${esc(stat.name)}">${esc(stat.name)}</span><span class="info-stat__value${side(right)}">${esc(stat.values[right])}</span></div>
      <div class="info-stat__bar" aria-hidden="true"><span class="info-stat__track"><span class="info-stat__fill${side(left)}" style="width:${Math.round(stat.shares[left] * 100)}%"></span></span><span class="info-stat__track"><span class="info-stat__fill${side(right)}" style="width:${Math.round(stat.shares[right] * 100)}%"></span></span></div>
    </li>`
  }

  function statsHtml(id: string, teams: readonly [string, string], sections: readonly StatsSection[], live: boolean) {
    // Mesma ordem do rótulo do painel: quem aparece primeiro lá fica à esquerda aqui.
    const order: [0 | 1, 0 | 1] = deps.firstTeam(id) === 1 ? [1, 0] : [0, 1]
    const crests = deps.crests(id)
    const team = (index: 0 | 1) => `<span class="info-stats__team" title="${esc(teams[index])}">${crests[index] ? `<img src="${esc(crests[index])}" alt="" />` : ''}<span>${esc(teams[index])}</span></span>`
    const titled = sections.length > 1
    const body = sections.map((section) => `${titled ? `<li class="info-stats__section" data-info-stats-section>${esc(section.title)}</li>` : ''}${section.stats.map((stat) => statHtml(stat, order)).join('')}`).join('')
    const note = live ? '<p class="info-note" data-info-note>Ao vivo, sem o atraso ⏱ do painel</p>' : ''
    return `<div class="info-stats__teams">${team(order[0])}${team(order[1])}</div>${note}<ol class="info-list info-stats" data-info-list>${body}</ol>`
  }

  function bodyHtml(id: string) {
    if (state.kind === 'loading') {
      return `<div class="info-skeleton" aria-busy="true">${'<div class="info-skeleton__row"></div>'.repeat(SKELETON_ROWS)}</div>`
    }
    const result = state.result
    if (result.status === 'none') return `<p class="info-message" data-info-message>${EMPTY_MESSAGE[tab]}</p>`
    if (result.status === 'error') return '<p class="info-message" data-info-message>Não foi possível carregar o 365Scores</p><button type="button" class="btn btn--load info-retry" data-info-retry>Tentar de novo</button>'
    if (result.status !== 'ok') return ''
    if (result.tab === 'standings') return standingsHtml(result.table, result.highlight)
    if (result.tab === 'odds') return oddsHtml(result.odds, result.live)
    if (result.tab === 'games') return gamesHtml(id, result.games)
    if (result.tab === 'stats') return statsHtml(id, result.teams, result.sections, result.live)
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
    if (restored && tab === 'standings' && !list) scrollToHighlighted(restored)
    loadPhotos()
    loadCrests()
  }

  /** A tabela abre mostrando os times do jogo, mesmo numa competição com muitos times. */
  function scrollToHighlighted(list: HTMLElement) {
    const first = list.querySelector<HTMLElement>('[data-highlighted]')
    if (!first) return
    list.scrollTop = Math.max(0, first.offsetTop - list.offsetTop - (list.clientHeight - first.offsetHeight) / 2)
  }

  /** Os escudos da tabela chegam depois do texto, como as fotos da escalação. */
  function loadCrests() {
    if (state.kind !== 'result' || state.result.status !== 'ok') return
    const result = state.result
    const all: TeamRef365[] = result.tab === 'standings'
      ? result.table.rows.flatMap((row) => row.crestRef ?? [])
      : result.tab === 'games'
        ? [...result.games.teams.flatMap((team) => [...(team.crestRef ? [team.crestRef] : []), ...team.games.flatMap((game) => game.opponentRef ?? [])])]
        : []
    const unique = new Map(all.map((ref) => [crestKeyOf(ref), ref]))
    const refs = [...unique.values()].filter((ref) => !crestRequested.has(crestKeyOf(ref))).slice(0, 40)
    if (refs.length === 0) return
    for (const ref of refs) crestRequested.add(crestKeyOf(ref))
    void window.quadra?.getTableCrests(refs).then((found) => {
      for (const ref of refs) {
        const key = crestKeyOf(ref)
        const url = found[key] ?? null
        tableCrests.set(key, url)
        if (!url) continue
        for (const slot of element?.querySelectorAll<HTMLElement>(`[data-crest="${key}"]`) ?? []) slot.innerHTML = `<img src="${esc(url)}" alt="" />`
      }
    }).catch(() => {
      for (const ref of refs) crestRequested.delete(crestKeyOf(ref))
    })
  }

  /** As fotos chegam depois do texto: o time escolhido primeiro, depois o outro. */
  function loadPhotos() {
    if (state.kind !== 'result' || state.result.status !== 'ok' || state.result.tab !== 'lineup' || !panelId) return
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
    const requested = tab
    if (showLoading) {
      state = { kind: 'loading' }
      render()
    }
    let result: MatchInfoResult
    try {
      result = window.quadra ? await window.quadra.getMatchInfo({ panelId: id, tab: requested }) : { status: 'error' }
    } catch {
      result = { status: 'error' }
    }
    if (token !== requestToken || panelId !== id || tab !== requested) return
    if (result.status === 'no-game') {
      close()
      return
    }
    // Uma atualização que falhou não apaga a escalação que já está na tela.
    if (!(result.status === 'error' && state.kind === 'result' && state.result.status === 'ok')) state = { kind: 'result', result }
    if (result.status === 'ok') results.set(requested, result)
    else results.delete(requested)
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
    results.clear()
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
    results.clear()
    state = { kind: 'loading' }
    deps.onChange()
  }

  function toggle(id: string) {
    if (panelId === id) close()
    else open(id)
  }

  function selectTab(next: InfoTabId) {
    if (!panelId || !element) return
    tab = next
    const known = results.get(next)
    state = known ? { kind: 'result', result: known } : { kind: 'loading' }
    const tabs = element.querySelector<HTMLElement>('[data-info-tabs]')
    if (tabs) tabs.innerHTML = tabsHtml()
    // Gaveta estreita: a fileira de abas rola de lado; a aba escolhida fica inteira na vista.
    tabs?.querySelector<HTMLElement>('.info-tab.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    render()
    void fetchInfo(panelId, false)
  }

  function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.closest('[data-info-close]')) {
      close()
      return
    }
    if (!panelId) return
    const tabId = target.closest<HTMLElement>('[data-info-tab]')?.dataset.infoTab
    if (tabId && tabId !== tab && INFO_TABS.some((item) => item.id === tabId)) {
      selectTab(tabId as InfoTabId)
      return
    }
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

  /** O painel passou a ver outro jogo (ou ganhou outra fonte): a gaveta aberta nele busca de novo. */
  function refresh(id: string) {
    if (panelId !== id || !element) return
    results.clear()
    void fetchInfo(id, true)
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

  return { toggle, close, sync, refresh, forget, isOverPanel, openPanelId: () => panelId }
}
