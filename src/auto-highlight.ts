import { calculateLayout, getCompositions, resolveComposition, type PanelId } from './layout.ts'

/** Default highlight time of a goal; the user can pick another in the alert settings. */
export const AUTO_HIGHLIGHT_MS = 45_000
/** Auto-highlight only makes sense once the grid has small panels to promote from. */
export const AUTO_MIN_PANELS = 3
/** A second highlight is added when it makes the goal's video at least this much bigger. */
export const COMPANION_MIN_GAIN = 1.25

export type AutoEntry = { id: PanelId; expiresAt: number }

export function highlightCapacity(panelCount: number): number {
  if (panelCount < 1) return 0
  return getCompositions(Math.min(panelCount, 18)).at(-1)!.highlightCount
}

/** 16:9 video area (fraction of a 16:9 window) of the first highlighted panel. */
function highlightVideoArea(panelCount: number, highlights: number): number {
  const ids = Array.from({ length: panelCount }, (_, index) => `p${index}`)
  const { tree } = resolveComposition(ids, { mode: 'highlights', highlighted: new Set(ids.slice(0, highlights)) })
  const rect = calculateLayout(tree).rects.find((candidate) => candidate.panelId === 'p0')!
  const width = Math.min(rect.width, rect.height)
  return width * width
}

const companionCache = new Map<number, boolean>()

/**
 * With 12 panels one highlight is barely bigger than the rest, while two highlights get a
 * quarter of the screen each. In such counts a lone goal brings a companion panel along.
 */
export function companionHelps(panelCount: number): boolean {
  if (highlightCapacity(panelCount) < 2) return false
  let helps = companionCache.get(panelCount)
  if (helps === undefined) {
    helps = highlightVideoArea(panelCount, 2) >= highlightVideoArea(panelCount, 1) * COMPANION_MIN_GAIN
    companionCache.set(panelCount, helps)
  }
  return helps
}

/**
 * Highlight order: newest goal first, then older goals, then the user's own highlights.
 * A lone goal gets the first other panel (by `panelOrder`) as companion when that makes it bigger.
 */
export function composeHighlighted(
  autos: readonly AutoEntry[],
  userHighlighted: readonly PanelId[],
  panelCount: number,
  panelOrder: readonly PanelId[] = [],
): PanelId[] {
  const capacity = highlightCapacity(panelCount)
  const auto = [...autos].reverse().map((entry) => entry.id)
  const rest = userHighlighted.filter((id) => !auto.includes(id))
  const highlighted = [...auto, ...rest].slice(0, capacity)
  if (highlighted.length === 1 && auto.length > 0 && companionHelps(panelCount)) {
    const companion = panelOrder.find((id) => !highlighted.includes(id))
    if (companion) highlighted.push(companion)
  }
  return highlighted
}

export type GoalResult = {
  /** Updated auto entries (oldest first). */
  autos: AutoEntry[]
  /** Highlights to apply, or null when the layout must stay untouched. */
  highlighted: PanelId[] | null
}

/**
 * Registers a goal on a panel. A panel the user already highlighted is not touched
 * (its alert border still shows). When the layout is full, the oldest auto entry leaves.
 */
export function registerGoal(
  autos: readonly AutoEntry[],
  panelId: PanelId,
  now: number,
  panelCount: number,
  userHighlighted: readonly PanelId[],
  panelOrder: readonly PanelId[] = [],
  durationMs = AUTO_HIGHLIGHT_MS,
): GoalResult {
  const capacity = highlightCapacity(panelCount)
  if (panelCount < AUTO_MIN_PANELS || capacity === 0) return { autos: [...autos], highlighted: null }
  const isAuto = autos.some((entry) => entry.id === panelId)
  if (userHighlighted.includes(panelId) && !isAuto) return { autos: [...autos], highlighted: null }
  const next = [...autos.filter((entry) => entry.id !== panelId), { id: panelId, expiresAt: now + durationMs }].slice(-capacity)
  return { autos: next, highlighted: composeHighlighted(next, userHighlighted, panelCount, panelOrder) }
}

export function expireAutos(autos: readonly AutoEntry[], now: number): { autos: AutoEntry[]; changed: boolean } {
  const next = autos.filter((entry) => entry.expiresAt > now)
  return { autos: next, changed: next.length !== autos.length }
}

export function secondsLeft(entry: AutoEntry, now: number): number {
  return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))
}
