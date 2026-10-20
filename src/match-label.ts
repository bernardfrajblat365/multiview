export type NormRect = { x: number; y: number; width: number; height: number }

export type MatchLabelMode = 'bar-bottom' | 'bar-top' | 'bar-side' | 'overlay-bottom'

export type MatchLabelPlacement = {
  mode: MatchLabelMode
  box: NormRect
  fontPx: number
  lines: string[]
}

const MATCHUP_RE = /^(.{2,60}?)\s+(?:x|×|vs\.?|v)\s+(.{2,60})$/i
const CHANNEL_PREFIX_RE = /^\(\S{1,20}\)\s+/
const TIME_PREFIX_RE = /^\d{1,2}:\d{2}\s+-\s+/
const YOUTUBE_SUFFIX_RE = /\s+-\s+YouTube$/i
/** Speaker / megaphone markers often prepended by live players (e.g. BLL). */
const SOUND_EMOJI_RE = /[\u{1F507}-\u{1F50A}\u{1F4E2}\u{1F4E3}]/gu
const MAX_LABEL_LENGTH = 80
const MIN_FONT_PX = 11
const MAX_FONT_PX = 22
const MIN_SIDE_BAR_PX = 48
const REFERENCE_ASPECT = 16 / 9

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cleanSegment(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripSoundMarkers(value: string) {
  return cleanSegment(value.replace(SOUND_EMOJI_RE, ''))
}

function candidateSegments(title: string) {
  const cleaned = cleanSegment(title)
  const segments: string[] = []
  for (const part of cleaned.split('|')) {
    const trimmed = cleanSegment(part)
    if (!trimmed) continue
    for (const nested of trimmed.split(/\s+-\s+/)) {
      const nestedTrimmed = cleanSegment(nested)
      if (nestedTrimmed) segments.push(nestedTrimmed)
    }
    segments.push(trimmed)
  }
  segments.push(cleaned)
  return segments
}

function validTeamName(value: string) {
  return Boolean(value) && !/[|]/.test(value) && value.length >= 2 && value.length <= 60
}

export function extractMatchLabel(title: string): string | null {
  if (typeof title !== 'string') return null
  let value = stripSoundMarkers(title)
  if (!value) return null

  value = value.replace(CHANNEL_PREFIX_RE, '')
  value = value.replace(TIME_PREFIX_RE, '')
  value = value.replace(YOUTUBE_SUFFIX_RE, '')
  value = stripSoundMarkers(value)
  if (!value) return null

  for (const segment of candidateSegments(value)) {
    const match = stripSoundMarkers(segment).match(MATCHUP_RE)
    if (!match) continue
    const home = stripSoundMarkers(match[1] ?? '')
    const away = stripSoundMarkers(match[2] ?? '')
    if (!validTeamName(home) || !validTeamName(away)) continue
    const label = `${home} x ${away}`
    return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label
  }

  return null
}

function containRect(panelWidth: number, panelHeight: number, contentAspect: number): NormRect {
  const panelAspect = panelWidth / panelHeight
  if (panelAspect > contentAspect) {
    const height = 1
    const width = (contentAspect * panelHeight) / panelWidth
    return { x: (1 - width) / 2, y: 0, width, height }
  }
  const width = 1
  const height = panelWidth / (contentAspect * panelHeight)
  return { x: 0, y: (1 - height) / 2, width, height }
}

function splitMatchLines(label: string) {
  const match = label.match(MATCHUP_RE)
  if (!match) return [label]
  return [cleanSegment(match[1] ?? ''), 'x', cleanSegment(match[2] ?? '')]
}

function intersects(a: NormRect, b: NormRect) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

export function placeMatchLabel(options: {
  panelWidth: number
  panelHeight: number
  videoRect?: NormRect | null
  label: string
}): MatchLabelPlacement {
  const panelWidth = Math.max(1, options.panelWidth)
  const panelHeight = Math.max(1, options.panelHeight)
  const fontPx = clamp(panelHeight * 0.05, MIN_FONT_PX, MAX_FONT_PX)
  const lineHeight = fontPx * 1.6
  const videoRect = options.videoRect ?? containRect(panelWidth, panelHeight, REFERENCE_ASPECT)
  const topBarPx = videoRect.y * panelHeight
  const bottomBarPx = (1 - videoRect.y - videoRect.height) * panelHeight
  const leftBarPx = videoRect.x * panelWidth
  const rightBarPx = (1 - videoRect.x - videoRect.width) * panelWidth

  if (bottomBarPx >= lineHeight) {
    return {
      mode: 'bar-bottom',
      box: {
        x: videoRect.x,
        y: videoRect.y + videoRect.height,
        width: videoRect.width,
        height: 1 - videoRect.y - videoRect.height,
      },
      fontPx,
      lines: [options.label],
    }
  }

  if (topBarPx >= lineHeight) {
    return {
      mode: 'bar-top',
      box: {
        x: videoRect.x,
        y: 0,
        width: videoRect.width,
        height: videoRect.y,
      },
      fontPx,
      lines: [options.label],
    }
  }

  const sideBarPx = Math.max(leftBarPx, rightBarPx)
  if (sideBarPx >= MIN_SIDE_BAR_PX) {
    const useLeft = leftBarPx >= rightBarPx
    return {
      mode: 'bar-side',
      box: useLeft
        ? { x: 0, y: 0, width: videoRect.x, height: 1 }
        : { x: videoRect.x + videoRect.width, y: 0, width: 1 - videoRect.x - videoRect.width, height: 1 },
      fontPx,
      lines: splitMatchLines(options.label),
    }
  }

  return {
    mode: 'overlay-bottom',
    box: {
      x: 0,
      y: Math.max(0, 1 - lineHeight / panelHeight),
      width: 1,
      height: Math.min(1, lineHeight / panelHeight),
    },
    fontPx,
    lines: [options.label],
  }
}

export function labelOverlapsVideo(placement: MatchLabelPlacement, videoRect: NormRect) {
  if (placement.mode === 'overlay-bottom') return true
  return intersects(placement.box, videoRect)
}
