import type { BllEvent } from './bll-batch.ts'
import { stripSoundMarkers } from './match-label.ts'

export type YoutubeLive = BllEvent & { channel: string }
export type YoutubeApiError = 'no-key' | 'invalid-key' | 'api-disabled' | 'quota' | 'unavailable'
export type YoutubeLivesResult = { status: 'ok'; events: YoutubeLive[] } | { status: YoutubeApiError }
export type YoutubeChannel = { id: string; title: string }
export type YoutubeChannelResult = { status: 'ok'; channel: YoutubeChannel } | { status: 'not-found' | YoutubeApiError }
/** What the user typed to add a channel: its id, its @handle or a legacy /user/ name. */
export type YoutubeChannelQuery = { id: string } | { handle: string } | { username: string }

/** Channels that stream official images of the games; the user can add or remove channels in the app. */
export const DEFAULT_YOUTUBE_CHANNELS: readonly YoutubeChannel[] = [
  { id: 'UCZiYbVptd3PVPf4f6eR6UaQ', title: 'CazéTV' },
  { id: 'UCP-vp1zdHOa9k2hN_nMT9TA', title: 'CazéTV 2' },
  { id: 'UCgCKagVhzGnZcuP9bSMgMCg', title: 'ge tv' },
  { id: 'UCw5-xj3AKqEizC7MvHaIPqA', title: 'ESPN Brasil' },
  { id: 'UC_oToDrJ6uca7d1dFVBmLtg', title: 'Canal GOAT' },
  { id: 'UCs-6sCz2LJm1PrWQN4ErsPw', title: 'TNT Sports Brasil' },
  { id: 'UCxc3marqP9BJSkQ0_K4mqDg', title: 'SBT Sports' },
  { id: 'UCaf4uhI8ItLyM_6kZ5I5Zdw', title: 'Paulistão' },
  { id: 'UCzU8-lZlRfkV3nj0RzAZdrQ', title: 'CONMEBOL' },
  { id: 'UCf9WJPpsh5BHDY-OeISgIqA', title: 'N Sports' },
]
/** Each channel costs about 2 quota units per search (its uploads + the live check), so cap the list. */
export const MAX_YOUTUBE_CHANNELS = 50
const CHANNELS_STORAGE_KEY = 'quadra:youtube-channels'

const MAX_TEXT = 200
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const HANDLE = /^@?([A-Za-z0-9._-]{3,30})$/
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
  [/libertadores\s*feminina/i, 'Libertadores Feminina'],
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
  [/ligue\s*1\b/i, 'Ligue 1'],
  [/bundesliga/i, 'Bundesliga'],
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

