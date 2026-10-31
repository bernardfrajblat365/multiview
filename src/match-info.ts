import type { TeamRef365 } from './livescore-365.ts'
import { formatPlayerName } from './match-events.ts'

/** Abas da gaveta de informações do jogo. Escalação e tabela aparecem; as outras já estão previstas no tipo. */
export type InfoTabId = 'lineup' | 'standings' | 'odds' | 'games'

export const INFO_TABS: readonly { id: InfoTabId; label: string }[] = [
  { id: 'lineup', label: 'Escalação' },
  { id: 'standings', label: 'Tabela' },
]

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

function parseTeam(value: unknown, members: Map<number, Member>): LineupTeam | null {
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
      players.push({
        number: member.jersey,
        name: member.name,
        shortName: member.shortName,
        position,
        positionShort: positionShort(position),
        rating: Number.isFinite(ranking) && ranking > 0 ? ranking : null,
        photo: member.photo,
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
  const home = parseTeam(game.homeCompetitor, members)
  const away = parseTeam(game.awayCompetitor, members)
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
