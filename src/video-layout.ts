import { solve, type Constraint, type Model, type Solution } from 'yalps'
import type { LayoutNode, LayoutRect, PanelId } from './layout'

const VIDEO_ASPECT = 16 / 9
const EPSILON = 1e-8
const COEFFICIENT_EPSILON = 1e-14
const VALIDATION_TOLERANCE = 1e-7
const MAX_CACHE_ENTRIES = 256

type LinearExpression = Map<string, number>
type Group = {
  key: string
  panelIds: PanelId[]
  highlighted: boolean
  count: number
  q0: number
  width: string
  height: string
  visible: string
  branch: string
}
type NodeExpression = { width: LinearExpression; height: LinearExpression }
type OptimizationModel = {
  groups: Group[]
  expressions: Map<LayoutNode, NodeExpression>
  constraints: Map<string, Constraint>
  variables: Map<string, Map<string, number>>
  binaries: Set<string>
  direction: 'maximize' | 'minimize'
}

export type VideoLayoutOptimization = {
  status: 'optimized' | 'unchanged' | 'fallback'
  ratios: Map<string, number>
  reason?: string
}

type CachedResult = { status: 'optimized' | 'unchanged'; ratios: Map<string, number> }

const cache = new Map<string, CachedResult>()

function safeAspect(value: number) {
  return Number.isFinite(value) && value > 0 ? value : VIDEO_ASPECT
}

function addTerm(expression: LinearExpression, variable: string, coefficient: number) {
  if (Math.abs(coefficient) <= COEFFICIENT_EPSILON) return
  expression.set(variable, (expression.get(variable) ?? 0) + coefficient)
  if (Math.abs(expression.get(variable)!) <= COEFFICIENT_EPSILON) expression.delete(variable)
}

function addExpressions(...expressions: LinearExpression[]) {
  const result: LinearExpression = new Map()
  for (const expression of expressions) {
    for (const [variable, coefficient] of expression) addTerm(result, variable, coefficient)
  }
  return result
}

function scaleExpression(expression: LinearExpression, factor: number) {
  const result: LinearExpression = new Map()
  for (const [variable, coefficient] of expression) addTerm(result, variable, coefficient * factor)
  return result
}

function expressionValue(expression: LinearExpression, values: Map<string, number>) {
  let result = 0
  for (const [variable, coefficient] of expression) result += coefficient * (values.get(variable) ?? 0)
  return result
}

function addConstraint(model: OptimizationModel, expression: LinearExpression, bounds: Constraint) {
  const name = `c${model.constraints.size}`
  for (const [variable, coefficient] of expression) {
    const coefficients = model.variables.get(variable)
    if (coefficients) coefficients.set(name, coefficient)
  }
  model.constraints.set(name, bounds)
}

function addVariable(model: OptimizationModel, name: string) {
  model.variables.set(name, new Map())
}

function addEquality(model: OptimizationModel, left: LinearExpression, right: LinearExpression) {
  const expression = addExpressions(left, scaleExpression(right, -1))
  if (expression.size > 0) addConstraint(model, expression, { equal: 0 })
}

function addObjective(model: OptimizationModel) {
  const objective = 'objective'
  for (const group of model.groups) {
    if (model.direction === 'maximize') model.variables.get(group.visible)!.set(objective, group.count)
    else {
      model.variables.get(group.width)!.set(objective, group.count)
      model.variables.get(group.height)!.set(objective, group.count)
    }
  }
}

function collectLeaves(tree: LayoutNode, callback: (panelId: PanelId) => void) {
  if (tree.kind === 'leaf') {
    callback(tree.panelId)
    return
  }
  collectLeaves(tree.first, callback)
  collectLeaves(tree.second, callback)
}

function treeKey(tree: LayoutNode, highlighted: ReadonlySet<PanelId>, aspect: number) {
  const visit = (node: LayoutNode): string => node.kind === 'leaf'
    ? `l${highlighted.has(node.panelId) ? '1' : '0'}`
    : `s${node.direction[0]}${node.ratio.toFixed(9)}(${visit(node.first)}${visit(node.second)})`
  return `${safeAspect(aspect).toFixed(9)}|${visit(tree)}`
}

function cloneCached(result: CachedResult): VideoLayoutOptimization {
  return { status: result.status, ratios: new Map(result.ratios) }
}

