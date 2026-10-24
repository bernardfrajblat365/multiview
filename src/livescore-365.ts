import type { MatchIncident } from './match-events.ts'
import { extractMatchLabel, splitMatchTeams } from './match-label.ts'
import { detectCompetition } from './youtube-lives.ts'

/** One game from the 365Scores web API (`/web/games/current`, `/web/games/allscores`). */
export type Game365 = {
  id: number
  home: string
  away: string
  /** Every name variant the API gives (name, longName, shortName). */
  homeNames: string[]
  awayNames: string[]
  competition: string
  startTime: number
  /** 1 scheduled, 2 scheduled or "Result. Final" in the live list, 3 live, 4 finished. */
  statusGroup: number
  statusText: string
}

export type Candidate365 = { id: number; label: string; detail: string }

/** Sent to the UI as `quadra:live-match` for each YouTube panel. */
export type LiveMatchStatus = {
  panelId: string
  status: 'off' | 'searching' | 'linked' | 'ambiguous' | 'none'
  label?: string
  /** `events`: cards and VAR too; `score`: the league has no incident data, so only goals (from the score) and red-card counts. */
  coverage?: 'events' | 'score' | null
  candidates?: Candidate365[]
}

export type MatchResult =
  | { status: 'matched'; game: Game365 }
  | { status: 'ambiguous'; candidates: Game365[] }
  | { status: 'none' }

export type Side365 = { id: number; name: string; score: number; redCards: number }

/** `/web/game/?gameId=` reduced to what the alerts need. `events` is null for leagues without incident coverage. */
export type Detail365 = {
  id: number
  statusGroup: number
  gameTime: number
  home: Side365
  away: Side365
  events: Event365[] | null
  /** The game's live commentary feed: the only source of "penalty awarded" and VAR decisions. Null when the game has none. */
  pbpUrl: string | null
}

/** One line of the 365Scores live commentary (`pbpgenerator.365scores.com`). */
export type PbpMessage = { id: number; type: number; minute: number; competitorNum: number; comment: string }

export type Event365 = { order: number; typeId: number; subTypeId: number; competitorId: number; gameTime: number }

export type LiveState = {
  seeded: boolean
  seen: Set<string>
  home: number
  away: number
  homeRed: number
  awayRed: number
  /** Goals and red cards already alerted per side, from events or from the score, so one source never repeats the other. */
  alertedGoals: { home: number; away: number }
  alertedReds: { home: number; away: number }
  /** When the score first ran ahead of the alerted goals: the goal event gets a few seconds to arrive with its details. */
  scoreAheadSince: { home: number; away: number }
  pbpSeeded: boolean
  pbpSeen: Set<number>
  /** VAR alerts already sent, so the same review reported by both feeds alerts once. */
  recentVar: Array<{ team: MatchIncident['team']; minute: number }>
}

const MAX_NAME = 80
/** A busy day's schedule passes 800 games; cutting it lost games further down the list. */
const MAX_GAMES = 4000
const MAX_EVENTS = 300
/** Leagues with events sometimes list a goal late or never (score 1-2, events 1-1): the score alerts it after this. */
export const GOAL_EVENT_GRACE_MS = 9000
/** Both teams must score at least this to link without asking. */
const LINK_SCORE = 0.85
/** …and the runner-up must trail by this much. */
const LINK_MARGIN = 0.15
const CANDIDATE_SCORE = 0.5
const MAX_CANDIDATES = 3

/** 365Scores event type ids (no dictionary in the API; observed in October 2026). */
const TYPE_GOAL = 1
const TYPE_YELLOW = 2
const TYPE_RED = 3
const TYPE_PENALTY_MISSED = 6
const TYPE_GOAL_DISALLOWED = 11
/** Commentary message types (`Type` in the feed). */
const PBP_VAR_DECISION = 8
const PBP_PENALTY_WON = 28
const PBP_VAR_CANCELLED_GOAL = 48
const PBP_HOST = /^pbpgenerator\.365scores\.com$/i
const MAX_PBP = 400
/** Two VAR reports for the same team this close together are the same review. */
const VAR_REPEAT_MINUTES = 3
const SUBTYPE_OWN_GOAL = 2
const SUBTYPE_PENALTY_GOAL = 3
const SUBTYPE_SECOND_YELLOW = 21

