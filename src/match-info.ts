import type { TeamRef365 } from './livescore-365.ts'
import { formatPlayerName } from './match-events.ts'

/** Abas da gaveta de informações do jogo. Escalação e tabela aparecem; as outras já estão previstas no tipo. */
export type InfoTabId = 'lineup' | 'standings' | 'odds' | 'games' | 'stats'

export const INFO_TABS: readonly { id: InfoTabId; label: string }[] = [
  { id: 'lineup', label: 'Escalação' },
  { id: 'standings', label: 'Tabela' },
  { id: 'odds', label: 'Odds' },
  { id: 'games', label: 'Jogos' },
  { id: 'stats', label: 'Estatísticas' },
]

export function isInfoTabId(value: unknown): value is InfoTabId {
  return INFO_TABS.some((item) => item.id === value)
}

/** Foto de um atleta no CDN do 365Scores: o id e a versão bastam para montar a URL. */
export type PhotoRef = { athleteId: number; imageVersion: number }

export type LineupPerson = { name: string; photo: PhotoRef | null }

export type LineupPlayer = {
  number: number | null
  name: string
  shortName: string
  /** Posição por extenso ("Lateral Esquerdo"); vazia quando a API não diz. */
  position: string
  /** Sigla da posição ("LE"), para a linha curta. */
  positionShort: string
  rating: number | null
  photo: PhotoRef | null
  /** Contagens do jogo (eventos do `/web/game/`); 0 quando a fonte não traz (ex.: William Hill). */
  goals: number
  assists: number
  yellowCards: number
  redCards: number
}

export type LineupTeam = {
  name: string
  competitorId: number
  /** Null na escalação da William Hill (o escudo vem do rótulo do painel). */
  crestRef: TeamRef365 | null
  /** Escalação confirmada (`false`: provável). */
  confirmed: boolean
  coach: LineupPerson | null
  players: LineupPlayer[]
}

/** De onde vem a escalação: 365Scores (completa) ou o radar da William Hill (só titulares e nomes). */
export type LineupSource = '365' | 'wh'

/** Pedido da UI ao main (`quadra:match-info`). */
export type MatchInfoRequest = { panelId: string; tab: InfoTabId }

/** Uma linha da tabela do campeonato. */
export type StandingRow = {
  position: number
  name: string
  competitorId: number
  crestRef: TeamRef365 | null
  played: number
  won: number
  drawn: number
  lost: number
  /** Saldo de gols (ou de pontos, nos esportes sem gol). */
  diff: number
  points: number | null
  /** Zona da tabela (`StandingsTable.zones[n].num`), ou null no meio da tabela. */
  zone: number | null
}

export type StandingsZone = { num: number; name: string; color: string }

export type StandingsTable = {
  title: string
  /** Fase/grupo mostrado ("Grupo 2"); vazio quando a competição tem uma tabela só. */
  group: string
  rows: StandingRow[]
  zones: StandingsZone[]
}

/** Resposta do main; os times vêm na ordem do feed do painel. */
export type MatchInfoResult =
  | { status: 'ok'; tab: 'lineup'; teams: [LineupTeam, LineupTeam]; live: boolean; source: LineupSource }
  | { status: 'ok'; tab: 'standings'; table: StandingsTable; /** Ids dos times do jogo, destacados na tabela. */ highlight: number[]; live: boolean }
  | { status: 'ok'; tab: 'odds'; odds: GameOdds; live: boolean }
  | { status: 'ok'; tab: 'games'; games: GamesInfo; live: boolean }
  | { status: 'ok'; tab: 'stats'; /** Nomes dos times na ordem do feed. */ teams: [string, string]; sections: StatsSection[]; live: boolean }
  | { status: 'none' }
  | { status: 'no-game' }
  | { status: 'error' }

/** Avisa a UI que o painel tem (ou deixou de ter) um jogo do 365Scores com informações. */
export type MatchInfoReady = { panelId: string; ready: boolean }

export type LineupsParse =
  | { status: 'ok'; teams: [LineupTeam, LineupTeam]; live: boolean }
  | { status: 'none' }
  | { status: 'invalid' }

