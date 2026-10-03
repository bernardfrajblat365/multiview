import {
  calculateLayout,
  getCompositions,
  resolveComposition,
  type HighlightPosition,
  type LayoutRect,
  type PanelId,
  type ResolvedComposition,
} from './layout.ts'

export type OrganizerDraft = {
  count: number
  ids: PanelId[]
  position: HighlightPosition | undefined
  previousVariant: string | undefined
}

export type OrganizerChoice = {
  key: string
  positions: string[]
  label: string
  result: ResolvedComposition
  rects: LayoutRect[]
}

export const ORGANIZER_EPSILON = 1e-8

const POSITION_LABELS: Record<HighlightPosition, string> = {
  left: 'À esquerda',
  right: 'À direita',
  top: 'Em cima',
  bottom: 'Embaixo',
  'top-left': 'No canto superior esquerdo',
  'top-right': 'No canto superior direito',
  'bottom-left': 'No canto inferior esquerdo',
  'bottom-right': 'No canto inferior direito',
}

const SMALL_CORNER_LABELS: Record<string, string> = {
  'top-left': 'Telas menores no canto inferior direito',
  'top-right': 'Telas menores no canto inferior esquerdo',
  'bottom-left': 'Telas menores no canto superior direito',
  'bottom-right': 'Telas menores no canto superior esquerdo',
}

export function sameOrganizerRects(
  first: readonly LayoutRect[],
  second: readonly LayoutRect[],
): boolean {
  if (first.length !== second.length) return false
  const byId = new Map(second.map((rect) => [rect.panelId, rect]))

  return first.every((rect) => {
    const other = byId.get(rect.panelId)
    return Boolean(other) &&
      Math.abs(rect.x - other!.x) <= ORGANIZER_EPSILON &&
      Math.abs(rect.y - other!.y) <= ORGANIZER_EPSILON &&
      Math.abs(rect.width - other!.width) <= ORGANIZER_EPSILON &&
      Math.abs(rect.height - other!.height) <= ORGANIZER_EPSILON
  })
}

export function organizerDraftKey(
  draft: OrganizerDraft,
  panelCount: number,
): string {
  let position = draft.position

  if (draft.count === 0) position = undefined

  if (panelCount === 10 && draft.count === 2) {
    if (position === 'top-right') position = 'top-left'
    if (position === 'bottom-right') position = 'bottom-left'
  }

  return JSON.stringify([draft.count, draft.ids, position ?? 'none'])
}

export function organizerDraftValid(
  order: readonly PanelId[],
  draft: OrganizerDraft,
): boolean {
  const composition = getCompositions(order.length)
    .find((entry) => entry.highlightCount === draft.count)

  if (!composition) return false
  if (draft.ids.length !== draft.count) return false
  if (new Set(draft.ids).size !== draft.ids.length) return false
  if (draft.ids.some((id) => !order.includes(id))) return false

  return draft.count === 0 ||
    composition.positions.includes(draft.position!)
}

function choiceLabel(
  panelCount: number,
  highlightCount: number,
  positions: string[],
): string {
  if (highlightCount === 0) return 'Sem destaques'

  if (panelCount === 7 && highlightCount === 3) {
    return SMALL_CORNER_LABELS[positions[0]]
  }

  if (panelCount === 10 && highlightCount === 2 && positions.length > 1) {
    return positions[0].startsWith('top-')
      ? 'Principais em cima'
      : 'Principais embaixo'
  }

  const prefix = highlightCount === 1 ? 'Principal' : 'Principais'
  const position = positions[0] as HighlightPosition
  return `${prefix} ${POSITION_LABELS[position].toLowerCase()}`
}

export function buildOrganizerChoices(
  order: readonly PanelId[],
  draft: OrganizerDraft,
  aspect: number,
): OrganizerChoice[] {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new Error('Proporção inválida para a prévia.')
  }

  if (!organizerDraftValid(order, draft)) return []

  const composition = getCompositions(order.length)
    .find((entry) => entry.highlightCount === draft.count)!

  const positions: Array<HighlightPosition | undefined> =
    draft.count === 0 ? [undefined] : composition.positions

  const choices: OrganizerChoice[] = []

  for (const position of positions) {
    const result = resolveComposition([...order], {
      mode: draft.count === 0 ? 'equal' : 'highlights',
      highlighted: new Set(draft.ids),
      position,
      aspect,
      previousVariant: position === draft.position
        ? draft.previousVariant
        : undefined,
    })

    const rects = calculateLayout(result.tree).rects
    const alias = position ?? 'none'
    const existing = choices.find((choice) =>
      sameOrganizerRects(choice.rects, rects),
    )

    if (existing) {
      existing.positions.push(alias)
      existing.label = choiceLabel(
        order.length,
        draft.count,
        existing.positions,
      )
    } else {
      choices.push({
        key: alias,
        positions: [alias],
        label: choiceLabel(order.length, draft.count, [alias]),
        result,
        rects,
      })
    }
  }

  return choices
}
