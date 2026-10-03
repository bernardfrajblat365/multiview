const YT_ID_RE = /^[\w-]{11}$/

function extractIframeSrc(value: string): string | null {
  const match = value.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
  return match?.[1]?.trim() || null
}

function youtubeVideoId(urlString: string): string | null {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  const isYoutube =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com'

  if (!isYoutube) return null

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return YT_ID_RE.test(id) ? id : null
  }

  const pathMatch = url.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})(?:\/|$)/i)
  if (pathMatch) return pathMatch[2]

  if (/^\/watch\/?$/i.test(url.pathname)) {
    const id = url.searchParams.get('v') ?? ''
    return YT_ID_RE.test(id) ? id : null
  }

  return null
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const fromIframe = extractIframeSrc(trimmed)
  let candidate = fromIframe ?? trimmed

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  const videoId = youtubeVideoId(candidate)
  if (videoId) {
    try {
      const parsed = new URL(candidate)
      if (/^\/(watch|live)(?:\/|$)/i.test(parsed.pathname)) return candidate
    } catch {
      // youtubeVideoId already validated the URL; use the canonical fallback below.
    }
    return `https://www.youtube.com/watch?v=${videoId}`
  }

  return candidate
}
