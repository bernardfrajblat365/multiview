import { optimizeVideoLayout } from './video-layout.ts'

export type PanelId = string
export type LayoutMode = 'auto' | 'equal' | 'highlights'
export type SplitDirection = 'row' | 'column'
export type HighlightPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right' | 'top' | 'bottom'
export type Bounds = { x: number; y: number; width: number; height: number }
export type LayoutLeaf = { kind: 'leaf'; panelId: PanelId }
export type LayoutSplit = { kind: 'split'; id: string; direction: SplitDirection; ratio: number; first: LayoutNode; second: LayoutNode }
export type LayoutNode = LayoutLeaf | LayoutSplit
export type LayoutRect = Bounds & { panelId: PanelId }
export type SplitRect = { id: string; direction: SplitDirection; ratio: number; bounds: Bounds }
export type LayoutResult = { rects: LayoutRect[]; splits: SplitRect[] }
export type PanelPayload = { id: PanelId; url: string; muted: boolean; editing: boolean; bounds: Bounds }
export type LayoutPayload = { view: 'choose' | 'grid'; panelCount: number; mode: LayoutMode; panels: PanelPayload[] }
export type Composition = { id: string; highlightCount: number; label: string; positions: HighlightPosition[] }
export type CompositionOptions = {
  mode?: LayoutMode
  highlighted?: ReadonlySet<PanelId>
  position?: HighlightPosition
  aspect?: number
  previousVariant?: string
}
export type ResolvedComposition = {
  tree: LayoutNode
  highlighted: PanelId[]
  composition: Composition
  position: HighlightPosition
  variant: string
}

const CORNERS: HighlightPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const SIDES: HighlightPosition[] = ['left', 'right', 'top', 'bottom']
const REFERENCE_ASPECT = 16 / 9
const EPSILON = 1e-8

function safeAspect(aspect = REFERENCE_ASPECT) {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : REFERENCE_ASPECT
}

function leaf(panelId: PanelId): LayoutLeaf {
  return { kind: 'leaf', panelId }
}

function split(id: string, direction: SplitDirection, ratio: number, first: LayoutNode, second: LayoutNode): LayoutSplit {
  return { kind: 'split', id, direction, ratio, first, second }
}

export function defaultHighlightCount(count: number) {
  if ([3, 5, 7, 11, 13].includes(count)) return 1
  if ([10, 14].includes(count)) return 2
  return 0
}

export function getCompositions(count: number): Composition[] {
  if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('Escolha entre 1 e 16 telas.')
  const capacities = count < 3 ? [0] : count < 5 ? [0, 1] : count === 7 ? [0, 1, 2, 3] : [0, 1, 2]
  return capacities.map((highlightCount) => ({
    id: `${count}-${highlightCount}`,
    highlightCount,
    label: highlightCount === 0
      ? `${count} ${count === 1 ? 'tela' : 'telas'} · Sem destaques`
      : `${count} telas · ${highlightCount} ${highlightCount === 1 ? 'grande' : 'grandes'} + ${count - highlightCount} pequenas`,
    positions: highlightCount === 0 ? [] : (count === 13 && highlightCount === 1) || (count === 10 && highlightCount === 2) || (count === 7 && highlightCount === 3) ? [...CORNERS] : [...SIDES],
  }))
}

function lineTree(ids: string[], direction: SplitDirection, path: string): LayoutNode {
  if (ids.length === 1) return leaf(ids[0])
  const half = Math.ceil(ids.length / 2)
  return split(path, direction, half / ids.length,
    lineTree(ids.slice(0, half), direction, `${path}a`),
    lineTree(ids.slice(half), direction, `${path}b`))
}

function gridTree(ids: string[], rows: number, path: string): LayoutNode {
  if (rows === 1) return lineTree(ids, 'row', path)
  const count = Math.ceil(ids.length / rows)
  return split(path, 'column', count / ids.length,
    lineTree(ids.slice(0, count), 'row', `${path}r`),
    gridTree(ids.slice(count), rows - 1, `${path}b`))
}

function viewingScore(tree: LayoutNode, aspect: number) {
  const useful = calculateLayout(tree).rects.map((rect) => {
    const ratio = aspect * rect.width / rect.height
    return rect.width * rect.height * Math.min(ratio / REFERENCE_ASPECT, REFERENCE_ASPECT / ratio)
  })
  return useful.reduce((sum, value) => sum + value, 0) * 0.7 + Math.min(...useful) * useful.length * 0.3
}

function bestGrid(ids: string[], aspect: number, path: string) {
  let tree = gridTree(ids, 1, path)
  let score = viewingScore(tree, aspect)
  for (let rows = 2; rows <= ids.length; rows += 1) {
    const candidate = gridTree(ids, rows, path)
    const value = viewingScore(candidate, aspect)
    if (value > score + EPSILON) {
      tree = candidate
      score = value
    }
  }
  return tree
}

