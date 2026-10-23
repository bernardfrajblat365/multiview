import type { BllEvent } from './bll-batch.ts'
import { stripSoundMarkers } from './match-label.ts'

export type YoutubeLive = BllEvent & { channel: string }
export type YoutubeLivesResult =
  | { status: 'ok'; events: YoutubeLive[] }
  | { status: 'no-key' | 'invalid-key' | 'api-disabled' | 'quota' | 'unavailable' }

const MAX_TEXT = 200
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
/** Google API keys are 39 chars ("AIza…"); accept a little slack but nothing that could carry a URL or spaces. */
const API_KEY = /^[A-Za-z0-9_-]{30,100}$/
/** "Time A x Time B" / "vs" / "×" somewhere in the title: lives without a matchup are not games. */
const MATCHUP = /\S\s+(?:x|×|vs\.?|versus)\s+\S/i
/** Lives that look like a game but are not one: reactions, radio-style narration, video games, pre/post shows, school leagues. */
const NOT_A_GAME = new RegExp([
  'react', 'rea[cç][aã]o', 'reagindo', 'narra[cç][aã]o', 'r[aá]dio', 'tempo real', 'simula[cç][aã]o', 'simulador',
  'efootball', '\\bpes\\b', '\\bfifa\\s?\\d{2}\\b', '\\b(?:ea\\s?(?:sports\\s?)?)?fc\\s?(?:2\\d|mobile)\\b', '\\bea fc\\b',
  'gameplay', 'videogame', '\\b2k\\d{0,2}\\b', 'madden', 'playstation', '\\bps[45]\\b', 'xbox',
  'pr[eé][- ]jogo', 'p[oó]s[- ]jogo', 'melhores momentos', 'highlights', 'replay', 'reprise', 'compacto', 'jogo completo', 'relembre',
  // Round-the-clock channels, watch-alongs and talk shows that put a matchup in the title.
  '24/7', '\\b24\\s?h(?:s|oras)?\\b', 'assistir\\b.{0,40}\\bjuntos', 'watch\\s?along', 'resenha', 'sinuca', 'snooker', 'bilhar',
  // US school sports flood the Sports category with fake "LIVE" streams.
  'high school', '\\bhs (?:football|basketball)\\b', 'college', '\\bncaa\\b',
].join('|'), 'i')
/** Other sports are dropped unless the title names one of the leagues the user also wants (NFL, NBA). */
const OTHER_SPORT = /futebol americano|american football|basquete|basketball|\bnbb\b|v[oô]lei|volleyball|handebol|t[eê]nis|\bufc\b|\bmma\b|boxe/i
const ALLOWED_LEAGUE = /\bnfl\b|\bnba\b/i
/** "2006/07"-style seasons; a season that ended before last year is a rerun, not a live game. */
const SEASON = /\b((?:19|20)\d\d)\s*[/-]\s*(\d\d)\b/g
/** First match wins, so more specific names come before generic ones. */
const COMPETITIONS: Array<[RegExp, string]> = [
  [/\bnfl\b/i, 'NFL'],
  [/\bnba\b/i, 'NBA'],
  [/copa do brasil/i, 'Copa do Brasil'],
  [/brasileir[aã]o.*s[eé]rie\s*b|s[eé]rie\s*b\b/i, 'Brasileirão Série B'],
  [/brasileir[aã]o.*s[eé]rie\s*c|s[eé]rie\s*c\b/i, 'Brasileirão Série C'],
  [/brasileir[aã]o.*s[eé]rie\s*d|s[eé]rie\s*d\b/i, 'Brasileirão Série D'],
  [/brasileir[aã]o\s*feminino/i, 'Brasileirão Feminino'],
  [/brasileir[aã]o/i, 'Brasileirão'],
  [/libertadores/i, 'Libertadores'],
  [/sul[- ]?americana/i, 'Sul-Americana'],
  [/copa do nordeste/i, 'Copa do Nordeste'],
  [/paulist[aã]o|campeonato paulista/i, 'Paulistão'],
  // "Carioca"/"Mineiro"/"Gaúcho" alone are also in club names (Atlético Mineiro), so ask for the championship form.
  [/campeonato carioca|cariocão|carioca\s+20\d\d/i, 'Carioca'],
  [/campeonato mineiro|mineir[aã]o|mineiro\s+20\d\d/i, 'Mineiro'],
  [/campeonato ga[uú]cho|ga[uú]ch[aã]o/i, 'Gauchão'],
  [/champions league|\bucl\b/i, 'Champions League'],
  [/europa league/i, 'Europa League'],
  [/conference league/i, 'Conference League'],
  [/premier league/i, 'Premier League'],
  [/la ?liga/i, 'La Liga'],
  [/copa do mundo|world cup/i, 'Copa do Mundo'],
  [/eliminat[oó]rias/i, 'Eliminatórias'],
]
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"' }

