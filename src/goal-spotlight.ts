import type {
  HighlightPosition,
  LayoutMode,
  LayoutNode,
  PanelId,
} from './layout.ts'
import type { PanelAlertKind } from './panel-alert.ts'

export const SPOTLIGHT_MS = 60_000
export const SPOTLIGHT_MIN_PANELS = 5
export const SPOTLIGHT_TRIGGERS: ReadonlySet<PanelAlertKind> = new Set(['goal', 'penalty', 'red'])

export type SpotlightBaseline = {
  highlighted: PanelId[]
  mode: LayoutMode
  position: HighlightPosition | undefined
  variant: string | undefined
  order: PanelId[]
  tree: LayoutNode
  aspect: number
  panelCount: number
}

export type SpotlightEntry = {
  panelId: PanelId
  startedAt: number
  until: number
}

export type SpotlightState = {
  baseline: SpotlightBaseline
  entries: SpotlightEntry[]
}

export type SpotlightCurrent = {
  highlighted: readonly PanelId[]
  mode: LayoutMode
  position: HighlightPosition | undefined
  variant: string | undefined
  order: readonly PanelId[]
  tree: LayoutNode
  aspect: number
  panelCount: number
}

export type RegisterAlertInput = {
  panelId: PanelId
  kind: PanelAlertKind
  now: number
  current: SpotlightCurrent
  capacity: number
}

export type ExpireResult = {
  state: SpotlightState | null
  restored: boolean
  changed: boolean
}

/** How many large slots an equal (no-highlight) baseline may temporarily use. */
function equalSlots(capacity: number) {
  return Math.min(Math.max(capacity, 0), 2)
}

/**
 * Derive the temporary highlight list from a baseline and active entries.
 * - Equal baseline: newest entries fill up to min(capacity, 2) slots.
 * - Highlighted baseline: keep the user's slot count; replace user principals
 *   from the end with the newest entries.
 */
export function deriveHighlights(
  baseline: SpotlightBaseline,
  entries: readonly SpotlightEntry[],
  capacity: number,
): PanelId[] {
  const sorted = [...entries].sort((a, b) => b.startedAt - a.startedAt || a.panelId.localeCompare(b.panelId))
  const entryIds = sorted.map((entry) => entry.panelId)

  if (baseline.highlighted.length === 0) {
    const slots = equalSlots(capacity)
    return entryIds.slice(0, slots)
  }

  const slots = Math.min(baseline.highlighted.length, Math.max(capacity, 0))
  const keep = Math.max(0, slots - entryIds.length)
  const kept = baseline.highlighted.slice(0, keep)
  const promoted = entryIds.slice(0, slots - keep)
  return [...kept, ...promoted]
}

function captureBaseline(current: SpotlightCurrent): SpotlightBaseline {
  return {
    highlighted: [...current.highlighted],
    mode: current.mode,
    position: current.position,
    variant: current.variant,
    order: [...current.order],
    tree: current.tree,
    aspect: current.aspect,
    panelCount: current.panelCount,
  }
}

/**
 * Register a panel alert into spotlight state.
 * Returns null when nothing changes (guards, already-principal, unknown kind).
 */
export function registerAlert(
  state: SpotlightState | null,
  input: RegisterAlertInput,
): SpotlightState | null {
  const { panelId, kind, now, current, capacity } = input
  if (current.panelCount < SPOTLIGHT_MIN_PANELS) return null
  if (capacity <= 0) return null

  const baseline = state?.baseline ?? captureBaseline(current)
  const userPrincipals = new Set(baseline.highlighted)

  if (kind === 'var') {
    if (!state) return null
    const existing = state.entries.find((entry) => entry.panelId === panelId)
    if (!existing) return null
    return {
      baseline: state.baseline,
      entries: state.entries.map((entry) =>
        entry.panelId === panelId ? { ...entry, until: now + SPOTLIGHT_MS } : entry,
      ),
    }
  }

  if (!SPOTLIGHT_TRIGGERS.has(kind)) return null

  if (userPrincipals.has(panelId)) return null

  const existing = state?.entries.find((entry) => entry.panelId === panelId)
  if (existing) {
    return {
      baseline,
      entries: (state?.entries ?? []).map((entry) =>
        entry.panelId === panelId
          ? { ...entry, startedAt: now, until: now + SPOTLIGHT_MS }
          : entry,
      ),
    }
  }

  return {
    baseline,
    entries: [
      ...(state?.entries ?? []),
      { panelId, startedAt: now, until: now + SPOTLIGHT_MS },
    ],
  }
}

/** Drop expired entries. restored=true when the last entry expires. */
export function expire(state: SpotlightState | null, now: number): ExpireResult {
  if (!state) return { state: null, restored: false, changed: false }
  const remaining = state.entries.filter((entry) => entry.until > now)
  if (remaining.length === state.entries.length) {
    return { state, restored: false, changed: false }
  }
  if (remaining.length === 0) {
    return { state: null, restored: true, changed: true }
  }
  return {
    state: { baseline: state.baseline, entries: remaining },
    restored: false,
    changed: true,
  }
}

/** Remove a single panel from active entries (URL clear / panel gone). */
export function removePanelEntry(
  state: SpotlightState | null,
  panelId: PanelId,
): ExpireResult {
  if (!state) return { state: null, restored: false, changed: false }
  if (!state.entries.some((entry) => entry.panelId === panelId)) {
    return { state, restored: false, changed: false }
  }
  const remaining = state.entries.filter((entry) => entry.panelId !== panelId)
  if (remaining.length === 0) {
    return { state: null, restored: true, changed: true }
  }
  return {
    state: { baseline: state.baseline, entries: remaining },
    restored: false,
    changed: true,
  }
}

export function nextExpiry(state: SpotlightState | null): number | null {
  if (!state || state.entries.length === 0) return null
  return Math.min(...state.entries.map((entry) => entry.until))
}

export function formatSpotlightCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
