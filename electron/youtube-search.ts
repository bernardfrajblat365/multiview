import { app, net } from 'electron'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isValidYoutubeApiKey,
  isYoutubeChannelId,
  MAX_YOUTUBE_CHANNELS,
  parseChannelInput,
  parseChannelList,
  parseLiveVideos,
  parsePlaylistVideoIds,
  readEnvValue,
  uploadsPlaylistId,
  youtubeErrorStatus,
  type YoutubeApiError,
  type YoutubeChannelResult,
  type YoutubeLivesResult,
} from '../src/youtube-lives'

const KEY_NAME = 'QUADRA_YOUTUBE_API_KEY'
const API_URL = (process.env.QUADRA_YOUTUBE_API_URL ?? 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '')
const REQUEST_TIMEOUT_MS = 10000
/** Uploads read per channel: lives are among the newest, but busy channels post many clips around a game. */
const UPLOADS_PER_CHANNEL = '50'
const PARALLEL_REQUESTS = 8
/** A search costs about 2 units per channel; reuse a result for a minute. */
const CACHE_MS = 60000
let cached: { at: number; key: string; result: YoutubeLivesResult } | null = null
let pending: { key: string; promise: Promise<YoutubeLivesResult> } | null = null

class ApiError extends Error {
  readonly status: Exclude<YoutubeApiError, 'no-key'>
  constructor(status: Exclude<YoutubeApiError, 'no-key'>) {
    super(status)
    this.status = status
  }
}

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

async function apiKey(): Promise<{ key: string } | { status: 'no-key' | 'invalid-key' }> {
  const key = await readApiKey()
  if (!key) return { status: 'no-key' }
  if (!isValidYoutubeApiKey(key)) return { status: 'invalid-key' }
  return { key }
}

/** One API call; `null` for a 404 (a channel without uploads), `ApiError` for key, quota and network failures. */
async function callApi(path: string, params: Record<string, string>, key: string): Promise<unknown> {
  const url = new URL(`${API_URL}/${path}`)
  url.search = new URLSearchParams({ ...params, key }).toString()
  let response: Response
  let body: unknown
  try {
    response = await net.fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    body = await response.json().catch(() => null)
  } catch {
    throw new ApiError('unavailable')
  }
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(youtubeErrorStatus(response.status, body))
  return body
}

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function searchChannels(channelIds: readonly string[]): Promise<YoutubeLivesResult> {
  const auth = await apiKey()
  if ('status' in auth) return auth
  try {
    const uploads = await mapLimited(channelIds, PARALLEL_REQUESTS, async (channelId) => parsePlaylistVideoIds(
      await callApi('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId(channelId), maxResults: UPLOADS_PER_CHANNEL }, auth.key),
    ))
    const videoIds = [...new Set(uploads.flat())]
    const chunks = Array.from({ length: Math.ceil(videoIds.length / 50) }, (_, index) => videoIds.slice(index * 50, index * 50 + 50))
    const pages = await mapLimited(chunks, PARALLEL_REQUESTS, (ids) => callApi('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(','), maxResults: '50' }, auth.key))
    const items = pages.flatMap((page) => {
      const pageItems = page && typeof page === 'object' ? (page as { items?: unknown }).items : null
      return Array.isArray(pageItems) ? pageItems : []
    })
    return { status: 'ok', events: parseLiveVideos({ items }) }
  } catch (error) {
    return { status: error instanceof ApiError ? error.status : 'unavailable' }
  }
}

/** Live games on the given channels (ids validated here, since they come from the renderer). */
export function listYoutubeLives(channels: unknown) {
  const ids = Array.isArray(channels) ? [...new Set(channels.filter(isYoutubeChannelId))].slice(0, MAX_YOUTUBE_CHANNELS) : []
  if (ids.length === 0) return Promise.resolve<YoutubeLivesResult>({ status: 'ok', events: [] })
  const cacheKey = [...ids].sort().join(',')
  if (cached?.key === cacheKey && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.result)
  if (pending?.key === cacheKey) return pending.promise
  const promise = searchChannels(ids)
    .then((result) => {
      cached = result.status === 'ok' ? { at: Date.now(), key: cacheKey, result } : null
      return result
    })
    .finally(() => { if (pending?.promise === promise) pending = null })
  pending = { key: cacheKey, promise }
  return promise
}

/** Turns what the user typed (id, @handle or channel link) into a channel id and name; 1 quota unit. */
export async function resolveYoutubeChannel(input: unknown): Promise<YoutubeChannelResult> {
  const query = typeof input === 'string' ? parseChannelInput(input) : null
  if (!query) return { status: 'not-found' }
  const auth = await apiKey()
  if ('status' in auth) return auth
  const params: Record<string, string> = { part: 'snippet' }
  if ('id' in query) params.id = query.id
  else if ('handle' in query) params.forHandle = query.handle
  else params.forUsername = query.username
  try {
    const channel = parseChannelList(await callApi('channels', params, auth.key))
    return channel ? { status: 'ok', channel } : { status: 'not-found' }
  } catch (error) {
    return { status: error instanceof ApiError ? error.status : 'unavailable' }
  }
}