/** The API escapes HTML in snippet titles (`&quot;`, `&#39;`, `&amp;`). */
function decodeEntities(value: string) {
  return value.replace(/&(amp|lt|gt|quot|apos|#39|#34);/g, (_, name: string) => ENTITIES[name])
}

function cleanText(value: unknown) {
  return typeof value === 'string'
    ? decodeEntities(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
    : ''
}

export function isValidYoutubeApiKey(key: unknown): key is string {
  return typeof key === 'string' && API_KEY.test(key)
}

/** Reads one `NAME=value` line from a `.env` file (comments, `export` and surrounding quotes allowed); last one wins. */
export function readEnvValue(text: string, name: string) {
  let value: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || match[1] !== name) continue
    const raw = match[2]
    const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(raw)
    value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '')
  }
  return value
}

function isOldSeason(title: string, year: number) {
  return [...title.matchAll(SEASON)].some(([, start]) => Number(start) < year - 1)
}

/** True for a live football match, or an NFL/NBA game: matchup in the title, no non-game words, no rerun of an old season. */
export function isLiveGameTitle(title: string, year = new Date().getFullYear()) {
  if (!MATCHUP.test(title) || NOT_A_GAME.test(title) || isOldSeason(title, year)) return false
  return ALLOWED_LEAGUE.test(title) || !OTHER_SPORT.test(title)
}

export function detectCompetition(title: string) {
  return COMPETITIONS.find(([pattern]) => pattern.test(title))?.[1] ?? null
}

/** Validates a YouTube Data API v3 `search.list` response and keeps only live games, grouped by competition or channel. */
export function parseYoutubeSearch(raw: unknown, year = new Date().getFullYear()): YoutubeLive[] {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const lives: YoutubeLive[] = []
  for (const row of items.slice(0, 200)) {
    if (!row || typeof row !== 'object') continue
    const item = row as { id?: { videoId?: unknown }; snippet?: Record<string, unknown> }
    const id = item.id?.videoId
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id)) continue
    const snippet = item.snippet ?? {}
    if (snippet.liveBroadcastContent !== 'live') continue
    const name = stripSoundMarkers(cleanText(snippet.title))
    if (!name || !isLiveGameTitle(name, year)) continue
    seen.add(id)
    const channel = cleanText(snippet.channelTitle) || 'YouTube'
    lives.push({
      id,
      name,
      channel,
      competition: detectCompetition(name) ?? channel,
      time: '',
      live: true,
      url: `https://www.youtube.com/watch?v=${id}`,
    })
  }
  return lives
}

/** Maps a YouTube API error body (`error.errors[].reason`) to what the UI can explain. */
export function youtubeErrorStatus(httpStatus: number, raw: unknown): Exclude<YoutubeLivesResult['status'], 'ok' | 'no-key'> {
  const error = raw && typeof raw === 'object' ? (raw as { error?: { errors?: unknown } }).error : null
  const reasons = Array.isArray(error?.errors)
    ? error.errors.map((entry) => (entry && typeof entry === 'object' ? String((entry as { reason?: unknown }).reason ?? '') : ''))
    : []
  if (reasons.some((reason) => /quota|dailyLimit|rateLimit/i.test(reason))) return 'quota'
  if (reasons.some((reason) => /accessNotConfigured|serviceDisabled/i.test(reason))) return 'api-disabled'
  if (reasons.some((reason) => /keyInvalid|keyExpired|API_KEY_INVALID/i.test(reason))) return 'invalid-key'
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) return 'invalid-key'
  return 'unavailable'
}