function quadrantTree(count: number, highlights: number, position: HighlightPosition) {
  const anchor = CORNERS.indexOf(position)
  const largeQuadrants = highlights === 1 ? [anchor] : highlights === 2 ? [anchor, anchor ^ 1] : [anchor, anchor ^ 1, anchor ^ 2]
  let largeIndex = 0
  let smallIndex = 0
  const quadrants = Array.from({ length: 4 }, (_, index) => {
    if (largeQuadrants.includes(index)) return leaf(`large-${largeIndex++}`)
    const ids = Array.from({ length: (count - highlights) / (4 - highlights) }, () => `small-${smallIndex++}`)
    return gridTree(ids, 2, `q${index}`)
  })
  return split('q', 'column', 0.5,
    split('qa', 'row', 0.5, quadrants[0], quadrants[1]),
    split('qb', 'row', 0.5, quadrants[2], quadrants[3]))
}

function assignSlots(tree: LayoutNode, largeIds: string[], smallIds: string[]): LayoutNode {
  const slots = calculateLayout(tree).rects.sort((a, b) => Math.abs(a.y - b.y) > EPSILON ? a.y - b.y : a.x - b.x)
  const assignments = new Map<string, string>()
  let large = 0
  let small = 0
  for (const slot of slots) assignments.set(slot.panelId, slot.panelId.startsWith('large-') ? largeIds[large++] : smallIds[small++])
  const visit = (node: LayoutNode): LayoutNode => node.kind === 'leaf'
    ? leaf(assignments.get(node.panelId)!)
    : { ...node, first: visit(node.first), second: visit(node.second) }
  return visit(tree)
}

function applySplitRatios(tree: LayoutNode, ratios: ReadonlyMap<string, number>): LayoutNode {
  if (tree.kind === 'leaf') return tree
  return {
    ...tree,
    ratio: ratios.get(tree.id) ?? tree.ratio,
    first: applySplitRatios(tree.first, ratios),
    second: applySplitRatios(tree.second, ratios),
  }
}

