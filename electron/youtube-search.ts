import { app, net } from 'electron'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isValidYoutubeApiKey,
  parseYoutubeSearch,
  readEnvValue,
  youtubeErrorStatus,
  type YoutubeLivesResult,
} from '../src/youtube-lives'

const KEY_NAME = 'QUADRA_YOUTUBE_API_KEY'
const SEARCH_URL = process.env.QUADRA_YOUTUBE_API_URL ?? 'https://www.googleapis.com/youtube/v3/search'
const SEARCH_TIMEOUT_MS = 10000
/** Each `search.list` costs 100 of the default 10,000 daily units, so reuse a result for a minute. */
const CACHE_MS = 60000
let cached: { at: number; result: YoutubeLivesResult } | null = null
let pending: Promise<YoutubeLivesResult> | null = null

/** `.env` next to the project in dev; next to the installed exe or in userData once packaged. Never bundled into the build. */
function envFileCandidates() {
  return app.isPackaged
    ? [join(dirname(process.execPath), '.env'), join(app.getPath('userData'), '.env')]
    : [join(app.getAppPath(), '.env'), join(process.cwd(), '.env')]
}

/** Read on every request so editing `.env` does not need a restart. The key is never logged nor sent to the renderer. */
async function readApiKey() {
  const fromProcess = process.env[KEY_NAME]?.trim()
  if (fromProcess) return fromProcess
  for (const file of envFileCandidates()) {
    const text = await readFile(file, 'utf8').catch(() => null)
    const value = text === null ? null : readEnvValue(text, KEY_NAME)?.trim()
    if (value) return value
  }
  return null
}

async function searchLives(): Promise<YoutubeLivesResult> {
  const key = await readApiKey()
  if (!key) return { status: 'no-key' }
  if (!isValidYoutubeApiKey(key)) return { status: 'invalid-key' }
  const url = new URL(SEARCH_URL)
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    eventType: 'live',
    videoCategoryId: '17',
    regionCode: 'BR',
    relevanceLanguage: 'pt',
    maxResults: '50',
    // One call (100 quota units) for both: `|` is OR in YouTube search.
    q: 'futebol ao vivo|NFL ao vivo|NBA ao vivo',
    key,
  }).toString()
  try {
    const response = await net.fetch(url.toString(), { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) return { status: youtubeErrorStatus(response.status, body) }
    return { status: 'ok', events: parseYoutubeSearch(body) }
  } catch {
    return { status: 'unavailable' }
  }
}

export function listYoutubeLives() {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.result)
  pending ??= searchLives()
    .then((result) => {
      cached = result.status === 'ok' ? { at: Date.now(), result } : null
      return result
    })
    .finally(() => { pending = null })
  return pending
}