const CLUB_WORDS = new Set(['fc', 'cf', 'sc', 'ac', 'ec', 'cr', 'se', 'ca', 'afc', 'cd', 'sad', 'club', 'clube', 'de', 'da', 'do', 'del', 'la', 'el', 'the', 'and', 'e'])
/** Words shared by many clubs; a title naming a team only by these is ambiguous. */
const GENERIC_WORDS = new Set(['atletico', 'real', 'inter', 'internacional', 'sporting', 'nacional', 'united', 'city', 'sport', 'athletic', 'racing', 'deportivo', 'union', 'olympique', 'dynamo', 'dinamo', 'america', 'universidad', 'independiente', 'estudiantes', 'santa', 'sao', 'saint', 'st', 'fk', 'sk', 'ks'])
/** State and city suffixes written either way ("Atlético-MG" / "Atlético Mineiro"). */
const TOKEN_ALIASES: Record<string, string> = {
  mg: 'mineiro', pr: 'paranaense', go: 'goianiense', sp: 'paulista', rj: 'carioca', athletico: 'atletico', utd: 'united', man: 'manchester',
  // City names written in Portuguese or English in titles, local in 365Scores ("Slavia Praga" / "Slavia Praha").
  praga: 'praha', prague: 'praha', moscou: 'moscow', moskva: 'moscow', bucareste: 'bucuresti', bucharest: 'bucuresti',
}
/** Nicknames used in Brazilian titles. Keys and values are normalized names. */
const NICKNAMES: Record<string, string> = {
  galo: 'atletico mineiro', fogao: 'botafogo', verdao: 'palmeiras', timao: 'corinthians', mengao: 'flamengo', peixe: 'santos',
  'vasco da gama': 'vasco', cap: 'atletico paranaense', bragantino: 'red bull bragantino', 'rb bragantino': 'red bull bragantino',
}
/** Words in a YouTube title around the team names that are not part of them. */
const TITLE_NOISE = /\b(?:ao vivo(?: e com imagens?)?|com imagens?|en vivo|live|hoje|agora|assista(?: agora)?|assistir|onde assistir|transmiss[aã]o|online|gr[aá]tis|jogo|partida|narra[cç][aã]o)\b/gi
const AGE_QUALIFIER = /\b(?:sub|u)[- ]?(\d{2})\b/i
const WOMEN_QUALIFIER = /\(f\)|\bfeminin[oa]\b|\bwomen\b|\(w\)/i
/** Only read from team names: "Série B" in a title is not a reserve side. */
const RESERVE_QUALIFIER = /\bii\b|\breservas?\b/i

function cleanText(value: unknown, max = MAX_NAME) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function plainWords(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * "Sub-17", "(F)", "II": a youth, women's or reserve side must match the same kind of side.
 * Age and women's markers may sit anywhere in a title ("Brasileirão Feminino"); reserves only in team names.
 */
export function teamQualifiers(text: string, teamNames: string = text) {
  const found = new Set<string>()
  const age = AGE_QUALIFIER.exec(text)
  if (age) found.add(`u${age[1]}`)
  if (WOMEN_QUALIFIER.test(text)) found.add('women')
  if (RESERVE_QUALIFIER.test(teamNames)) found.add('reserve')
  return found
}

export function teamTokens(name: string): string[] {
  let words = plainWords(name.replace(/\(f\)|\(w\)/gi, ' '))
    .replace(/\b(?:sub|u)\s?\d{2}\b|\bfeminin[oa]\b|\bwomen\b|\breservas?\b/g, ' ')
  words = NICKNAMES[words.trim()] ?? words
  return words
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token && !CLUB_WORDS.has(token) && token !== 'ii' && token !== 'f' && token !== 'w')
}

