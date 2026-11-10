import type { BllEvent } from './bll-batch.ts'
import { teamQualifiers, teamTokens } from './livescore-365.ts'
import { extractMatchLabel, splitMatchTeams } from './match-label.ts'

/** What Auto mode opens from a competition: every game, only games of a main team, or nothing. */
export type CompetitionMode = 'all' | 'teams' | 'off'
export type CompetitionRule = {
  id: string
  label: string
  region: 'Brasil' | 'Europa'
  kind: 'liga' | 'copa'
  /** Country (or region) the BLL writes before the league ("England, FA Cup"); `names` only count after one of these. */
  countries?: readonly string[]
  names: readonly string[]
  /** Names that need no country ("UEFA Champions League", "Copa do Brasil"). */
  alone?: readonly string[]
}
export type CustomCompetition = { name: string; mode: CompetitionMode }
/** Where Auto mode looks for games: the BLL list, the lives of the YouTube channel list, or both. */
export type AutoOpenSources = { bll: boolean; youtube: boolean }
export type AutoOpenSettings = {
  sources: AutoOpenSources
  competitions: Record<string, CompetitionMode>
  custom: CustomCompetition[]
  /** Main teams, each "Name / alias / alias". */
  teams: string[]
  /** Also open main-team games from competitions outside the list. */
  teamsAnywhere: boolean
}
export type AutoOpenCandidate = { url: string; name: string; mainTeam: boolean }
export type AutoOpenPanel = { id: string; url: string; auto: boolean; mainTeam: boolean }
export type AutoOpenPlan = {
  fill: Array<{ panelId: string; url: string }>
  extra: string[]
  /** Panels Auto mode opened for a game without a main team, given to a main-team game. */
  replace: Array<{ panelId: string; url: string }>
  /** Games without a main team left out because every panel is taken. */
  skipped: number
}

export const MAX_TEAMS = 60
export const MAX_CUSTOM_COMPETITIONS = 30
const MAX_ENTRY = 120
const STORAGE_KEY = 'quadra:auto-open'
const MODES: readonly CompetitionMode[] = ['all', 'teams', 'off']
export const COMPETITION_MODE_LABEL: Record<CompetitionMode, string> = { all: 'Todos os jogos', teams: 'Só times principais', off: 'Desligada' }

const ENGLAND = ['england', 'inglaterra']
const SPAIN = ['spain', 'espanha', 'espana']
const ITALY = ['italy', 'italia']
const GERMANY = ['germany', 'alemanha', 'deutschland']
const FRANCE = ['france', 'franca']
const BRAZIL = ['brazil', 'brasil']
/** What the BLL may write before a UEFA competition. */
const EUROPE = ['europe', 'europa', 'uefa', 'international', 'internationalclubs', 'internacional', 'world', 'mundo']

