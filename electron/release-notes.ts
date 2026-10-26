export const GITHUB_RELEASE = {
  owner: 'bernardfrajblat365',
  repo: 'multiview',
} as const

export type UpdateNotesSource = {
  version?: unknown
  releaseNotes?: unknown
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function releaseTag(version: string): string {
  return `v${normalizeVersion(version)}`
}

/** Turns a GitHub release markdown body into user-facing bullet lines. */
export function parseReleaseNotes(body: string | null | undefined): string[] {
  if (!body) return []
  const items: string[] = []
  for (const rawLine of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) continue
    if (/^\*\*Full Changelog\*\*/i.test(line)) continue
    if (/^Full Changelog:/i.test(line)) continue
    const bullet = line.match(/^[-*]\s+(?:\[[ x]\]\s+)?(.+)$/i)
    if (!bullet) continue
    const text = cleanReleaseNoteItem(bullet[1] ?? '')
    if (text) items.push(text)
  }
  return uniquePreserveOrder(items)
}

export function releaseNotesFromUpdateInfo(info: UpdateNotesSource): string[] {
  const notes = info.releaseNotes
  if (typeof notes === 'string') return parseReleaseNotes(notes)
  if (Array.isArray(notes)) {
    const chunks: string[] = []
    for (const entry of notes) {
      if (typeof entry === 'string') chunks.push(...parseReleaseNotes(entry))
      else if (entry && typeof entry === 'object' && 'note' in entry && typeof (entry as { note: unknown }).note === 'string') {
        chunks.push(...parseReleaseNotes((entry as { note: string }).note))
      }
    }
    return uniquePreserveOrder(chunks)
  }
  return []
}

export function formatReleaseNotesForDialog(items: string[], limit = 10): string {
  if (items.length === 0) return ''
  const visible = items.slice(0, Math.max(1, limit))
  const lines = visible.map((item) => `• ${item}`)
  if (items.length > visible.length) lines.push(`• … e mais ${items.length - visible.length}`)
  return lines.join('\n')
}

export async function fetchGitHubReleaseNotes(
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const tag = releaseTag(version)
  const url = `https://api.github.com/repos/${GITHUB_RELEASE.owner}/${GITHUB_RELEASE.repo}/releases/tags/${encodeURIComponent(tag)}`
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Quadra-Multiview',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) return []
  const payload = (await response.json()) as { body?: unknown }
  return typeof payload.body === 'string' ? parseReleaseNotes(payload.body) : []
}

function cleanReleaseNoteItem(raw: string): string {
  let text = raw.trim()
  // Drop trailing "by @user in https://..." from generated notes.
  text = text.replace(/\s+by\s+@[\w-]+\s+in\s+https?:\/\/\S+/gi, '')
  text = text.replace(/\s+https?:\/\/github\.com\/\S+/gi, '')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/^feat:\s*/i, '').replace(/^fix:\s*/i, '').replace(/^chore:\s*/i, '')
  return text.replace(/\s+/g, ' ').trim()
}

function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
