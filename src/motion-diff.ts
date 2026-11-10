import type { Bounds, PanelId } from './layout'

/** What the grid looked like on screen after a render (fractions of the stage). */
export type RenderSnapshot = {
  count: number
  rects: Record<PanelId, Bounds>
  urls: Record<PanelId, string>
  highlighted: PanelId[]
}

export type RenderDiff = {
  /** Panels that did not exist before and are empty now (safe to scale in). */
  entered: PanelId[]
  /** Panels that disappeared and were empty (safe to animate out as a ghost). */
  removed: PanelId[]
  /** Empty panels whose rect changed (DOM only, safe to FLIP). */
  movedEmpty: PanelId[]
  /** Panels with a native video whose rect changed (never transformed). */
  movedLoaded: PanelId[]
  highlightAdded: PanelId[]
  countDelta: number
}

const EPSILON = 1e-6

function sameRect(a: Bounds, b: Bounds) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON &&
    Math.abs(a.width - b.width) < EPSILON && Math.abs(a.height - b.height) < EPSILON
}

export function emptyDiff(): RenderDiff {
  return { entered: [], removed: [], movedEmpty: [], movedLoaded: [], highlightAdded: [], countDelta: 0 }
}

export function diffRender(previous: RenderSnapshot | null, next: RenderSnapshot): RenderDiff {
  const diff = emptyDiff()
  if (!previous) return diff

  for (const id of Object.keys(next.rects)) {
    const before = previous.rects[id]
    const loaded = Boolean(next.urls[id])
    if (!before) {
      if (!loaded) diff.entered.push(id)
      continue
    }
    if (sameRect(before, next.rects[id])) continue
    if (loaded) diff.movedLoaded.push(id)
    else diff.movedEmpty.push(id)
  }

  for (const id of Object.keys(previous.rects)) {
    if (!next.rects[id] && !previous.urls[id]) diff.removed.push(id)
  }

  const wasHighlighted = new Set(previous.highlighted)
  diff.highlightAdded = next.highlighted.filter((id) => !wasHighlighted.has(id))
  diff.countDelta = next.count - previous.count
  return diff
}