export const COMPETITIONS: readonly CompetitionRule[] = [
  { id: 'brasileirao', label: 'Campeonato Brasileiro (Série A)', region: 'Brasil', kind: 'liga', countries: BRAZIL, names: ['serie a', 'brasileirao', 'brasileirao serie a', 'brasileiro serie a', 'campeonato brasileiro', 'campeonato brasileiro serie a', 'brasileirao betano'], alone: ['brasileirao', 'brasileirao serie a', 'brasileiro serie a', 'campeonato brasileiro serie a', 'brasileirao betano'] },
  { id: 'copa-do-brasil', label: 'Copa do Brasil', region: 'Brasil', kind: 'copa', countries: BRAZIL, names: ['copa do brasil', 'copa betano do brasil', 'cup', 'brazil cup'], alone: ['copa do brasil', 'copa betano do brasil'] },
  { id: 'supercopa-do-brasil', label: 'Supercopa do Brasil', region: 'Brasil', kind: 'copa', countries: BRAZIL, names: ['supercopa', 'supercopa do brasil', 'supercopa rei', 'super cup', 'supercup'], alone: ['supercopa do brasil'] },
  { id: 'champions-league', label: 'UEFA Champions League', region: 'Europa', kind: 'liga', countries: EUROPE, names: ['champions league', 'uefa champions league', 'liga dos campeoes'], alone: ['uefa champions league', 'liga dos campeoes da uefa'] },
  { id: 'europa-league', label: 'UEFA Europa League', region: 'Europa', kind: 'liga', countries: EUROPE, names: ['europa league', 'uefa europa league', 'liga europa'], alone: ['uefa europa league', 'liga europa da uefa'] },
  { id: 'conference-league', label: 'UEFA Conference League', region: 'Europa', kind: 'liga', countries: EUROPE, names: ['conference league', 'europa conference league', 'uefa conference league', 'uefa europa conference league', 'liga conferencia'], alone: ['uefa conference league', 'uefa europa conference league'] },
  { id: 'uefa-super-cup', label: 'Supercopa da UEFA', region: 'Europa', kind: 'copa', countries: EUROPE, names: ['super cup', 'supercup', 'uefa super cup', 'uefa supercup', 'supercopa da uefa'], alone: ['uefa super cup', 'uefa supercup', 'supercopa da uefa', 'supercopa uefa'] },
  { id: 'premier-league', label: 'Premier League (Inglaterra)', region: 'Europa', kind: 'liga', countries: ENGLAND, names: ['premier league', 'english premier league'], alone: ['english premier league'] },
  { id: 'laliga', label: 'LaLiga (Espanha)', region: 'Europa', kind: 'liga', countries: SPAIN, names: ['laliga', 'laliga ea sports', 'primera division', 'liga espanhola'], alone: ['laliga ea sports'] },
  { id: 'serie-a', label: 'Serie A (Itália)', region: 'Europa', kind: 'liga', countries: ITALY, names: ['serie a', 'serie a tim', 'serie a enilive', 'campeonato italiano'], alone: ['serie a tim', 'serie a enilive'] },
  { id: 'bundesliga', label: 'Bundesliga (Alemanha)', region: 'Europa', kind: 'liga', countries: GERMANY, names: ['bundesliga', '1 bundesliga', 'campeonato alemao'] },
  { id: 'ligue-1', label: 'Ligue 1 (França)', region: 'Europa', kind: 'liga', countries: FRANCE, names: ['ligue 1', 'ligue 1 mcdonalds', 'ligue 1 mcdonald s', 'ligue 1 uber eats', 'campeonato frances'] },
  { id: 'fa-cup', label: 'FA Cup (Inglaterra)', region: 'Europa', kind: 'copa', countries: ENGLAND, names: ['fa cup', 'emirates fa cup', 'copa da inglaterra'] },
  { id: 'efl-cup', label: 'Copa da Liga Inglesa (Carabao Cup)', region: 'Europa', kind: 'copa', countries: ENGLAND, names: ['efl cup', 'carabao cup', 'league cup', 'copa da liga inglesa'], alone: ['carabao cup'] },
  { id: 'community-shield', label: 'Supercopa da Inglaterra (Community Shield)', region: 'Europa', kind: 'copa', countries: ENGLAND, names: ['community shield', 'fa community shield', 'super cup', 'supercopa da inglaterra'], alone: ['community shield', 'fa community shield'] },
  { id: 'copa-del-rey', label: 'Copa del Rey (Espanha)', region: 'Europa', kind: 'copa', countries: SPAIN, names: ['copa del rey', 'copa do rei', 'cup'], alone: ['copa del rey'] },
  { id: 'supercopa-espana', label: 'Supercopa da Espanha', region: 'Europa', kind: 'copa', countries: SPAIN, names: ['supercopa', 'supercopa de espana', 'supercopa da espanha', 'super cup', 'supercup'], alone: ['supercopa de espana'] },
  { id: 'coppa-italia', label: 'Coppa Italia (Itália)', region: 'Europa', kind: 'copa', countries: ITALY, names: ['coppa italia', 'copa da italia', 'cup'], alone: ['coppa italia'] },
  { id: 'supercoppa-italiana', label: 'Supercoppa Italiana', region: 'Europa', kind: 'copa', countries: ITALY, names: ['supercoppa', 'supercoppa italiana', 'super cup', 'supercup', 'supercopa da italia'], alone: ['supercoppa italiana'] },
  { id: 'dfb-pokal', label: 'DFB-Pokal (Alemanha)', region: 'Europa', kind: 'copa', countries: GERMANY, names: ['dfb pokal', 'pokal', 'dfb cup', 'cup', 'copa da alemanha'], alone: ['dfb pokal'] },
  { id: 'dfl-supercup', label: 'Supercopa da Alemanha (DFL-Supercup)', region: 'Europa', kind: 'copa', countries: GERMANY, names: ['dfl supercup', 'supercup', 'super cup', 'supercopa da alemanha'], alone: ['dfl supercup'] },
  { id: 'coupe-de-france', label: 'Coupe de France (França)', region: 'Europa', kind: 'copa', countries: FRANCE, names: ['coupe de france', 'copa da franca', 'cup'], alone: ['coupe de france'] },
]