function tokensMatch(a: string, b: string) {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

/** 0..1 similarity of two team names: Dice coefficient over tokens, with prefix matches ("Man" ~ "Manchester"). */
export function teamSimilarity(a: string, b: string) {
  const left = teamTokens(a)
  const right = teamTokens(b)
  if (left.length === 0 || right.length === 0) return 0
  if (left.join(' ') === right.join(' ')) return 1
  const used = new Set<number>()
  let matched = 0
  for (const token of left) {
    const index = right.findIndex((other, position) => !used.has(position) && tokensMatch(token, other))
    if (index < 0) continue
    used.add(index)
    matched += 1
  }
  // "Kairat" for "Kairat Almaty": every word of the shorter name is in the longer one.
  // "Atlético" or "Real" alone names many clubs, so that only makes a candidate, never a link.
  if (matched === Math.min(left.length, right.length)) {
    const shorter = left.length <= right.length ? left : right
    return shorter.every((token) => GENERIC_WORDS.has(token)) ? 0.7 : 0.9
  }
  return (2 * matched) / (left.length + right.length)
}

function bestSimilarity(name: string, variants: readonly string[]) {
  return Math.max(0, ...variants.map((variant) => teamSimilarity(name, variant)))
}

function cleanTitleTeam(value: string, side: 'home' | 'away') {
  let text = value.replace(/#\S+/g, ' ').replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ').replace(/\b20\d\d\b/g, ' ')
  // "AO VIVO: Flamengo" / "Palmeiras (Brasileirão)": keep the side next to the "x".
  if (side === 'home') text = text.split(/[:|]/).at(-1) ?? text
  else text = text.split(/[:|([–—]|\s-\s/)[0] ?? text
  text = text.replace(TITLE_NOISE, ' ').replace(/[^\p{L}\p{N}\s'.()-]/gu, ' ')
  return text.replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '').trim()
}

/** Teams named in a YouTube live title, or null when there is no "A x B". */
export function teamsFromTitle(title: string): { home: string; away: string; qualifiers: Set<string>; competition: string | null } | null {
  const label = extractMatchLabel(title)
  const teams = label ? splitMatchTeams(label.replace(/…$/, '')) : null
  if (!teams) return null
  const home = cleanTitleTeam(teams.home, 'home')
  const away = cleanTitleTeam(teams.away, 'away')
  if (teamTokens(home).length === 0 || teamTokens(away).length === 0) return null
  return { home, away, qualifiers: teamQualifiers(title, `${teams.home} ${teams.away}`), competition: detectCompetition(title) }
}

function competitorNames(raw: Record<string, unknown>) {
  const names = [raw.name, raw.longName, raw.shortName].map((value) => cleanText(value)).filter(Boolean)
  return [...new Set(names)]
}

/** Validates a games list response. Unknown shapes give an empty list. */
export function parseGameList(raw: unknown): Game365[] {
  const games = raw && typeof raw === 'object' ? (raw as { games?: unknown }).games : null
  if (!Array.isArray(games)) return []
  const parsed: Game365[] = []
  for (const row of games.slice(0, MAX_GAMES)) {
    if (!row || typeof row !== 'object') continue
    const game = row as Record<string, unknown>
    const id = Number(game.id)
    const home = game.homeCompetitor && typeof game.homeCompetitor === 'object' ? game.homeCompetitor as Record<string, unknown> : null
    const away = game.awayCompetitor && typeof game.awayCompetitor === 'object' ? game.awayCompetitor as Record<string, unknown> : null
    if (!Number.isSafeInteger(id) || id <= 0 || !home || !away || (game.sportId !== undefined && game.sportId !== 1)) continue
    const homeNames = competitorNames(home)
    const awayNames = competitorNames(away)
    if (homeNames.length === 0 || awayNames.length === 0) continue
    const startTime = typeof game.startTime === 'string' ? Date.parse(game.startTime) : Number.NaN
    parsed.push({
      id,
      home: homeNames[0],
      away: awayNames[0],
      homeNames,
      awayNames,
      competition: cleanText(game.competitionDisplayName),
      startTime: Number.isFinite(startTime) ? startTime : 0,
      statusGroup: finiteNumber(game.statusGroup),
      statusText: cleanText(game.statusText, 40),
    })
  }
  return parsed
}

/** Merges several lists; the first list wins for a game present in more than one. */
export function mergeGameLists(...lists: Game365[][]): Game365[] {
  const byId = new Map<number, Game365>()
  for (const list of lists) for (const game of list) if (!byId.has(game.id)) byId.set(game.id, game)
  return [...byId.values()]
}

function qualifiersOf(game: Game365) {
  return teamQualifiers(`${game.homeNames.join(' ')} ${game.awayNames.join(' ')}`)
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

/**
 * `fit`: how well the game's teams match the title's (either order), 0..1.
 * `rank`: fit plus small nudges toward a live game, today's games and the title's competition.
 */
export function scoreGame(teams: NonNullable<ReturnType<typeof teamsFromTitle>>, game: Game365, now: number) {
  const straight = Math.min(bestSimilarity(teams.home, game.homeNames), bestSimilarity(teams.away, game.awayNames))
  const reversed = Math.min(bestSimilarity(teams.home, game.awayNames), bestSimilarity(teams.away, game.homeNames))
  let fit = Math.max(straight, reversed)
  if (fit === 0) return { fit: 0, rank: 0 }
  // A youth/women's/reserve side never links on its own to a senior one (or the other way round).
  if (!sameSet(teams.qualifiers, qualifiersOf(game))) fit = Math.min(fit, LINK_SCORE - 0.01)
  let rank = fit
  if (game.statusGroup === 3) rank += 0.05
  else if (game.statusGroup === 4) rank -= 0.1
  else if (game.startTime && Math.abs(game.startTime - now) > 3 * 3600_000) rank -= 0.2
  if (teams.competition && teamSimilarity(teams.competition, game.competition) >= 0.5) rank += 0.05
  return { fit, rank }
}

/** Links only when one game clearly fits both teams; otherwise returns up to three candidates for the user. */
export function matchGame(title: string, games: readonly Game365[], now: number): MatchResult {
  const teams = teamsFromTitle(title)
  if (!teams) return { status: 'none' }
  const ranked = games
    .map((game) => ({ game, ...scoreGame(teams, game, now) }))
    .filter((entry) => entry.fit >= CANDIDATE_SCORE)
    .sort((a, b) => b.rank - a.rank)
  if (ranked.length === 0) return { status: 'none' }
  const [best, second] = ranked
  if (best.fit >= LINK_SCORE && (!second || best.rank - second.rank >= LINK_MARGIN)) return { status: 'matched', game: best.game }
  return { status: 'ambiguous', candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => entry.game) }
}

/** A detail answers in ~0.1 s: wait 4 s at first, then longer in case the API is slow rather than stuck. */
export const DETAIL_TIMEOUT_MS = 4000
export const SLOW_DETAIL_TIMEOUT_MS = 10_000
/** A stuck or dropped request is retried at once this many times before waiting between tries. */
export const QUICK_RETRIES = 3
const POLL_RETRY_MS = 3000
const MAX_STALL_DELAY_MS = 15_000
const MAX_HTTP_DELAY_MS = 60_000

/** Time limit for the next detail request, after `failures` failed ones in a row. */
export function detailTimeoutMs(failures: number) {
  return failures >= 2 ? SLOW_DETAIL_TIMEOUT_MS : DETAIL_TIMEOUT_MS
}

/**
 * Wait before the next try after `failures` failures in a row. A request that hung or
 * dropped (`stall`) is usually a one-off on the API's side: retry at once, then back off
 * gently. An HTTP error means the API answered no (rate limit, outage): back off more.
 */
export function retryDelayMs(failures: number, kind: 'stall' | 'http') {
  if (kind === 'stall') {
    if (failures <= QUICK_RETRIES) return 0
    return Math.min(MAX_STALL_DELAY_MS, POLL_RETRY_MS * 2 ** (failures - QUICK_RETRIES - 1))
  }
  return Math.min(MAX_HTTP_DELAY_MS, POLL_RETRY_MS * 2 ** Math.min(failures, 5))
}

/** Same key, same link: a YouTube video id, or the path of any other page (a BLL `/view/<id>` player). */
export function sourceKeyOf(url: string) {
  try {
    const parsed = new URL(url)
    const youtubeId = parsed.searchParams.get('v') ?? /^\/live\/([^/?#]+)/.exec(parsed.pathname)?.[1]
    if (youtubeId) return youtubeId
    return /^https?:$/.test(parsed.protocol) ? `${parsed.origin}${parsed.pathname}` : ''
  } catch {
    return ''
  }
}

export function candidateOf(game: Game365): Candidate365 {
  const detail = [game.competition, game.statusText].filter(Boolean).join(' · ')
  return { id: game.id, label: `${game.home} x ${game.away}`, detail }
}

function parseSide(raw: unknown): Side365 | null {
  if (!raw || typeof raw !== 'object') return null
  const side = raw as Record<string, unknown>
  const id = Number(side.id)
  const name = competitorNames(side)[0]
  if (!Number.isSafeInteger(id) || !name) return null
  return { id, name, score: Math.max(0, finiteNumber(side.score)), redCards: Math.max(0, finiteNumber(side.redCards)) }
}

/** Validates a `/web/game/` response. */
export function parseGameDetail(raw: unknown): Detail365 | null {
  const game = raw && typeof raw === 'object' ? (raw as { game?: unknown }).game : null
  if (!game || typeof game !== 'object') return null
  const row = game as Record<string, unknown>
  const id = Number(row.id)
  const home = parseSide(row.homeCompetitor)
  const away = parseSide(row.awayCompetitor)
  if (!Number.isSafeInteger(id) || !home || !away) return null
  let events: Event365[] | null = null
  if (Array.isArray(row.events)) {
    events = []
    for (const item of row.events.slice(0, MAX_EVENTS)) {
      if (!item || typeof item !== 'object') continue
      const event = item as Record<string, unknown>
      const type = event.eventType && typeof event.eventType === 'object' ? event.eventType as Record<string, unknown> : null
      const order = Number(event.order)
      if (!type || !Number.isSafeInteger(order)) continue
      events.push({
        order,
        typeId: finiteNumber(type.id, -1),
        subTypeId: finiteNumber(type.subTypeId, -1),
        competitorId: finiteNumber(event.competitorId, -1),
        gameTime: Math.max(0, Math.floor(finiteNumber(event.gameTime))),
      })
    }
  }
  // Counting goals per side follows the list order, so keep it chronological whatever the API sends.
  events?.sort((a, b) => a.order - b.order)
  const pbp = row.playByPlay && typeof row.playByPlay === 'object' ? (row.playByPlay as Record<string, unknown>).feedURL : null
  return { id, statusGroup: finiteNumber(row.statusGroup), gameTime: Math.max(0, Math.floor(finiteNumber(row.gameTime))), home, away, events, pbpUrl: pbpFeedUrl(pbp) }
}

/** Only the commentary host, always over HTTPS (the API hands out some links as http). */
export function pbpFeedUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null
  try {
    const url = new URL(value)
    if (!PBP_HOST.test(url.hostname) || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

/** Validates a commentary response (`{ Messages: [...] }`). */
export function parsePbpFeed(raw: unknown): PbpMessage[] {
  const messages = raw && typeof raw === 'object' ? (raw as { Messages?: unknown }).Messages : null
  if (!Array.isArray(messages)) return []
  const parsed: PbpMessage[] = []
  for (const item of messages.slice(0, MAX_PBP)) {
    if (!item || typeof item !== 'object') continue
    const message = item as Record<string, unknown>
    const id = Number(message.Id)
    if (!Number.isSafeInteger(id)) continue
    parsed.push({
      id,
      type: finiteNumber(message.Type, -1),
      // "90+3" → 90.
      minute: Math.max(0, Number.parseInt(String(message.Timeline ?? ''), 10) || 0),
      competitorNum: finiteNumber(message.CompetitorNum),
      comment: cleanText(message.Comment, 300),
    })
  }
  return parsed
}

/** "Decisão do VAR: Não Há Gol Al Ittihad 1-0 …" → "gol anulado". */
export function varDecisionNote(comment: string) {
  const text = plainWords(comment.replace(/^.*?decis[aã]o do var\s*:?/i, ''))
  if (/^(?:nao ha gol|no goal)/.test(text)) return 'gol anulado'
  if (/^(?:nao ha penalti|no penalty)/.test(text)) return 'pênalti cancelado'
  if (/^(?:nao ha cartao|no red card|no card)/.test(text)) return 'cartão cancelado'
  if (/^(?:penalti|penalty)/.test(text)) return 'pênalti'
  if (/^(?:cartao vermelho|red card)/.test(text)) return 'cartão vermelho'
  if (/^(?:gol|goal)/.test(text)) return 'gol confirmado'
  return 'revisão'
}

/** The side a commentary line is about: its competitor number, else the team named in its first sentence. */
function pbpTeam(message: PbpMessage, detail: Detail365): MatchIncident['team'] {
  if (message.competitorNum === 1) return 'home'
  if (message.competitorNum === 2) return 'away'
  const sentence = plainWords(message.comment.split('.')[0] ?? '')
  const home = sentence.includes(plainWords(detail.home.name))
  const away = sentence.includes(plainWords(detail.away.name))
  return home === away ? 'match' : home ? 'home' : 'away'
}

/** Commentary lines that alert: penalty awarded and VAR decisions. Goals and cards come from the events, which are faster. */
export function classifyPbp(message: PbpMessage, detail: Detail365): MatchIncident | null {
  const base = { id: `365pbp:${detail.id}:${message.id}`, team: pbpTeam(message, detail), minute: message.minute, ownGoal: false, timestamp: 0, note: '' }
  switch (message.type) {
    case PBP_PENALTY_WON:
      return { ...base, kind: 'penalty' }
    case PBP_VAR_DECISION:
      return { ...base, kind: 'var', note: varDecisionNote(message.comment) }
    case PBP_VAR_CANCELLED_GOAL:
      return { ...base, kind: 'var', note: 'gol anulado' }
    default:
      return null
  }
}

/** Like `diffDetail` for the commentary: the first read only records what was already there. */
export function diffPbp(state: LiveState, messages: readonly PbpMessage[], detail: Detail365): MatchIncident[] {
  const fresh: MatchIncident[] = []
  for (const message of messages) {
    if (state.pbpSeen.has(message.id)) continue
    state.pbpSeen.add(message.id)
    const incident = state.pbpSeeded ? classifyPbp(message, detail) : null
    if (incident) fresh.push(incident)
  }
  state.pbpSeeded = true
  return fresh
}

/**
 * One VAR review shows up as up to three reports (the event "gol anulado", the commentary's
 * decision and its "VAR cancelled goal"): only the first one for a team within a few minutes alerts.
 */
export function dropRepeatedVar(state: LiveState, incidents: readonly MatchIncident[]): MatchIncident[] {
  return incidents.filter((incident) => {
    if (incident.kind !== 'var') return true
    const repeat = state.recentVar.some((sent) => sent.team === incident.team && Math.abs(sent.minute - incident.minute) <= VAR_REPEAT_MINUTES)
    if (repeat) return false
    state.recentVar = [...state.recentVar.slice(-19), { team: incident.team, minute: incident.minute }]
    return true
  })
}

function sideOf(detail: Detail365, competitorId: number): MatchIncident['team'] {
  if (competitorId === detail.home.id) return 'home'
  if (competitorId === detail.away.id) return 'away'
  return 'match'
}

/** Maps one 365Scores event to an alert, or null for events that never alert (substitutions, woodwork…). */
export function classifyEvent365(event: Event365, detail: Detail365): MatchIncident | null {
  // No subtype in the key: 365Scores re-labels events later (a penalty goal became a field goal a minute on), and that is not a new goal.
  const base = { id: `365:${detail.id}:${event.order}:${event.typeId}`, team: sideOf(detail, event.competitorId), minute: event.gameTime, ownGoal: false, timestamp: 0, note: '' }
  switch (event.typeId) {
    case TYPE_GOAL:
      if (event.subTypeId === SUBTYPE_OWN_GOAL) return { ...base, kind: 'goal', ownGoal: true }
      return { ...base, kind: 'goal', note: event.subTypeId === SUBTYPE_PENALTY_GOAL ? 'pênalti' : '' }
    case TYPE_YELLOW:
      return { ...base, kind: 'yellow' }
    case TYPE_RED:
      return { ...base, kind: 'red', note: event.subTypeId === SUBTYPE_SECOND_YELLOW ? '2º amarelo' : '' }
    case TYPE_PENALTY_MISSED:
      return { ...base, kind: 'penalty', note: 'perdido' }
    case TYPE_GOAL_DISALLOWED:
      return { ...base, kind: 'var', note: 'gol anulado' }
    default:
      return null
  }
}

export function createLiveState(): LiveState {
  return {
    seeded: false, seen: new Set(), home: 0, away: 0, homeRed: 0, awayRed: 0,
    alertedGoals: { home: 0, away: 0 }, alertedReds: { home: 0, away: 0 }, scoreAheadSince: { home: 0, away: 0 },
    pbpSeeded: false, pbpSeen: new Set(), recentVar: [],
  }
}

/** Goals and red cards per side in the events list, the way the score counts them (own goals go to the side credited). */
function eventCounts(detail: Detail365) {
  const counts = { goal: { home: 0, away: 0 }, red: { home: 0, away: 0 } }
  for (const event of detail.events ?? []) {
    const incident = classifyEvent365(event, detail)
    if (incident && (incident.kind === 'goal' || incident.kind === 'red') && incident.team !== 'match') counts[incident.kind][incident.team] += 1
  }
  return counts
}

/**
 * Alerts for what changed since the previous poll. The first poll only records the
 * match state (the panel opened mid-game), so history never alerts.
 *
 * Events give the details (penalty, own goal, cards) but can lag or miss a goal, and a
 * game with nothing yet has no events list at all (a 0-0 in a covered league looks like
 * a score-only one). So the score is the truth for goals: one the events have not shown
 * within `GOAL_EVENT_GRACE_MS` (at once without events) alerts from the score, and an
 * event for a goal or red card already alerted that way stays quiet.
 */
export function diffDetail(state: LiveState, detail: Detail365, now = Date.now()): MatchIncident[] {
  const fresh: MatchIncident[] = []
  const sides = ['home', 'away'] as const
  if (!state.seeded) {
    const counts = eventCounts(detail)
    for (const event of detail.events ?? []) {
      const incident = classifyEvent365(event, detail)
      if (incident) state.seen.add(incident.id)
    }
    for (const team of sides) {
      state.alertedGoals[team] = Math.max(detail[team].score, counts.goal[team])
      state.alertedReds[team] = Math.max(detail[team].redCards, counts.red[team])
    }
  } else {
    const ordinal = { goal: { home: 0, away: 0 }, red: { home: 0, away: 0 } }
    for (const event of detail.events ?? []) {
      const incident = classifyEvent365(event, detail)
      if (!incident) continue
      const counted = (incident.kind === 'goal' || incident.kind === 'red') && incident.team !== 'match' ? incident.kind : null
      if (counted && incident.team !== 'match') ordinal[counted][incident.team] += 1
      if (state.seen.has(incident.id)) continue
      state.seen.add(incident.id)
      if (counted && incident.team !== 'match') {
        const alerted = counted === 'goal' ? state.alertedGoals : state.alertedReds
        const n = ordinal[counted][incident.team]
        if (n <= alerted[incident.team]) continue
        alerted[incident.team] = n
      }
      fresh.push(incident)
    }
    const push = (kind: MatchIncident['kind'], team: 'home' | 'away', key: string, note = '') => {
      fresh.push({ id: `365:${detail.id}:${key}`, kind, team, minute: detail.gameTime, ownGoal: false, timestamp: 0, note })
    }
    for (const team of sides) {
      const score = detail[team].score
      const before = team === 'home' ? state.home : state.away
      if (score < before) {
        state.alertedGoals[team] = Math.min(state.alertedGoals[team], score)
        // A goal taken back off the board is the VAR (or a data fix); with events, their "goal disallowed" says it.
        if (!detail.events) push('var', team, `score:${team}:${before}-${score}`, 'gol anulado')
      }
      const alerted = state.alertedGoals[team]
      if (score > alerted) {
        if (!state.scoreAheadSince[team]) state.scoreAheadSince[team] = now
        if (!detail.events || now - state.scoreAheadSince[team] >= GOAL_EVENT_GRACE_MS) {
          for (let goal = alerted + 1; goal <= Math.min(score, alerted + 3); goal += 1) push('goal', team, `score:${team}:${goal}`)
          state.alertedGoals[team] = score
          state.scoreAheadSince[team] = 0
        }
      } else {
        state.scoreAheadSince[team] = 0
      }
      // Red-card counts only come with games without events (the poller reads them from the games list).
      const reds = detail[team].redCards
      if (!detail.events && reds > state.alertedReds[team]) {
        for (let red = state.alertedReds[team] + 1; red <= Math.min(reds, state.alertedReds[team] + 2); red += 1) push('red', team, `red:${team}:${red}`)
        state.alertedReds[team] = reds
      }
    }
  }
  state.seeded = true
  state.home = detail.home.score
  state.away = detail.away.score
  state.homeRed = detail.home.redCards
  state.awayRed = detail.away.redCards
  return fresh
}

/** Red cards of one game from the games list (`/web/games/?games=<id>`); the game detail does not carry them. */
export function parseRedCards(raw: unknown, gameId: number): { home: number; away: number } | null {
  const games = raw && typeof raw === 'object' ? (raw as { games?: unknown }).games : null
  if (!Array.isArray(games)) return null
  const row = games.find((game) => game && typeof game === 'object' && Number((game as { id?: unknown }).id) === gameId) as Record<string, unknown> | undefined
  if (!row) return null
  const reds = (side: unknown) => side && typeof side === 'object' ? Math.max(0, finiteNumber((side as { redCards?: unknown }).redCards)) : 0
  return { home: reds(row.homeCompetitor), away: reds(row.awayCompetitor) }
}