const MAX_STARTERS = 15
const MAX_NAME = 80

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, limit = MAX_NAME) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function positiveInt(value: unknown) {
  if (typeof value !== 'number') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** Siglas das posições que o 365Scores nomeia em português; qualquer outra vira as 3 primeiras letras. */
const POSITION_SHORT: Record<string, string> = {
  'goleiro': 'GOL',
  'lateral direito': 'LD',
  'lateral esquerdo': 'LE',
  'zagueiro central': 'ZAG',
  'volante': 'VOL',
  'meia central': 'MC',
  'meia atacante': 'MEI',
  'meia direita': 'MD',
  'meia esquerda': 'ME',
  'ponta direita': 'PD',
  'ponta esquerda': 'PE',
  'centroavante': 'CA',
  'segundo atacante': 'SA',
  'atacante': 'ATA',
  'meio-campo': 'MC',
  'defesa': 'DEF',
}

export function positionShort(name: string) {
  const clean = name.trim()
  if (!clean) return ''
  return POSITION_SHORT[clean.toLowerCase()] ?? clean.replace(/[^\p{L}]/gu, '').slice(0, 3).toUpperCase()
}

/** "7,1"; sem nota, "–". */
export function formatRating(rating: number | null) {
  if (rating === null || !Number.isFinite(rating)) return '–'
  return rating.toFixed(1).replace('.', ',')
}

/** Cor da pílula da nota: de 7 para cima verde, de 6 a 6,9 neutra, abaixo de 6 laranja. */
export function ratingTone(rating: number | null): 'high' | 'mid' | 'low' | 'none' {
  if (rating === null || !Number.isFinite(rating)) return 'none'
  const rounded = Math.round(rating * 10) / 10
  if (rounded >= 7) return 'high'
  if (rounded >= 6) return 'mid'
  return 'low'
}

/** Iniciais para quem não tem foto ("Peter Gulacsi" → "PG"). */
export function initialsOf(name: string) {
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word))
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0]
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : ''
  return (first + last).toUpperCase()
}

export function crestKeyOf(ref: TeamRef365) {
  return `${ref.id}:${ref.imageVersion}`
}

export function photoKey(ref: PhotoRef) {
  return `${ref.athleteId}:${ref.imageVersion}`
}

/** Quadrado pequeno, em PNG. Sem imagem padrão (`d_…`): quem não tem foto responde 404 e a UI mostra as iniciais. */
const PHOTO_TRANSFORM = 'f_png,w_68,h_68,c_limit,q_auto:eco,dpr_2'
export const IMAGE_BASE_URL = 'https://imagecache.365scores.com'

export function athletePhotoUrl(ref: PhotoRef, base = IMAGE_BASE_URL) {
  return `${base.replace(/\/+$/, '')}/image/upload/${PHOTO_TRANSFORM}/v${ref.imageVersion}/Athletes/${ref.athleteId}`
}

export const MAX_PHOTO_REFS = 30

/** Valida o pedido de fotos que vem da UI: até 30 referências, ids inteiros seguros e positivos. */
export function parsePhotoRefs(value: unknown): PhotoRef[] | null {
  if (!Array.isArray(value) || value.length > MAX_PHOTO_REFS) return null
  const refs: PhotoRef[] = []
  for (const item of value) {
    const row = record(item)
    const athleteId = row ? positiveInt(row.athleteId) : null
    const imageVersion = row ? positiveInt(row.imageVersion) : null
    if (athleteId === null || imageVersion === null) return null
    refs.push({ athleteId, imageVersion })
  }
  return refs
}

/** Valida o pedido de escudos da tabela: até 40 times, ids inteiros seguros; a versão da imagem pode ser 0. */
export function parseTeamRefs(value: unknown): TeamRef365[] | null {
  if (!Array.isArray(value) || value.length > MAX_TABLE_ROWS) return null
  const refs: TeamRef365[] = []
  for (const item of value) {
    const row = record(item)
    const id = row ? positiveInt(row.id) : null
    const version = row && typeof row.imageVersion === 'number' ? row.imageVersion : NaN
    if (id === null || !Number.isSafeInteger(version) || version < 0) return null
    refs.push({ id, imageVersion: version })
  }
  return refs
}

type Member = { name: string; shortName: string; jersey: number | null; photo: PhotoRef | null }

/** Contagens lidas dos eventos do jogo; o `id` é o do membro (`game.members` / `lineups.members`). */
export type LineupEventCounts = { goals: number; assists: number; yellowCards: number; redCards: number }

