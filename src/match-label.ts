export type NormRect = { x: number; y: number; width: number; height: number }

export type MatchLabelMode = 'bar-bottom' | 'bar-top' | 'overlay-bottom'

/** `inline`: "Home 2 – 1 Away" on one line. `stacked`: one row per team, scoreboard style. */
export type MatchLabelLayout = 'inline' | 'stacked'

export type MatchScore = { home: number; away: number }

export type MatchLabelPlacement = {
  mode: MatchLabelMode
  layout: MatchLabelLayout
  box: NormRect
  fontPx: number
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
/** Text may shrink below the panel font to fit a thin black bar, but not past this. */
const MIN_FIT_FONT_PX = 10
/** The caption grows with the panel, so a highlighted game reads from across the room. */
const MAX_OVERLAY_FONT_PX = 36
/** Height above the text line(s) reserved for the caption's gradient fade, in em. */
const OVERLAY_FADE_EM = 1.1
const REFERENCE_ASPECT = 16 / 9
/** Conservative average advance of a bold sans glyph, in em. Over-estimating only drops a tier. */
const CHAR_EM = 0.6
const LINE_EM = 1.3
/** Dismiss button + horizontal padding, in em. */
const CHROME_EM = 2.2
const STACKED_HEIGHT_EM = 2 * LINE_EM + 0.4
const SCORE_RE = /^(\d{1,3})\s*[-–:x]\s*(\d{1,3})$/i
const TEAM_STOPWORDS = new Set(['fc', 'cf', 'sc', 'ac', 'ec', 'cr', 'se', 'ca', 'afc', 'club', 'clube', 'de', 'da', 'do', 'del', 'la', 'el', 'the', 'and'])

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cleanSegment(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function stripSoundMarkers(value: string) {
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

/** Splits a label produced by `extractMatchLabel` back into its two teams. */
export function splitMatchTeams(label: string): { home: string; away: string } | null {
  const match = typeof label === 'string' ? label.match(MATCHUP_RE) : null
  if (!match) return null
  const home = cleanSegment(match[1] ?? '')
  const away = cleanSegment(match[2] ?? '')
  return home && away ? { home, away } : null
}

/** Parses the scoreboard text ("2 - 1") into numbers; anything else is no score. */
export function parseScore(value: string): MatchScore | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(SCORE_RE)
  if (!match) return null
  return { home: Number(match[1]), away: Number(match[2]) }
}

export function formatScore(score: MatchScore) {
  return `${score.home} – ${score.away}`
}

function teamTokens(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !TEAM_STOPWORDS.has(token))
}

function sameTeam(a: string, b: string) {
  const tokens = new Set(teamTokens(a))
  return teamTokens(b).some((token) => tokens.has(token))
}

/**
 * The feed's home/away order can differ from the player's title. When the title
 * clearly lists the feed's teams the other way round, the score is flipped to match.
 */
export function orientScore(
  titleTeams: { home: string; away: string },
  feedTeams: { home: string; away: string },
  score: MatchScore,
): MatchScore {
  const reversed = sameTeam(titleTeams.home, feedTeams.away) && sameTeam(titleTeams.away, feedTeams.home)
  const straight = sameTeam(titleTeams.home, feedTeams.home) || sameTeam(titleTeams.away, feedTeams.away)
  return reversed && !straight ? { home: score.away, away: score.home } : score
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

function inlineWidthEm(home: string, away: string, hasScore: boolean) {
  // Names + score pill ("2 – 1" with padding) or "x", plus the gaps between them.
  return CHAR_EM * (home.length + away.length) + (hasScore ? 4.2 : 1.2) + 1 + CHROME_EM
}

function stackedWidthEm(home: string, away: string, hasScore: boolean) {
  return CHAR_EM * Math.max(home.length, away.length) + (hasScore ? 1.8 : 0) + CHROME_EM
}

type Fit = { layout: MatchLabelLayout; fontPx: number }

/** Largest font (≤ preferred) that fits the full names in a horizontal box: one line first, then two rows. */
function fitHorizontal(widthPx: number, heightPx: number, preferredPx: number, home: string, away: string, hasScore: boolean): Fit | null {
  const inline = Math.min(preferredPx, heightPx / LINE_EM, widthPx / inlineWidthEm(home, away, hasScore))
  if (inline >= MIN_FIT_FONT_PX) return { layout: 'inline', fontPx: inline }
  const stacked = Math.min(preferredPx, heightPx / STACKED_HEIGHT_EM, widthPx / stackedWidthEm(home, away, hasScore))
  if (stacked >= MIN_FIT_FONT_PX) return { layout: 'stacked', fontPx: stacked }
  return null
}

function roundFont(value: number) {
  return Math.round(value * 10) / 10
}

/**
 * Picks where the match name (and score) goes, always with the full team names:
 * the bottom or top black bar, otherwise a caption with a dark gradient across the
 * bottom of the video (also when the video only has side bars: a column of names
 * beside a large highlighted video read poorly). Thin bars shrink the text or split
 * it in two rows before giving up.
 */
export function placeMatchLabel(options: {
  panelWidth: number
  panelHeight: number
  videoRect?: NormRect | null
  home: string
  away: string
  score?: MatchScore | null
}): MatchLabelPlacement {
  const panelWidth = Math.max(1, options.panelWidth)
  const panelHeight = Math.max(1, options.panelHeight)
  const { home, away } = options
  const hasScore = Boolean(options.score)
  const preferredPx = clamp(panelHeight * 0.05, MIN_FONT_PX, MAX_FONT_PX)
  const videoRect = options.videoRect ?? containRect(panelWidth, panelHeight, REFERENCE_ASPECT)
  const videoBottom = videoRect.y + videoRect.height
  const barWidthPx = videoRect.width * panelWidth
  const topBarPx = videoRect.y * panelHeight
  const bottomBarPx = (1 - videoBottom) * panelHeight

  const bottom = bottomBarPx > 0 ? fitHorizontal(barWidthPx, bottomBarPx, preferredPx, home, away, hasScore) : null
  const top = topBarPx > 0 ? fitHorizontal(barWidthPx, topBarPx, preferredPx, home, away, hasScore) : null
  // A single line beats two rows of the same size; ties go to the bottom bar.
  const rank = (fit: Fit | null) => (fit ? fit.fontPx + (fit.layout === 'inline' ? 0.5 : 0) : -1)
  if (bottom && rank(bottom) >= rank(top)) {
    return {
      mode: 'bar-bottom',
      layout: bottom.layout,
      box: { x: videoRect.x, y: videoBottom, width: videoRect.width, height: 1 - videoBottom },
      fontPx: roundFont(bottom.fontPx),
    }
  }
  if (top) {
    return {
      mode: 'bar-top',
      layout: top.layout,
      box: { x: videoRect.x, y: 0, width: videoRect.width, height: videoRect.y },
      fontPx: roundFont(top.fontPx),
    }
  }

  // No usable top/bottom bar: a caption across the bottom of the video, over a dark gradient,
  // so it stays legible and can use a larger font than a corner chip.
  const maxWidthPx = Math.max(1, videoRect.width * panelWidth)
  const overlayPreferred = clamp(panelHeight * 0.06, MIN_FIT_FONT_PX, MAX_OVERLAY_FONT_PX)
  let layout: MatchLabelLayout = 'inline'
  let fontPx = Math.min(overlayPreferred, maxWidthPx / inlineWidthEm(home, away, hasScore))
  if (fontPx < Math.min(overlayPreferred, 12)) {
    layout = 'stacked'
    // Never below the minimum: very long names wrap inside their row instead of being cut.
    fontPx = Math.max(MIN_FIT_FONT_PX, Math.min(overlayPreferred, maxWidthPx / stackedWidthEm(home, away, hasScore)))
  }
  // Extra height above the text is the gradient's fade-in.
  const heightPx = (layout === 'inline' ? LINE_EM + OVERLAY_FADE_EM : STACKED_HEIGHT_EM + OVERLAY_FADE_EM) * fontPx
  const height = Math.max(0, Math.min(videoRect.height, heightPx / panelHeight))
  return {
    mode: 'overlay-bottom',
    layout,
    box: { x: videoRect.x, y: videoBottom - height, width: videoRect.width, height },
    fontPx: roundFont(fontPx),
  }
}

function intersects(a: NormRect, b: NormRect) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

export function labelOverlapsVideo(placement: MatchLabelPlacement, videoRect: NormRect) {
  if (placement.mode === 'overlay-bottom') return true
  return intersects(placement.box, videoRect)
}