/** The user's own key (environment or `.env`) wins; otherwise the key baked into the build, if any. */
export function chooseYoutubeApiKey(ownKey: string | null | undefined, builtInKey: string | null | undefined): string | null {
  return ownKey?.trim() || builtInKey?.trim() || null
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

export function isYoutubeChannelId(id: unknown): id is string {
  return typeof id === 'string' && CHANNEL_ID.test(id)
}

/** Accepts a channel id, `@handle`, or a youtube.com/channel/, /@ or /user/ link. Custom /c/ links cannot be resolved by the API. */
export function parseChannelInput(text: string): YoutubeChannelQuery | null {
  const value = text.trim()
  if (!value || value.length > 300) return null
  if (CHANNEL_ID.test(value)) return { id: value }
  let path = value
  if (/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\//i.test(value)) {
    try {
      path = decodeURIComponent(new URL(/^https?:/i.test(value) ? value : `https://${value}`).pathname)
    } catch {
      return null
    }
    const channel = /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/.exec(path)
    if (channel) return { id: channel[1] }
    const user = /^\/user\/([A-Za-z0-9._-]{1,100})(?:\/|$)/.exec(path)
    if (user) return { username: user[1] }
    const handle = /^\/(@[A-Za-z0-9._-]{3,30})(?:\/|$)/.exec(path)
    if (!handle) return null
    path = handle[1]
  }
  const handle = HANDLE.exec(path)
  return handle ? { handle: handle[1] } : null
}

/** Every channel's uploads playlist is its id with `UC` swapped for `UU`; reading it costs 1 unit instead of 100 for a search. */
export function uploadsPlaylistId(channelId: string) {
  return `UU${channelId.slice(2)}`
}

/** Video ids from a `playlistItems.list` response (`part=contentDetails`). */
export function parsePlaylistVideoIds(raw: unknown): string[] {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null
  if (!Array.isArray(items)) return []
  const ids = new Set<string>()
  for (const row of items.slice(0, 50)) {
    const id = row && typeof row === 'object' ? (row as { contentDetails?: { videoId?: unknown } }).contentDetails?.videoId : null
    if (typeof id === 'string' && VIDEO_ID.test(id)) ids.add(id)
  }
  return [...ids]
}

/** Keeps the videos of a `videos.list` response (`part=snippet,liveStreamingDetails`) that are live games now, most watched first. */
export function parseLiveVideos(raw: unknown, year = new Date().getFullYear()): YoutubeLive[] {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const lives: Array<YoutubeLive & { viewers: number }> = []
  // Up to 50 uploads per channel, all of them checked in one pass.
  for (const row of items.slice(0, MAX_YOUTUBE_CHANNELS * 50)) {
    if (!row || typeof row !== 'object') continue
    const item = row as { id?: unknown; snippet?: Record<string, unknown>; liveStreamingDetails?: Record<string, unknown> }
    const id = item.id
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id)) continue
    const snippet = item.snippet ?? {}
    const details = item.liveStreamingDetails ?? {}
    // `live` alone also matches a stream that just ended and is still processing; require a start and no end.
    if (snippet.liveBroadcastContent !== 'live' || !details.actualStartTime || details.actualEndTime) continue
    const name = stripSoundMarkers(cleanText(snippet.title))
    if (!name || !isLiveGameTitle(name, year)) continue
    seen.add(id)
    const channel = cleanText(snippet.channelTitle) || 'YouTube'
    const viewers = Number(details.concurrentViewers)
    lives.push({
      id,
      name,
      channel,
      competition: detectCompetition(name) ?? channel,
      time: '',
      live: true,
      url: `https://www.youtube.com/watch?v=${id}`,
      viewers: Number.isFinite(viewers) ? viewers : 0,
    })
  }
  return lives.sort((a, b) => b.viewers - a.viewers).map(({ viewers: _viewers, ...live }) => live)
}

/** The first channel of a `channels.list` response (`part=snippet`). */
export function parseChannelList(raw: unknown): YoutubeChannel | null {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null
  const item = Array.isArray(items) ? items[0] as { id?: unknown; snippet?: { title?: unknown } } | undefined : undefined
  if (!item || !isYoutubeChannelId(item.id)) return null
  return { id: item.id, title: cleanText(item.snippet?.title) || item.id }
}

/** Saved list of channels; a missing or corrupt value means the default list. An empty saved list stays empty. */
export function parseStoredChannels(text: string | null): YoutubeChannel[] {
  if (text === null) return DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel }))
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel }))
    const seen = new Set<string>()
    const channels: YoutubeChannel[] = []
    for (const entry of parsed) {
      const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null
      if (!isYoutubeChannelId(id) || seen.has(id)) continue
      seen.add(id)
      channels.push({ id, title: cleanText((entry as { title?: unknown }).title) || id })
      if (channels.length === MAX_YOUTUBE_CHANNELS) break
    }
    return channels
  } catch {
    return DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel }))
  }
}

export function loadYoutubeChannels() {
  try {
    return parseStoredChannels(localStorage.getItem(CHANNELS_STORAGE_KEY))
  } catch {
    return parseStoredChannels(null)
  }
}

export function saveYoutubeChannels(channels: readonly YoutubeChannel[]) {
  try {
    localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels))
  } catch {
    /* storage unavailable: the list lasts only for this session */
  }
}

/** Maps a YouTube API error body (`error.errors[].reason`) to what the UI can explain. */
export function youtubeErrorStatus(httpStatus: number, raw: unknown): Exclude<YoutubeApiError, 'no-key'> {
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