const EMPTY_EVENTS: LineupEventCounts = { goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
const EVENT_GOAL = 1
const EVENT_YELLOW = 2
const EVENT_RED = 3
/** Teto por jogador: evita ícone/contagem absurda se a API mandar lixo. */
const MAX_EVENT_COUNT = 9

function parseMembers(value: unknown) {
  const members = new Map<number, Member>()
  if (!Array.isArray(value)) return members
  for (const item of value) {
    const row = record(item)
    const id = row ? positiveInt(row.id) : null
    if (!row || id === null) continue
    const name = text(row.name)
    if (!name) continue
    const jersey = Number(row.jerseyNumber)
    const athleteId = positiveInt(row.athleteId)
    const imageVersion = positiveInt(row.imageVersion)
    members.set(id, {
      name,
      shortName: text(row.shortName) || name,
      jersey: Number.isSafeInteger(jersey) && jersey >= 0 ? jersey : null,
      photo: athleteId !== null && imageVersion !== null ? { athleteId, imageVersion } : null,
    })
  }
  return members
}

/**
 * Gols (`eventType.id` 1 → `playerId`), assistências (mesmo evento → `extraPlayers`), amarelo (2) e vermelho (3).
 * Substituições também usam `extraPlayers`, então só o gol conta assistência.
 */
export function parseLineupEventCounts(events: unknown): Map<number, LineupEventCounts> {
  const map = new Map<number, LineupEventCounts>()
  if (!Array.isArray(events)) return map
  const bump = (id: number, key: keyof LineupEventCounts) => {
    const cur = map.get(id) ?? { ...EMPTY_EVENTS }
    if (cur[key] >= MAX_EVENT_COUNT) return
    cur[key] += 1
    map.set(id, cur)
  }
  for (const item of events) {
    const row = record(item)
    const type = record(row?.eventType)
    if (!row || !type) continue
    const typeId = Number(type.id)
    const playerId = positiveInt(row.playerId)
    if (typeId === EVENT_GOAL) {
      if (playerId !== null) bump(playerId, 'goals')
      if (Array.isArray(row.extraPlayers)) {
        for (const extra of row.extraPlayers) {
          const assistId = positiveInt(extra)
          if (assistId !== null) bump(assistId, 'assists')
        }
      }
    } else if (typeId === EVENT_YELLOW && playerId !== null) {
      bump(playerId, 'yellowCards')
    } else if (typeId === EVENT_RED && playerId !== null) {
      bump(playerId, 'redCards')
    }
  }
  return map
}

function parseTeam(value: unknown, members: Map<number, Member>, events: Map<number, LineupEventCounts>): LineupTeam | null {
  const competitor = record(value)
  const competitorId = competitor ? positiveInt(competitor.id) : null
  if (!competitor || competitorId === null) return null
  const lineups = record(competitor.lineups)
  const list = lineups && Array.isArray(lineups.members) ? lineups.members : []
  const players: LineupPlayer[] = []
  let coach: LineupPerson | null = null
  for (const item of list) {
    const row = record(item)
    const member = row ? members.get(Number(row.id)) : undefined
    if (!row || !member) continue
    if (row.status === 1 && players.length < MAX_STARTERS) {
      const position = text(record(row.formation)?.name) || text(record(row.position)?.name)
      const ranking = Number(row.ranking)
      const counts = events.get(Number(row.id)) ?? EMPTY_EVENTS
      players.push({
        number: member.jersey,
        name: member.name,
        shortName: member.shortName,
        position,
        positionShort: positionShort(position),
        rating: Number.isFinite(ranking) && ranking > 0 ? ranking : null,
        photo: member.photo,
        goals: counts.goals,
        assists: counts.assists,
        yellowCards: counts.yellowCards,
        redCards: counts.redCards,
      })
    } else if (row.status === 4 && !coach) {
      coach = { name: member.name, photo: member.photo }
    }
  }
  return {
    name: text(competitor.name),
    competitorId,
    crestRef: { id: competitorId, imageVersion: Number.isSafeInteger(Number(competitor.imageVersion)) ? Number(competitor.imageVersion) : 0 },
    confirmed: lineups?.status === 'Confirmado',
    coach,
    players,
  }
}

/**
 * Escalação de uma resposta de `/web/game/`: titulares (status 1) e técnico (status 4) de cada time, com nome,
 * camisa e foto vindos de `game.members` pelo `id`. Reservas e desfalques ficam de fora.
 * `none`: o jogo não tem escalação divulgada; `invalid`: resposta que não é deste jogo.
 */
export function parseLineups(raw: unknown, gameId: number): LineupsParse {
  const game = record(record(raw)?.game)
  if (!game || Number(game.id) !== gameId) return { status: 'invalid' }
  const members = parseMembers(game.members)
  const events = parseLineupEventCounts(game.events)
  const home = parseTeam(game.homeCompetitor, members, events)
  const away = parseTeam(game.awayCompetitor, members, events)
  if (!home || !away) return { status: 'invalid' }
  if (game.hasLineups === false || (home.players.length === 0 && away.players.length === 0)) return { status: 'none' }
  return { status: 'ok', teams: [home, away], live: Number(game.statusGroup) === 3 }
}

/** Titulares como a página do radar William Hill os guarda (`mainPlayers`): camisa e nome no formato "Herrera, Lautaro". */
export type WhLineupRaw = {
  home?: unknown
  away?: unknown
  homeCoach?: unknown
  awayCoach?: unknown
}

function whTeam(name: string, players: unknown, coach: unknown): LineupTeam {
  const list: LineupPlayer[] = []
  if (Array.isArray(players)) {
    for (const item of players) {
      const row = record(item)
      const raw = row ? text(row.name) : ''
      if (!row || !raw || list.length >= MAX_STARTERS) continue
      const number = Number(row.number)
      const formatted = formatPlayerName(raw)
      list.push({
        number: Number.isSafeInteger(number) && number >= 0 && row.number !== '' && row.number !== null ? number : null,
        name: formatted,
        shortName: formatted,
        position: '',
        positionShort: '',
        rating: null,
        photo: null,
        ...EMPTY_EVENTS,
      })
    }
  }
  const coachName = text(coach)
  return { name, competitorId: 0, crestRef: null, confirmed: true, coach: coachName ? { name: formatPlayerName(coachName), photo: null } : null, players: list }
}

/**
 * Escalação lida do radar William Hill de um painel: só titulares, sem posição, nota nem foto.
 * Null quando nenhum dos dois times tem titulares.
 */
export function parseWhLineup(raw: unknown, homeName: string, awayName: string): [LineupTeam, LineupTeam] | null {
  const row = record(raw)
  if (!row) return null
  const home = whTeam(text(homeName), row.home, row.homeCoach)
  const away = whTeam(text(awayName), row.away, row.awayCoach)
  return home.players.length === 0 && away.players.length === 0 ? null : [home, away]
}

/** Onde fica a tabela do campeonato de um jogo (resposta de `/web/game/`). */
export type StandingsTarget = { competitionId: number; seasonNum: number; stageNum: number; groupNum: number | null; teamIds: number[]; hasStandings: boolean; live: boolean }

export function parseStandingsTarget(raw: unknown, gameId: number): StandingsTarget | null {
  const game = record(record(raw)?.game)
  if (!game || Number(game.id) !== gameId) return null
  const competitionId = positiveInt(game.competitionId)
  const seasonNum = positiveInt(game.seasonNum)
  const stageNum = positiveInt(game.stageNum)
  if (competitionId === null || seasonNum === null || stageNum === null) return null
  const teamIds = [record(game.homeCompetitor)?.id, record(game.awayCompetitor)?.id].map(positiveInt).filter((id): id is number => id !== null)
  return {
    competitionId, seasonNum, stageNum,
    groupNum: positiveInt(game.groupNum),
    teamIds,
    hasStandings: game.hasStandings !== false,
    live: Number(game.statusGroup) === 3,
  }
}

const MAX_TABLE_ROWS = 40

function count(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0
}

function color(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#9bbdad'
}

/**
 * Tabela de uma resposta de `/web/standings/`: a da fase do jogo, e, em competição com grupos, só o grupo dos times
 * (o do jogo, ou o de uma das linhas dos dois times). Null quando a resposta não traz uma tabela utilizável.
 */
export function parseStandings(raw: unknown, target: StandingsTarget): StandingsTable | null {
  const list = record(raw)?.standings
  if (!Array.isArray(list)) return null
  const entry = list.map(record).find((item) => item && Number(item.competitionId) === target.competitionId && Number(item.stageNum) === target.stageNum)
  if (!entry || !Array.isArray(entry.rows)) return null
  const all = entry.rows.map(record).filter((row): row is Record<string, unknown> => row !== null)
  const groupOf = (row: Record<string, unknown>) => positiveInt(row.groupNum)
  const own = all.find((row) => target.teamIds.includes(Number(record(row.competitor)?.id)))
  const groupNum = target.groupNum ?? (own ? groupOf(own) : null)
  const groups = new Set(all.map(groupOf))
  const rows = (groups.size > 1 && groupNum !== null ? all.filter((row) => groupOf(row) === groupNum) : all).slice(0, MAX_TABLE_ROWS)
  const zones = (Array.isArray(entry.destinations) ? entry.destinations : []).flatMap((item): StandingsZone[] => {
    const row = record(item)
    const num = row ? positiveInt(row.num) : null
    const name = row ? text(row.name) : ''
    return row && num !== null && name ? [{ num, name, color: color(row.color) }] : []
  })
  const parsed: StandingRow[] = []
  for (const row of rows) {
    const competitor = record(row.competitor)
    const competitorId = competitor ? positiveInt(competitor.id) : null
    const name = competitor ? text(competitor.shortName) || text(competitor.name) : ''
    if (!competitor || competitorId === null || !name) continue
    const points = Number(row.points)
    parsed.push({
      position: positiveInt(row.position) ?? parsed.length + 1,
      name,
      competitorId,
      crestRef: { id: competitorId, imageVersion: Number.isSafeInteger(Number(competitor.imageVersion)) ? Number(competitor.imageVersion) : 0 },
      played: count(row.gamePlayed),
      won: count(row.gamesWon),
      drawn: count(row.gamesEven),
      lost: count(row.gamesLost),
      diff: Number.isFinite(Number(row.ratio)) ? Math.trunc(Number(row.ratio)) : 0,
      points: Number.isFinite(points) && points >= 0 ? Math.trunc(points) : null,
      zone: positiveInt(row.destinationNum),
    })
  }
  if (parsed.length === 0) return null
  parsed.sort((a, b) => a.position - b.position)
  const usedZones = zones.filter((zone) => parsed.some((row) => row.zone === zone.num))
  return {
    title: text(entry.displayName),
    group: groupNum !== null && groups.size > 1 ? `Grupo ${groupNum}` : '',
    rows: parsed,
    zones: usedZones,
  }
}

/** Odd subiu, caiu ou ficou igual desde a última atualização (`trend` 3 / 1 / 2 no 365Scores). */
export type OddsTrend = 'up' | 'down' | null

export type OddsOption = {
  label: string
  rate: number
  trend: OddsTrend
  /** A odd de antes do jogo, mostrada com o jogo rolando; null quando é igual à atual ou a API não traz. */
  prematch: number | null
}

export type OddsMarket = { lineTypeId: number; title: string; options: OddsOption[] }

/** Votos dos usuários do 365Scores em "Quem vai ganhar?". */
export type FanVote = { label: string; percentage: number }

/** Uma odd do resultado final, para a legenda do painel. */
export type OddValue = { rate: number; trend: OddsTrend }

/** Resultado final (1X2) com os lados do 365Scores, ou na ordem do feed do painel depois de `reverseMoneyline`; sem empate no basquete. */
export type Moneyline = { home: OddValue; draw: OddValue | null; away: OddValue }

export type GameOdds = { bookmaker: string; markets: OddsMarket[]; votes: FanVote[]; moneyline: Moneyline | null }

/** Mercados mostrados, na ordem: resultado (futebol / basquete), chance dupla, ambos marcam, empate anula, total. */
const ODDS_RESULT = [1, 33]
const ODDS_SIMPLE = [14, 12, 15]
/** Total de gols / pontos: há uma linha por valor (0.5, 1.5, 2.5…); fica a mais equilibrada. */
const ODDS_TOTAL = [3, 34]
const MAX_OPTIONS = 3

function rateOf(value: unknown) {
  const rate = Number(record(value)?.decimal)
  return Number.isFinite(rate) && rate >= 1 && rate < 10_000 ? Math.round(rate * 100) / 100 : null
}

function isDecided(line: Record<string, unknown>) {
  return line.isConcluded === true || (Array.isArray(line.options) && line.options.some((option) => record(option)?.isWon === true))
}

/** "1" / "Casa" → mandante, "2" / "Fora" → visitante, "X" → Empate; o resto como a API escreve. */
function optionLabel(name: string, home: string, away: string) {
  const key = name.trim().toLowerCase()
  if ((key === '1' || key === 'casa') && home) return home
  if ((key === '2' || key === 'fora') && away) return away
  if (key === 'x') return 'Empate'
  return name
}

function parseMarket(line: Record<string, unknown>, home: string, away: string): OddsMarket | null {
  const lineTypeId = positiveInt(line.lineTypeId)
  const type = record(line.lineType)
  if (lineTypeId === null || !type || !Array.isArray(line.options)) return null
  const value = text(line.internalOptionValue, 12).replace('.', ',')
  const base = text(type.name, 40)
  if (!base) return null
  const options: OddsOption[] = []
  for (const item of line.options.slice(0, MAX_OPTIONS)) {
    const row = record(item)
    const rate = row ? rateOf(row.rate) : null
    const name = row ? text(row.name, 40) : ''
    if (!row || rate === null || !name) return null
    const prematch = rateOf(row.prematchRate)
    options.push({
      label: optionLabel(name, home, away),
      rate,
      trend: row.trend === 3 ? 'up' : row.trend === 1 ? 'down' : null,
      prematch: prematch !== null && prematch !== rate ? prematch : null,
    })
  }
  if (options.length < 2) return null
  const title = value ? `${base} (${value})` : base
  return { lineTypeId, title, options }
}

/**
 * Odds de uma resposta de `/web/bets/lines/?games=<id>`: resultado final, chance dupla, ambos marcam, empate anula e
 * o total de gols/pontos na linha mais equilibrada. Linhas já decididas (`isConcluded`, ou com uma opção `isWon`, como
 * "Mais que 0.5" depois do 1º gol) ficam de fora.
 * Os nomes "1"/"2"/"Casa"/"Fora" viram os nomes dos times (na ordem do 365Scores). Null quando nada serve.
 */
export function parseOdds(raw: unknown, gameId: number, home: string, away: string): Omit<GameOdds, 'votes'> | null {
  const response = record(raw)
  if (!response || !Array.isArray(response.lines)) return null
  const lines = response.lines.map(record).filter((line): line is Record<string, unknown> => line !== null && Number(line.gameId) === gameId && !isDecided(line))
  const homeName = text(home)
  const awayName = text(away)
  const markets: OddsMarket[] = []
  for (const id of [...ODDS_RESULT, ...ODDS_SIMPLE]) {
    const line = lines.find((item) => Number(item.lineTypeId) === id)
    const market = line ? parseMarket(line, homeName, awayName) : null
    if (market) markets.push(market)
  }
  let total: OddsMarket | null = null
  let gap = Infinity
  for (const line of lines.filter((item) => ODDS_TOTAL.includes(Number(item.lineTypeId)))) {
    const market = parseMarket(line, homeName, awayName)
    if (!market || market.options.length !== 2) continue
    const distance = Math.abs(market.options[0].rate - market.options[1].rate)
    if (distance < gap) {
      gap = distance
      total = market
    }
  }
  if (total) markets.push(total)
  if (markets.length === 0) return null
  const resultLine = ODDS_RESULT.map((id) => lines.find((item) => Number(item.lineTypeId) === id)).find(Boolean)
  const moneyline = resultLine ? moneylineOf(resultLine) : null
  const bookmakerId = Number(lines.find((line) => Number(line.lineTypeId) === markets[0].lineTypeId)?.bookmakerId)
  const bookmakers = Array.isArray(response.bookmakers) ? response.bookmakers.map(record) : []
  const bookmaker = text(bookmakers.find((item) => item && Number(item.id) === bookmakerId)?.name, 40)
  return { bookmaker, markets, moneyline }
}

/** "1" / "X" / "2" de uma linha de resultado (os nomes que a API usa antes de virarem nomes de time). */
function moneylineOf(line: Record<string, unknown>): Moneyline | null {
  const options = Array.isArray(line.options) ? line.options.map(record) : []
  const value = (name: string): OddValue | null => {
    const row = options.find((option) => option && text(option.name, 4).toUpperCase() === name)
    const rate = row ? rateOf(row.rate) : null
    return row && rate !== null ? { rate, trend: row.trend === 3 ? 'up' : row.trend === 1 ? 'down' : null } : null
  }
  const home = value('1')
  const away = value('2')
  return home && away ? { home, draw: value('X'), away } : null
}

/** Troca mandante e visitante (o painel lista o visitante do 365Scores primeiro). */
export function reverseMoneyline(moneyline: Moneyline): Moneyline {
  return { home: moneyline.away, draw: moneyline.draw, away: moneyline.home }
}

/** "Quem vai ganhar?" (`promotedPredictions`, tipo 1) do `/web/game/`: porcentagem de votos de cada opção. */
export function parseFanVotes(raw: unknown, gameId: number): FanVote[] {
  const game = record(record(raw)?.game)
  if (!game || Number(game.id) !== gameId) return []
  const list = record(game.promotedPredictions)?.predictions
  const prediction = Array.isArray(list) ? list.map(record).find((item) => item && Number(item.type) === 1) : null
  if (!prediction || !Array.isArray(prediction.options)) return []
  const votes: FanVote[] = []
  for (const item of prediction.options.slice(0, MAX_OPTIONS)) {
    const row = record(item)
    const label = row ? text(row.name, 40) : ''
    const percentage = Number(record(row?.vote)?.percentage)
    if (!label || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return []
    votes.push({ label, percentage: Math.round(percentage) })
  }
  return votes.length >= 2 && votes.some((vote) => vote.percentage > 0) ? votes : []
}

/** "2,05"; a vírgula do Brasil. */
export function formatOdd(rate: number) {
  return rate.toFixed(2).replace('.', ',')
}

export type GameOutcome = 'win' | 'draw' | 'loss'

/** Um jogo passado de um time, do ponto de vista dele. */
export type RecentGame = {
  gameId: number
  /** "2026-10-28T21:30:00-03:00", como a API manda. */
  startTime: string
  opponent: string
  opponentRef: TeamRef365 | null
  /** O time jogou em casa. */
  home: boolean
  goalsFor: number
  goalsAgainst: number
  outcome: GameOutcome
  competition: string
}

export type TeamForm = { name: string; competitorId: number; crestRef: TeamRef365 | null; games: RecentGame[] }

export type HeadToHeadGame = {
  gameId: number
  startTime: string
  home: string
  away: string
  homeId: number
  awayId: number
  homeScore: number
  awayScore: number
  /** Id do time que venceu; null no empate. */
  winnerId: number | null
  competition: string
}

export type HeadToHead = {
  games: HeadToHeadGame[]
  /** Vitórias de cada time do jogo (na ordem de `GamesInfo.teams`) e empates, em todos os confrontos que a API trouxe. */
  wins: [number, number]
  draws: number
  total: number
}

export type GamesInfo = { teams: [TeamForm, TeamForm]; h2h: HeadToHead }

const MAX_RECENT = 6
const MAX_H2H_SHOWN = 5
const MAX_H2H_COUNTED = 30

function crestRefOf(competitor: Record<string, unknown>, id: number): TeamRef365 {
  const version = Number(competitor.imageVersion)
  return { id, imageVersion: Number.isSafeInteger(version) && version >= 0 ? version : 0 }
}

function score(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null
}

function startTimeOf(value: unknown) {
  const raw = text(value, 40)
  return raw && Number.isFinite(Date.parse(raw)) ? raw : ''
}

/** Jogo encerrado com placar: os dois lados e quem venceu (`winner` 1 / 2, -1 empate). */
function finishedGame(value: unknown) {
  const game = record(value)
  if (!game || Number(game.statusGroup) !== 4) return null
  const gameId = positiveInt(game.id)
  const home = record(game.homeCompetitor)
  const away = record(game.awayCompetitor)
  const homeId = home ? positiveInt(home.id) : null
  const awayId = away ? positiveInt(away.id) : null
  const homeScore = home ? score(home.score) : null
  const awayScore = away ? score(away.score) : null
  const startTime = startTimeOf(game.startTime)
  if (gameId === null || !home || !away || homeId === null || awayId === null || homeScore === null || awayScore === null || !startTime) return null
  const winner = Number(game.winner)
  // Pênaltis: o placar empata e o `winner` diz quem passou.
  const winnerId = winner === 1 ? homeId : winner === 2 ? awayId : winner === -1 ? null : homeScore > awayScore ? homeId : awayScore > homeScore ? awayId : null
  return { game, gameId, home, away, homeId, awayId, homeScore, awayScore, startTime, winnerId, competition: text(game.competitionDisplayName, 60) }
}

function parseForm(value: unknown): TeamForm | null {
  const competitor = record(value)
  const competitorId = competitor ? positiveInt(competitor.id) : null
  if (!competitor || competitorId === null) return null
  const games: RecentGame[] = []
  for (const item of Array.isArray(competitor.recentGames) ? competitor.recentGames : []) {
    if (games.length >= MAX_RECENT) break
    const game = finishedGame(item)
    if (!game) continue
    const home = game.homeId === competitorId
    if (!home && game.awayId !== competitorId) continue
    const opponent = home ? game.away : game.home
    const opponentId = home ? game.awayId : game.homeId
    const outcome: GameOutcome = game.winnerId === null ? 'draw' : game.winnerId === competitorId ? 'win' : 'loss'
    games.push({
      gameId: game.gameId,
      startTime: game.startTime,
      opponent: text(opponent.name) || '?',
      opponentRef: crestRefOf(opponent, opponentId),
      home,
      goalsFor: home ? game.homeScore : game.awayScore,
      goalsAgainst: home ? game.awayScore : game.homeScore,
      outcome,
      competition: game.competition,
    })
  }
  return { name: text(competitor.name), competitorId, crestRef: crestRefOf(competitor, competitorId), games }
}

/**
 * Últimos jogos de cada time (`recentGames`, mais novo primeiro) e confronto direto (`h2hGames`) de uma resposta de
 * `/web/games/h2h/?gameId=<id>`. Só jogos encerrados. Times na ordem do 365Scores; `null` quando a resposta não é
 * deste jogo, e sem nenhum jogo nos três a UI mostra "sem jogos".
 */
export function parseGamesInfo(raw: unknown, gameId: number): GamesInfo | null {
  const game = record(record(raw)?.game)
  if (!game || Number(game.id) !== gameId) return null
  const home = parseForm(game.homeCompetitor)
  const away = parseForm(game.awayCompetitor)
  if (!home || !away) return null
  const h2h: HeadToHead = { games: [], wins: [0, 0], draws: 0, total: 0 }
  for (const item of Array.isArray(game.h2hGames) ? game.h2hGames : []) {
    if (h2h.total >= MAX_H2H_COUNTED) break
    const played = finishedGame(item)
    if (!played) continue
    const ids = [played.homeId, played.awayId]
    if (!ids.includes(home.competitorId) || !ids.includes(away.competitorId)) continue
    h2h.total += 1
    if (played.winnerId === null) h2h.draws += 1
    else if (played.winnerId === home.competitorId) h2h.wins[0] += 1
    else h2h.wins[1] += 1
    if (h2h.games.length < MAX_H2H_SHOWN) {
      h2h.games.push({
        gameId: played.gameId,
        startTime: played.startTime,
        home: text(played.home.name) || '?',
        away: text(played.away.name) || '?',
        homeId: played.homeId,
        awayId: played.awayId,
        homeScore: played.homeScore,
        awayScore: played.awayScore,
        winnerId: played.winnerId,
        competition: played.competition,
      })
    }
  }
  return { teams: [home, away], h2h }
}

/** Troca a ordem dos times (o painel lista o visitante do 365Scores primeiro). */
export function reverseGamesInfo(info: GamesInfo): GamesInfo {
  return { teams: [info.teams[1], info.teams[0]], h2h: { ...info.h2h, wins: [info.h2h.wins[1], info.h2h.wins[0]] } }
}

export function hasAnyGame(info: GamesInfo) {
  return info.h2h.total > 0 || info.teams.some((team) => team.games.length > 0)
}

/** "28/10/26", no fuso de São Paulo como o resto da API. */
export function formatGameDate(startTime: string) {
  const time = Date.parse(startTime)
  if (!Number.isFinite(time)) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(time))
}

export const OUTCOME_LETTER: Record<GameOutcome, string> = { win: 'V', draw: 'E', loss: 'D' }
/** Uma estatística do jogo com o valor de cada time, na ordem do feed do painel. */
export type MatchStat = {
  id: number
  name: string
  /** Texto do 365Scores ("53%", "10/29 (34%)", "1,72"). */
  values: [string, string]
  /** Fatia de cada time na barra (0–1, somam 1); [0, 0] quando os dois têm zero. */
  shares: [number, number]
  /** Time com o número melhor segundo o 365Scores (menos faltas, mais chutes…), ou null. */
  better: 0 | 1 | null
}

export type StatsSection = { title: string; stats: MatchStat[] }

const MAX_STATS = 80
const STAT_VALUE_MAX = 24

/** "1.72" → "1,72"; o resto ("53%", "10/29 (34%)") fica como o 365Scores escreve. */
export function formatStatValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).replace('.', ',')
  const clean = text(value, STAT_VALUE_MAX)
  return /^\d+\.\d+$/.test(clean) ? clean.replace('.', ',') : clean
}