export function resolveComposition(panelIds: PanelId[], options: CompositionOptions = {}): ResolvedComposition {
  const catalog = getCompositions(panelIds.length)
  if (new Set(panelIds).size !== panelIds.length) throw new Error('Identificadores de telas devem ser únicos.')
  const aspect = safeAspect(options.aspect)
  const mode = options.mode ?? 'auto'
  const requested = [...(options.highlighted ?? [])].filter((id) => panelIds.includes(id))
  const maxHighlights = catalog.at(-1)!.highlightCount
  const desired = mode === 'equal' ? 0 : requested.length > 0 ? Math.min(requested.length, maxHighlights) : mode === 'auto' ? defaultHighlightCount(panelIds.length) : Math.min(1, maxHighlights)
  const composition = catalog.find((entry) => entry.highlightCount === desired) ?? catalog[0]
  const largeIds = [...requested, ...panelIds.filter((id) => !requested.includes(id))].slice(0, composition.highlightCount)
  const smallIds = panelIds.filter((id) => !largeIds.includes(id))
  const candidates: { tree: LayoutNode; variant: string; score: number; position: HighlightPosition }[] = []
  let position = composition.positions.includes(options.position!) ? options.position! : composition.positions[0] ?? 'top-left'
  if (composition.highlightCount === 0) {
    const slots = panelIds.map((_, index) => `small-${index}`)
    for (let rows = 1; rows <= slots.length; rows += 1) {
      const tree = gridTree(slots, rows, 'e')
      candidates.push({ tree, variant: `${composition.id}:rows-${rows}`, score: viewingScore(tree, aspect), position })
    }
  } else if (composition.positions[0] === 'top-left') {
    const tree = quadrantTree(panelIds.length, composition.highlightCount, position)
    candidates.push({ tree, variant: `${composition.id}:quadrants`, score: viewingScore(tree, aspect), position })
  } else {
    const positions = composition.positions.includes(options.position!) ? [options.position!] : ['left', 'top'] as HighlightPosition[]
    const largeSlots = largeIds.map((_, index) => `large-${index}`)
    const smallSlots = smallIds.map((_, index) => `small-${index}`)
    const weights: Record<number, number> = { 3: 4, 4: 3, 5: 4, 6: 3, 7: 4, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4 }
    for (const place of positions) {
      const direction = place === 'left' || place === 'right' ? 'row' : 'column'
      for (const weight of [weights[panelIds.length] - 1, weights[panelIds.length], weights[panelIds.length] + 1]) {
        const ratio = weight * largeIds.length / (weight * largeIds.length + smallIds.length)
        const largeAspect = direction === 'row' ? aspect * ratio : aspect / ratio
        const smallAspect = direction === 'row' ? aspect * (1 - ratio) : aspect / (1 - ratio)
        const large = bestGrid(largeSlots, largeAspect, 'l')
        const small = bestGrid(smallSlots, smallAspect, 's')
        const reverse = place === 'right' || place === 'bottom'
        const tree = split('root', direction, reverse ? 1 - ratio : ratio, reverse ? small : large, reverse ? large : small)
        candidates.push({ tree, variant: `${composition.id}:${place}:${weight}`, score: viewingScore(tree, aspect), position: place })
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const visibleRatio = (candidate: { tree: LayoutNode }) => {
    const rects = calculateLayout(candidate.tree).rects
    const large = rects.filter((rect) => rect.panelId.startsWith('large-')).map((rect) => rect.width * rect.height)
    const small = rects.filter((rect) => rect.panelId.startsWith('small-')).map((rect) => rect.width * rect.height)
    if (large.length === 0 || small.length === 0) return Number.POSITIVE_INFINITY
    return Math.min(...large) / Math.max(...small)
  }
  const pool = [3, 1.1, 0].map((threshold) => candidates.filter((candidate) => visibleRatio(candidate) > threshold)).find((pool) => pool.length > 0) ?? candidates
  const previous = pool.find((candidate) => candidate.variant === options.previousVariant)
  const chosen = previous && pool[0].score < previous.score * 1.12 ? previous : pool[0]
  position = chosen.position
  const assignedTree = assignSlots(chosen.tree, largeIds, smallIds)
  const optimization = optimizeVideoLayout(assignedTree, calculateLayout(assignedTree).rects, new Set(largeIds), aspect)
  const optimizedTree = optimization.status === 'optimized' ? applySplitRatios(assignedTree, optimization.ratios) : assignedTree
  const tree = validateLayout(calculateLayout(optimizedTree), new Set(panelIds)) ? optimizedTree : assignedTree
  return { tree, highlighted: largeIds, composition, position, variant: chosen.variant }
}

export function buildLayoutTree(panelIds: PanelId[], highlighted?: ReadonlySet<PanelId>, aspect = REFERENCE_ASPECT, position?: HighlightPosition): LayoutNode {
  return resolveComposition(panelIds, { mode: highlighted === undefined ? 'auto' : highlighted.size === 0 || highlighted.size === panelIds.length ? 'equal' : 'highlights', highlighted, aspect, position }).tree
}

function calculateNode(node: LayoutNode, bounds: Bounds, rects: LayoutRect[], splits: SplitRect[]) {
  if (node.kind === 'leaf') {
    rects.push({ panelId: node.panelId, ...bounds })
    return
  }
  splits.push({ id: node.id, direction: node.direction, ratio: node.ratio, bounds })
  const first = { ...bounds }
  const second = { ...bounds }
  if (node.direction === 'row') {
    first.width *= node.ratio
    second.x += first.width
    second.width -= first.width
  } else {
    first.height *= node.ratio
    second.y += first.height
    second.height -= first.height
  }
  calculateNode(node.first, first, rects, splits)
  calculateNode(node.second, second, rects, splits)
}

export function calculateLayout(tree: LayoutNode): LayoutResult {
  const rects: LayoutRect[] = []
  const splits: SplitRect[] = []
  calculateNode(tree, { x: 0, y: 0, width: 1, height: 1 }, rects, splits)
  return { rects, splits }
}

export function updateSplitRatio(tree: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (tree.kind === 'leaf') return tree
  return {
    ...tree,
    ratio: tree.id === splitId ? Math.min(0.88, Math.max(0.12, ratio)) : tree.ratio,
    first: updateSplitRatio(tree.first, splitId, ratio),
    second: updateSplitRatio(tree.second, splitId, ratio),
  }
}

export function collectPanelIds(tree: LayoutNode): PanelId[] {
  return tree.kind === 'leaf' ? [tree.panelId] : [...collectPanelIds(tree.first), ...collectPanelIds(tree.second)]
}

export function validateLayout(result: LayoutResult, panelIds: ReadonlySet<PanelId>): boolean {
  if (result.rects.length !== panelIds.size) return false
  const seen = new Set<PanelId>()
  let area = 0
  for (const rect of result.rects) {
    if (seen.has(rect.panelId) || !panelIds.has(rect.panelId)) return false
    seen.add(rect.panelId)
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || rect.x < -EPSILON || rect.y < -EPSILON || rect.x + rect.width > 1 + EPSILON || rect.y + rect.height > 1 + EPSILON) return false
    area += rect.width * rect.height
  }
  for (let index = 0; index < result.rects.length; index += 1) {
    const a = result.rects[index]
    for (const b of result.rects.slice(index + 1)) {
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON) return false
    }
  }
  return Math.abs(area - 1) < EPSILON
}