/** Domestic cups only open games of a main team; leagues, UEFA competitions and the Brazilian cups open every game. */
const TEAMS_ONLY = new Set(['fa-cup', 'efl-cup', 'community-shield', 'copa-del-rey', 'supercopa-espana', 'coppa-italia', 'supercoppa-italiana', 'dfb-pokal', 'dfl-supercup', 'coupe-de-france'])

export const DEFAULT_TEAMS: readonly string[] = [
  'Real Madrid', 'Barcelona / Barça', 'Atlético de Madrid / Atleti',
  'Manchester City / Man City', 'Liverpool', 'Arsenal', 'Manchester United / Man Utd', 'Chelsea', 'Tottenham / Tottenham Hotspur / Spurs',
  'Internazionale / Inter / Inter Milan / Inter de Milão', 'Juventus / Juve', 'Milan / AC Milan', 'Napoli / Nápoles', 'Roma',
  'Bayern de Munique / Bayern München / Bayern', 'Borussia Dortmund / Dortmund / BVB', 'Bayer Leverkusen / Leverkusen', 'RB Leipzig / Leipzig / RasenBallsport Leipzig',
  'Paris Saint-Germain / PSG / Paris SG', 'Monaco', 'Olympique de Marseille / Marseille', 'Lyon / Olympique Lyonnais',
]

export function defaultAutoOpenSettings(): AutoOpenSettings {
  return {
    sources: { bll: true, youtube: false },
    competitions: Object.fromEntries(COMPETITIONS.map((rule) => [rule.id, TEAMS_ONLY.has(rule.id) ? 'teams' : 'all'])),
    custom: [],
    teams: [...DEFAULT_TEAMS],
    teamsAnywhere: false,
  }
}

function cleanEntry(value: unknown) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY) : ''
}

function isMode(value: unknown): value is CompetitionMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

export function parseAutoOpenSettings(raw: string | null): AutoOpenSettings {
  const next = defaultAutoOpenSettings()
  if (!raw) return next
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof AutoOpenSettings, unknown>> | null
    const competitions = parsed?.competitions
    if (competitions && typeof competitions === 'object') {
      for (const rule of COMPETITIONS) {
        const mode = (competitions as Record<string, unknown>)[rule.id]
        if (isMode(mode)) next.competitions[rule.id] = mode
      }
    }
    if (Array.isArray(parsed?.custom)) {
      const seen = new Set<string>()
      next.custom = parsed.custom.flatMap((item) => {
        const name = cleanEntry((item as CustomCompetition | null)?.name)
        const mode = (item as CustomCompetition | null)?.mode
        const key = compact(name)
        if (!key || !isMode(mode) || seen.has(key)) return []
        seen.add(key)
        return [{ name, mode }]
      }).slice(0, MAX_CUSTOM_COMPETITIONS)
    }
    if (Array.isArray(parsed?.teams)) {
      const seen = new Set<string>()
      next.teams = parsed.teams.map(cleanEntry).filter((team) => {
        const key = teamKey(teamDisplayName(team))
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, MAX_TEAMS)
    }
    if (typeof parsed?.teamsAnywhere === 'boolean') next.teamsAnywhere = parsed.teamsAnywhere
    const sources = parsed?.sources
    if (sources && typeof sources === 'object') {
      const { bll, youtube } = sources as Partial<Record<keyof AutoOpenSources, unknown>>
      if (typeof bll === 'boolean') next.sources.bll = bll
      if (typeof youtube === 'boolean') next.sources.youtube = youtube
    }
  } catch {
    /* corrupt value: defaults */
  }
  return next
}