function share(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(number, 1) : 0
}

/**
 * Estatísticas de uma resposta de `/web/game/stats/?games=<id>`: cada estatística vem uma vez por time
 * (`competitorId`), com o texto (`value`), a fatia da barra (`valuePercentage`) e o time em vantagem (`markedTeam`,
 * 1 mandante / 2 visitante). Só as do jogo inteiro (sem `filterId` de tempo). Seções: "Principais" (`isTop`) e
 * depois as categorias do 365Scores (Chutes, Passes…) e, no fim, as sem categoria em "Geral", cada uma na ordem do 365Scores.
 * `reversed`: o mandante do feed do painel é o visitante no 365Scores. Null quando não é deste jogo; [] sem estatísticas.
 */
export function parseMatchStats(raw: unknown, gameId: number, reversed = false): { teams: [string, string]; sections: StatsSection[]; live: boolean } | null {
  const root = record(raw)
  if (!root) return null
  const game = Array.isArray(root.games) ? root.games.map(record).find((item) => item && Number(item.id) === gameId) : null
  if (!game) return null
  const homeId = positiveInt(record(game.homeCompetitor)?.id)
  const awayId = positiveInt(record(game.awayCompetitor)?.id)
  if (homeId === null || awayId === null) return null
  const names: [string, string] = [text(record(game.homeCompetitor)?.name), text(record(game.awayCompetitor)?.name)]
  const live = Number(game.statusGroup) === 3
  type Entry = { id: number; name: string; order: number; top: boolean; category: string; categoryOrder: number; home?: Record<string, unknown>; away?: Record<string, unknown> }
  const entries = new Map<number, Entry>()
  for (const item of Array.isArray(root.statistics) ? root.statistics : []) {
    const row = record(item)
    if (!row || (row.filterId !== undefined && row.filterId !== null && Number(row.filterId) !== -1)) continue
    const id = positiveInt(row.id)
    const name = text(row.name, 48)
    const side = Number(row.competitorId) === homeId ? 'home' : Number(row.competitorId) === awayId ? 'away' : null
    if (id === null || !name || !side) continue
    let entry = entries.get(id)
    if (!entry) {
      if (entries.size >= MAX_STATS) continue
      const order = Number(row.order)
      const categoryOrder = Number(row.categoryOrder)
      entry = {
        id, name,
        order: Number.isFinite(order) ? order : 999,
        top: row.isTop === true,
        category: text(row.categoryName, 32),
        categoryOrder: Number.isFinite(categoryOrder) ? categoryOrder : 0,
      }
      entries.set(id, entry)
    }
    entry[side] = row
  }
  const sections = new Map<string, { title: string; rank: number; stats: (MatchStat & { order: number })[] }>()
  for (const entry of entries.values()) {
    if (!entry.home || !entry.away) continue
    const home = formatStatValue(entry.home.value)
    const away = formatStatValue(entry.away.value)
    if (!home || !away) continue
    let homeShare = share(entry.home.valuePercentage)
    let awayShare = share(entry.away.valuePercentage)
    const total = homeShare + awayShare
    if (total > 0) {
      homeShare /= total
      awayShare /= total
    }
    const marked = Number(entry.home.markedTeam ?? entry.away.markedTeam)
    let better: 0 | 1 | null = marked === 1 ? 0 : marked === 2 ? 1 : null
    let values: [string, string] = [home, away]
    let shares: [number, number] = [homeShare, awayShare]
    if (reversed) {
      values = [away, home]
      shares = [awayShare, homeShare]
      better = better === null ? null : better === 0 ? 1 : 0
    }
    const title = entry.top ? 'Principais' : entry.category || 'Geral'
    const rank = entry.top ? -1 : entry.category ? entry.categoryOrder : Number.MAX_SAFE_INTEGER
    const section = sections.get(title) ?? { title, rank, stats: [] }
    section.stats.push({ id: entry.id, name: entry.name, values, shares, better, order: entry.order })
    sections.set(title, section)
  }
  const list = [...sections.values()].sort((a, b) => a.rank - b.rank)
  return {
    live,
    teams: reversed ? [names[1], names[0]] : names,
    sections: list.map((section) => ({
      title: section.title,
      stats: section.stats.sort((a, b) => a.order - b.order || a.id - b.id).map(({ order: _order, ...stat }) => stat),
    })),
  }
}