function makeModel(
  tree: LayoutNode,
  rects: ReadonlyArray<LayoutRect>,
  highlighted: ReadonlySet<PanelId>,
  aspect: number,
  qBounds?: Map<string, { min: number; max: number }>,
  objective: 'maximize' | 'minimize' = 'maximize',
): OptimizationModel | null {
  const safe = safeAspect(aspect)
  const a = Math.min(1, safe / VIDEO_ASPECT)
  const b = Math.min(1, VIDEO_ASPECT / safe)
  const rectById = new Map(rects.map((rect) => [rect.panelId, rect]))
  if (rects.length === 0 || rectById.size !== rects.length || rects.some((rect) => ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))) return null
  const groupByKey = new Map<string, Group>()
  const groups: Group[] = []

  collectLeaves(tree, (panelId) => {
    const rect = rectById.get(panelId)
    if (!rect || ![rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return
    const q0 = Math.min(a * rect.width, b * rect.height)
    if (!Number.isFinite(q0) || q0 <= 0) return
    const groupKey = `${highlighted.has(panelId) ? 1 : 0}|${rect.width.toFixed(9)}|${rect.height.toFixed(9)}`
    let group = groupByKey.get(groupKey)
    if (!group) {
      const index = groups.length
      group = {
        key: groupKey,
        panelIds: [],
        highlighted: highlighted.has(panelId),
        count: 0,
        q0,
        width: `w${index}`,
        height: `h${index}`,
        visible: `q${index}`,
        branch: `z${index}`,
      }
      groupByKey.set(groupKey, group)
      groups.push(group)
    }
    group.panelIds.push(panelId)
    group.count += 1
    group.q0 = Math.max(group.q0, q0)
  })

  const leafCount = rects.length
  if (groups.length === 0 || groups.reduce((sum, group) => sum + group.count, 0) !== leafCount) return null

  const model: OptimizationModel = {
    groups,
    expressions: new Map(),
    constraints: new Map(),
    variables: new Map(),
    binaries: new Set(),
    direction: objective,
  }
  for (const group of groups) {
    addVariable(model, group.width)
    addVariable(model, group.height)
    addVariable(model, group.visible)
    addVariable(model, group.branch)
    model.binaries.add(group.branch)
    const bounds = qBounds?.get(group.key) ?? { min: group.q0, max: 1 }
    addConstraint(model, new Map([[group.width, 1]]), { min: 0, max: 1 })
    addConstraint(model, new Map([[group.height, 1]]), { min: 0, max: 1 })
    addConstraint(model, new Map([[group.visible, 1]]), { min: Math.max(group.q0, bounds.min), max: Math.min(1, bounds.max) })
    addConstraint(model, new Map([[group.visible, 1], [group.width, -a]]), { max: 0 })
    addConstraint(model, new Map([[group.visible, 1], [group.height, -b]]), { max: 0 })
    addConstraint(model, new Map([[group.width, a], [group.visible, -1], [group.branch, -1]]), { max: 0 })
    addConstraint(model, new Map([[group.height, b], [group.visible, -1], [group.branch, 1]]), { max: 1 })
  }

  const visit = (node: LayoutNode): NodeExpression => {
    const existing = model.expressions.get(node)
    if (existing) return existing
    if (node.kind === 'leaf') {
      const group = groups.find((candidate) => candidate.panelIds.includes(node.panelId))
      if (!group) throw new Error(`Painel sem grupo: ${node.panelId}`)
      const expression = { width: new Map([[group.width, 1]]), height: new Map([[group.height, 1]]) }
      model.expressions.set(node, expression)
      return expression
    }
    const first = visit(node.first)
    const second = visit(node.second)
    const expression = node.direction === 'row'
      ? { width: addExpressions(first.width, second.width), height: new Map(first.height) }
      : { width: new Map(first.width), height: addExpressions(first.height, second.height) }
    model.expressions.set(node, expression)
    if (node.direction === 'row') addEquality(model, first.height, second.height)
    else addEquality(model, first.width, second.width)
    return expression
  }
  const root = visit(tree)
  addConstraint(model, root.width, { equal: 1 })
  addConstraint(model, root.height, { equal: 1 })

  const large = groups.filter((group) => group.highlighted)
  const small = groups.filter((group) => !group.highlighted)
  if (large.length > 0 && small.length > 0) {
    const ratio = Math.min(...large.map((group) => group.q0)) / Math.max(...small.map((group) => group.q0))
    if (Number.isFinite(ratio) && ratio > 0) {
      for (const largeGroup of large) {
        for (const smallGroup of small) {
          addConstraint(model, new Map([[largeGroup.visible, 1], [smallGroup.visible, -ratio]]), { min: 0 })
        }
      }
    }
  }

  addObjective(model)
  return model
}

function solveModel(model: OptimizationModel) {
  const variables = new Map(model.variables)
  const solution = solve({
    direction: model.direction,
    objective: 'objective',
    constraints: model.constraints,
    variables,
    binaries: model.binaries,
  } satisfies Model<string, string>, {
    precision: 1e-9,
    tolerance: 0,
    includeZeroVariables: true,
    maxPivots: 8192,
    maxIterations: 32768,
    timeout: 100,
  })
  return solution
}

function solutionValues(solution: Solution<string>) {
  return new Map(solution.variables.map(([name, value]) => [name, value]))
}

function validateSolution(model: OptimizationModel, solution: Solution<string>, aspect: number) {
  if (solution.status !== 'optimal') return null
  const values = solutionValues(solution)
  const safe = safeAspect(aspect)
  const a = Math.min(1, safe / VIDEO_ASPECT)
  const b = Math.min(1, VIDEO_ASPECT / safe)
  for (const group of model.groups) {
    const width = values.get(group.width)
    const height = values.get(group.height)
    const visible = values.get(group.visible)
    if (![width, height, visible].every((value) => Number.isFinite(value))) return null
    if (width! <= 0 || height! <= 0 || visible! <= 0 || visible! + VALIDATION_TOLERANCE < group.q0) return null
    if (Math.abs(visible! - Math.min(a * width!, b * height!)) > VALIDATION_TOLERANCE) return null
  }
  return values
}

function ratiosFromSolution(model: OptimizationModel, values: Map<string, number>) {
  const ratios = new Map<string, number>()
  for (const [node] of model.expressions) {
    if (node.kind === 'leaf') continue
    const first = node.direction === 'row' ? expressionValue(model.expressions.get(node.first)!.width, values) : expressionValue(model.expressions.get(node.first)!.height, values)
    const second = node.direction === 'row' ? expressionValue(model.expressions.get(node.second)!.width, values) : expressionValue(model.expressions.get(node.second)!.height, values)
    const total = first + second
    const ratio = first / total
    if (!Number.isFinite(ratio) || ratio <= EPSILON || ratio >= 1 - EPSILON) return null
    ratios.set(node.id, ratio)
  }
  return ratios
}

function optimize(tree: LayoutNode, rects: ReadonlyArray<LayoutRect>, highlighted: ReadonlySet<PanelId>, aspect: number): VideoLayoutOptimization {
  let firstModel: OptimizationModel | null
  try {
    firstModel = makeModel(tree, rects, highlighted, aspect)
  } catch (error) {
    return { status: 'fallback', ratios: new Map(), reason: error instanceof Error ? error.message : 'modelo inválido' }
  }
  if (!firstModel) return { status: 'fallback', ratios: new Map(), reason: 'modelo inválido' }
  let firstSolution: Solution<string>
  try {
    firstSolution = solveModel(firstModel)
  } catch (error) {
    return { status: 'fallback', ratios: new Map(), reason: error instanceof Error ? error.message : 'erro no solver' }
  }
  const firstValues = validateSolution(firstModel, firstSolution, aspect)
  if (!firstValues) return { status: 'fallback', ratios: new Map(), reason: `solver: ${firstSolution.status}` }
  const baseline = firstModel.groups.reduce((sum, group) => sum + group.count * group.q0, 0)
  const optimum = firstModel.groups.reduce((sum, group) => sum + group.count * (firstValues.get(group.visible) ?? 0), 0)
  if (optimum <= baseline + VALIDATION_TOLERANCE) return { status: 'unchanged', ratios: new Map() }

  const qBounds = new Map<string, { min: number; max: number }>()
  for (const group of firstModel.groups) {
    const q = firstValues.get(group.visible)!
    qBounds.set(group.key, { min: Math.max(group.q0, q - VALIDATION_TOLERANCE), max: Math.min(1, q + VALIDATION_TOLERANCE) })
  }
  const compactModel = makeModel(tree, rects, highlighted, aspect, qBounds, 'minimize')
  let chosenValues = firstValues
  if (compactModel) {
    try {
      const compactSolution = solveModel(compactModel)
      const compactValues = validateSolution(compactModel, compactSolution, aspect)
      if (compactValues) {
        chosenValues = compactValues
        const ratios = ratiosFromSolution(compactModel, compactValues)
        if (ratios) return { status: 'optimized', ratios }
      }
    } catch {
      // Use the first optimal solution when the cosmetic compaction pass times out.
    }
  }
  const ratios = ratiosFromSolution(firstModel, chosenValues)
  return ratios ? { status: 'optimized', ratios } : { status: 'fallback', ratios: new Map(), reason: 'razões inválidas' }
}

export function optimizeVideoLayout(tree: LayoutNode, rects: ReadonlyArray<LayoutRect>, highlighted: ReadonlySet<PanelId>, aspect: number): VideoLayoutOptimization {
  if (!Number.isFinite(aspect) || aspect <= 0) return { status: 'fallback', ratios: new Map(), reason: 'aspect inválido' }
  const key = treeKey(tree, highlighted, aspect)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cloneCached(cached)
  }
  const result = optimize(tree, rects, highlighted, aspect)
  if (result.status !== 'fallback') {
    cache.set(key, { status: result.status, ratios: new Map(result.ratios) })
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  return result
}