export function loadAutoOpenSettings() {
  try {
    return parseAutoOpenSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    return parseAutoOpenSettings(null)
  }
}

export function saveAutoOpenSettings(settings: AutoOpenSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable: the lists last only for this session */
  }
}

function plainWords(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** "La Liga" and "LaLiga", "DFB-Pokal" and "DFB Pokal" compare equal. */
function compact(value: string) {
  return plainWords(value).replace(/ /g, '')
}

/** Women's and youth competitions share names with the men's ones ("UEFA Champions League Women"). */
const NOT_MAIN_SIDE = /\b(?:women|womens|feminin[oa]|femenin[oa]|femminile|frauen|feminine|youth|juvenil|primavera)\b|\b(?:u|sub)[- ]?\d{2}\b/i

const RULE_KEYS = COMPETITIONS.map((rule) => ({
  rule,
  countries: new Set((rule.countries ?? []).map(compact)),
  names: new Set(rule.names.map(compact)),
  alone: new Set((rule.alone ?? []).map(compact)),
}))

/** The listed competition of a BLL competition ("England, FA Cup, Round 3"), or null. */
export function competitionRuleOf(competition: string): CompetitionRule | null {
  if (NOT_MAIN_SIDE.test(competition)) return null
  const parts = competition.split(',').map(compact)
  const [first = '', second = ''] = parts
  for (const { rule, countries, names, alone } of RULE_KEYS) {
    if (countries.has(first) && names.has(second)) return rule
    if (alone.has(first) || alone.has(second)) return rule
  }
  return null
}

/** A competition the user added, written as the BLL shows it: the whole league ("Portugal, Liga Portugal") or just its name. */
export function matchesCustomCompetition(competition: string, name: string) {
  const key = compact(name)
  if (!key) return false
  const parts = competition.split(',')
  const league = parts.slice(0, 2).join(',')
  return compact(league) === key || compact(parts[1] ?? '') === key || compact(parts[0] ?? '') === key
}

/** Words the BLL or the user may add to a club name that don't tell clubs apart ("AS Roma", "SSC Napoli", "Bayer 04"). */
const EXTRA_CLUB_WORDS = new Set(['as', 'ssc', 'ogc', 'bv', 'vfl', 'cf', 'calcio', 'hotspur'])

function teamKey(name: string) {
  return teamTokens(name).filter((token) => !EXTRA_CLUB_WORDS.has(token) && !/^\d+$/.test(token)).join(' ')
}

export function teamDisplayName(entry: string) {
  return entry.split('/')[0]?.trim() ?? ''
}

function teamAliases(entry: string) {
  return entry.split('/').map((part) => teamKey(part)).filter(Boolean)
}

/** The main team (display name) playing in this BLL game, or null. Names must match whole, so "Milan" is not "Inter Milan". */
export function mainTeamOf(gameName: string, teams: readonly string[]): string | null {
  const sides = splitMatchTeams(gameName)
  if (!sides || teamQualifiers(gameName).size > 0) return null
  const keys = [teamKey(sides.home), teamKey(sides.away)]
  for (const entry of teams) {
    const aliases = teamAliases(entry)
    if (keys.some((key) => key && aliases.includes(key))) return teamDisplayName(entry)
  }
  return null
}

/** Whether Auto mode opens this live BLL game, and if a main team plays in it. Only football: 🏀 and 🏈 share club names. */
export function autoOpenDecision(event: Pick<BllEvent, 'name' | 'competition' | 'basketball' | 'americanFootball'>, settings: AutoOpenSettings): { open: boolean; mainTeam: string | null } {
  if (event.basketball || event.americanFootball) return { open: false, mainTeam: null }
  const mainTeam = mainTeamOf(event.name, settings.teams)
  const rule = competitionRuleOf(event.competition)
  const custom = settings.custom.find((item) => matchesCustomCompetition(event.competition, item.name))
  const mode: CompetitionMode = rule ? settings.competitions[rule.id] ?? 'off' : custom?.mode ?? 'off'
  const listed = mode === 'all' || (mode === 'teams' && mainTeam !== null)
  const anywhere = settings.teamsAnywhere && mainTeam !== null && !NOT_MAIN_SIDE.test(event.competition)
  return { open: listed || anywhere, mainTeam }
}

/** Competition labels of YouTube titles (`detectCompetition`) that are listed competitions. */
const YOUTUBE_COMPETITION_RULES: Record<string, string> = {
  'Brasileirão': 'brasileirao',
  'Copa do Brasil': 'copa-do-brasil',
  'Champions League': 'champions-league',
  'Europa League': 'europa-league',
  'Conference League': 'conference-league',
  'Premier League': 'premier-league',
  'La Liga': 'laliga',
  'Ligue 1': 'ligue-1',
  'Bundesliga': 'bundesliga',
}
const YOUTUBE_OTHER_SPORTS = new Set(['NFL', 'NBA'])

/** Whole words of `name` inside `text` ("Libertadores" in "Flamengo x Racing | Libertadores 2026"). */
function hasWords(text: string, name: string) {
  const words = plainWords(name)
  return words.length > 0 && ` ${plainWords(text)} `.includes(` ${words} `)
}

/**
 * Whether Auto mode opens this YouTube live, and if a main team plays in it. `competition` is the label found in the
 * title (or the channel name); an added competition also counts when its name is in the title. Only football, men's first teams.
 */
export function youtubeAutoOpenDecision(live: { name: string; competition: string }, settings: AutoOpenSettings): { open: boolean; mainTeam: string | null } {
  if (YOUTUBE_OTHER_SPORTS.has(live.competition)) return { open: false, mainTeam: null }
  const mainTeam = mainTeamOf(extractMatchLabel(live.name) ?? live.name, settings.teams)
  const ruleId = YOUTUBE_COMPETITION_RULES[live.competition]
  const notMainSide = NOT_MAIN_SIDE.test(live.name) || NOT_MAIN_SIDE.test(live.competition)
  const custom = settings.custom.find((item) => (compact(item.name) === compact(live.competition) || hasWords(live.name, item.name)) &&
    (!notMainSide || NOT_MAIN_SIDE.test(item.name)))
  const mode: CompetitionMode = ruleId && !notMainSide ? settings.competitions[ruleId] ?? 'off' : custom?.mode ?? 'off'
  const listed = mode === 'all' || (mode === 'teams' && mainTeam !== null)
  const anywhere = settings.teamsAnywhere && mainTeam !== null && !notMainSide
  return { open: listed || anywhere, mainTeam }
}

/** The two teams of a game, in any order ("Flamengo x Palmeiras" = "AO VIVO: Palmeiras x Flamengo | Brasileirão"), or null. */
export function gameKey(name: string): string | null {
  const sides = splitMatchTeams(extractMatchLabel(name) ?? name)
  if (!sides) return null
  // A title without a separator leaves its tail on the second team ("Santos x São Paulo AO VIVO com imagens").
  const keys = [sides.home, sides.away].map((side) => teamKey(side.replace(/\s+(?:ao vivo|en vivo|live|com imagens?|agora|hoje)(?![\p{L}\d]).*$/iu, '')))
  return keys.every(Boolean) ? keys.sort().join(' x ') : null
}

/**
 * One panel per game: a game found more than once (on the BLL and on YouTube, or on two channels) keeps its first
 * candidate, in the order given (BLL first, then the most watched live), and a game already open in another panel is left out.
 */
export function mergeAutoOpenCandidates(candidates: readonly AutoOpenCandidate[], open: readonly { url: string; name: string }[]): AutoOpenCandidate[] {
  const taken = new Map<string, string>()
  for (const panel of open) {
    const key = panel.url ? gameKey(panel.name) : null
    if (key && !taken.has(key)) taken.set(key, panel.url)
  }
  const kept: AutoOpenCandidate[] = []
  for (const candidate of candidates) {
    const key = gameKey(candidate.name)
    const owner = key ? taken.get(key) : undefined
    if (owner !== undefined && owner !== candidate.url) continue
    if (key) taken.set(key, candidate.url)
    kept.push(candidate)
  }
  return kept
}

/**
 * Where each new game goes: empty panels first, then new panels up to `maxPanels`. When the grid is full,
 * a main-team game takes the panel of a game Auto mode opened without a main team (in the order given,
 * oldest first); games without a main team wait. Panels the user opened are never touched.
 */
export function planAutoOpen(panels: readonly AutoOpenPanel[], candidates: readonly AutoOpenCandidate[], maxPanels: number): AutoOpenPlan {
  const open = new Set(panels.map((panel) => panel.url).filter(Boolean))
  const pending: AutoOpenCandidate[] = []
  for (const candidate of candidates) {
    if (open.has(candidate.url)) continue
    open.add(candidate.url)
    pending.push(candidate)
  }
  pending.sort((a, b) => Number(b.mainTeam) - Number(a.mainTeam))
  const empties = panels.filter((panel) => !panel.url).map((panel) => panel.id)
  const replaceable = panels.filter((panel) => panel.url && panel.auto && !panel.mainTeam).map((panel) => panel.id)
  let room = Math.max(0, maxPanels - panels.length)
  const plan: AutoOpenPlan = { fill: [], extra: [], replace: [], skipped: 0 }
  for (const { url, mainTeam } of pending) {
    const empty = empties.shift()
    if (empty) plan.fill.push({ panelId: empty, url })
    else if (room > 0) {
      room -= 1
      plan.extra.push(url)
    } else if (mainTeam && replaceable.length > 0) plan.replace.push({ panelId: replaceable.shift()!, url })
    else plan.skipped += 1
  }
  return plan
}

export type AutoOpenSoundPanel = { id: string; url: string; muted: boolean }
export type AutoOpenSound = {
  /** Mute of each filled or replaced panel, by panel id. */
  panels: Map<string, boolean>
  /** Mute of each new panel, in the order of `plan.extra`. */
  extra: boolean[]
}

/**
 * Sound of the games a plan opens. A game Auto mode opens never plays over another one: it starts muted
 * whenever a game is already on screen (or opened just before it in the same plan), even if only some panels are muted.
 * Only the first game of an empty grid keeps the panel's own state (`allMuted` for a new panel).
 * A replaced panel keeps its sound: it is the same slot the user was listening to (or not).
 */
export function autoOpenSound(panels: readonly AutoOpenSoundPanel[], plan: AutoOpenPlan, allMuted: boolean): AutoOpenSound {
  let gameOpen = panels.some((panel) => panel.url)
  const sound: AutoOpenSound = { panels: new Map(), extra: [] }
  for (const { panelId } of plan.replace) sound.panels.set(panelId, panels.find((panel) => panel.id === panelId)?.muted ?? allMuted)
  for (const { panelId } of plan.fill) {
    sound.panels.set(panelId, (panels.find((panel) => panel.id === panelId)?.muted ?? allMuted) || gameOpen)
    gameOpen = true
  }
  for (let index = 0; index < plan.extra.length; index++) {
    sound.extra.push(allMuted || gameOpen)
    gameOpen = true
  }
  return sound
}

/** What the first search of Auto mode shows while it reads the lists: the panels it marks and how many temporary ones it adds. */
export interface AutoSearchPlaceholders {
  mark: string[]
  addTemporary: number
}

/** Panels shown on the start screen when Auto mode is turned on there: the same 4 screens the app starts with. */
export const AUTO_SEARCH_CHOOSER_PANELS = 4

/**
 * Skeleton screens of the first Auto search. From the start screen, 4 temporary panels; in the grid, the empty panels;
 * a full grid gets 1 temporary panel while it fits; at the maximum nothing (the status line is the feedback).
 */
export function autoSearchPlaceholders(options: { emptyPanelIds: readonly string[]; panelCount: number; maxPanels: number; fromChooser: boolean }): AutoSearchPlaceholders {
  if (options.fromChooser) return { mark: [], addTemporary: Math.min(AUTO_SEARCH_CHOOSER_PANELS, options.maxPanels) }
  if (options.emptyPanelIds.length > 0) return { mark: [...options.emptyPanelIds], addTemporary: 0 }
  return { mark: [], addTemporary: options.panelCount < options.maxPanels ? 1 : 0 }
}
