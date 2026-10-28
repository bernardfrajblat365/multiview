import type { PanelId } from './layout.ts'
import type { ClockPeriod } from './match-clock.ts'
import type { MatchScore } from './match-label.ts'

/** A highlight in a break (`out`) gave its place to a game being played (`in`) until the break ends. */
export type HalftimeSwap = { out: PanelId; in: PanelId }

/** What the swap knows about one panel at a time: its visible clock (null: none), score and main team. */
export type SwapPanelInfo = {
  id: PanelId
  period: ClockPeriod | null
  /** Match time (s) of the visible clock, when it has one. */
  elapsed: number | null
  score: MatchScore | null
  mainTeam: boolean
  alertsOff: boolean
}

/** A game this close to the end of the first half would go to its own break soon: it doesn't come in. */
export const FIRST_HALF_CUTOFF_SEC = 42 * 60
/** From here on, a close second half is the final stretch. */
export const FINAL_STRETCH_SEC = 70 * 60

const BREAK_PERIODS = new Set<ClockPeriod>(['half-time', 'extra-break', 'extra-half-time'])
const PLAYING_PERIODS = new Set<ClockPeriod>(['first', 'second', 'extra-first', 'extra-second'])

/** Breaks between halves; penalties are not one (the most tense part of the match). */
export function isBreakPeriod(period: ClockPeriod | null) {
  return period !== null && BREAK_PERIODS.has(period)
}

/** A game that may take a highlight: being played, alerts on, and not about to go to half-time. */
export function canComeIn(info: SwapPanelInfo) {
  if (info.alertsOff || info.period === null || !PLAYING_PERIODS.has(info.period)) return false
  return !(info.period === 'first' && (info.elapsed ?? 0) >= FIRST_HALF_CUTOFF_SEC)
}

function close(info: SwapPanelInfo) {
  return info.score !== null && Math.abs(info.score.home - info.score.away) <= 1
}

/** Extra time, or the last 20 minutes of a game within one goal. */
function finalStretch(info: SwapPanelInfo) {
  if (info.period === 'extra-first' || info.period === 'extra-second') return true
  return info.period === 'second' && (info.elapsed ?? 0) >= FINAL_STRETCH_SEC && close(info)
}

/**
 * Candidates that may come in, best first: main team, then final stretch, then a close score,
 * then the game furthest along; ties keep the grid order (`order`).
 */
export function rankCandidates(infos: readonly SwapPanelInfo[], order: readonly PanelId[]): PanelId[] {
  const position = (id: PanelId) => {
    const index = order.indexOf(id)
    return index < 0 ? order.length : index
  }
  return infos
    .filter(canComeIn)
    .sort((a, b) =>
      Number(b.mainTeam) - Number(a.mainTeam)
      || Number(finalStretch(b)) - Number(finalStretch(a))
      || Number(close(b)) - Number(close(a))
      || (b.elapsed ?? 0) - (a.elapsed ?? 0)
      || position(a.id) - position(b.id))
    .map((info) => info.id)
}

/** Exchanges two ids in a list, like `swapPanels`: undoing a swap is doing it again. */
function exchange(ids: readonly PanelId[], a: PanelId, b: PanelId) {
  return ids.map((id) => id === a ? b : id === b ? a : id)
}

export type SwapPlanInput = {
  swaps: readonly HalftimeSwap[]
  /** The user's highlights as they are now (swaps applied). */
  userHighlighted: readonly PanelId[]
  /** Every highlighted panel now (the user's and the goal ones). */
  highlighted: readonly PanelId[]
  panels: readonly SwapPanelInfo[]
  /** Grid order, for ties and to swap the highlights in a stable order. */
  order: readonly PanelId[]
  /** Highlights the user kept in their break ("Voltar", "Fixar" or a manual change): not swapped until it ends. */
  skipped: ReadonlySet<PanelId>
}

/** Swaps to undo (in order) and new swaps to make, after the undone ones. */
export type SwapPlan = { restore: HalftimeSwap[]; start: HalftimeSwap[] }

/**
 * A swap ends when its game is back from the break (or lost its clock) or when the game that came in
 * goes to a break itself; then a highlight still in its break looks for another game.
 * Each highlight in a break takes the best game not highlighted yet.
 */
export function planHalftimeSwaps(input: SwapPlanInput): SwapPlan {
  const info = new Map(input.panels.map((panel) => [panel.id, panel]))
  const period = (id: PanelId) => info.get(id)?.period ?? null
  const restore = input.swaps.filter((swap) => !info.has(swap.out) || !info.has(swap.in) || !isBreakPeriod(period(swap.out)) || isBreakPeriod(period(swap.in)))
  let userHighlighted = [...input.userHighlighted]
  let highlighted = [...input.highlighted]
  for (const swap of restore) {
    userHighlighted = exchange(userHighlighted, swap.out, swap.in)
    highlighted = exchange(highlighted, swap.out, swap.in)
  }
  const kept = input.swaps.filter((swap) => !restore.includes(swap))
  const swapped = new Set(kept.flatMap((swap) => [swap.out, swap.in]))
  const outs = input.order.filter((id) => userHighlighted.includes(id) && !swapped.has(id) && !input.skipped.has(id) && isBreakPeriod(period(id)))
  const taken = new Set(highlighted)
  const ranked = rankCandidates(input.panels.filter((panel) => !taken.has(panel.id) && !swapped.has(panel.id)), input.order)
  const start: HalftimeSwap[] = []
  for (const out of outs) {
    const next = ranked.shift()
    if (!next) break
    start.push({ out, in: next })
  }
  return { restore, start }
}
