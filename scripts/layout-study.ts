/**
 * Layout study for extending Quadra beyond 16 panels.
 *
 * Usage:
 *   node --experimental-strip-types scripts/layout-study.ts
 *   node --experimental-strip-types scripts/layout-study.ts --write-fixture
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applySplitRatios,
  assignSlots,
  calculateLayout,
  CORNERS,
  getCompositions,
  gridTree,
  makeSideSplit,
  MAX_PANELS,
  quadrantTree,
  resolveComposition,
  SIDE_WEIGHTS,
  SIDES,
  validateLayout,
  viewingScore,
  type HighlightPosition,
  type LayoutNode,
  type LayoutRect,
} from '../src/layout.ts'
import { optimizeVideoLayout } from '../src/video-layout.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/video-layout-reference.json')
const OUT_DIR = path.join(ROOT, 'artifacts/layout-study')
const REFERENCE_ASPECT = 16 / 9
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

type VideoMetrics = { width: number; height: number; q: number }

type CandidateMetrics = {
  variant: string
  position: HighlightPosition | null
  highlightCount: number
  coverage: number
  sumWidth: number
  viewingScore: number
  minSmallQ: number
  highlightRatio: number
  optimizerStatus: string
  optimizerMs: number
  gained: boolean
  baselineCoverage: number
  baselineSumWidth: number
  valid: boolean
  rects: LayoutRect[]
  baselineRects: LayoutRect[]
  videos: Array<{ panelId: string; width: number; height: number }>
}

type CompositionRecommendation = {
  count: number
  highlightCount: number
  style: 'equal' | 'sides' | 'corners'
  recommendedWeight?: number
  recommendedVariant: string
  recommendedPosition: HighlightPosition | null
  coverage: number
  sumWidth: number
  highlightRatio: number
  minSmallQ: number
  robustAtAspects: boolean
  top: CandidateMetrics[]
}

type StudyReport = {
  validatedReferences: { matched: number; expected: number; gains: number; ok: boolean; mismatches: string[] }
  recommendations: CompositionRecommendation[]
  decisions: {
    weights: Record<number, number>
    defaultHighlightCount: Record<number, number>
    capacities: Record<number, number[]>
    cornerCompositions: Array<{ count: number; highlightCount: number }>
  }
}

function videoSize(rect: { width: number; height: number }, aspect: number, width: number, height: number): VideoMetrics {
  const a = Math.min(1, aspect / REFERENCE_ASPECT)
  const b = Math.min(1, REFERENCE_ASPECT / aspect)
  const q = Math.min(a * rect.width, b * rect.height)
  const canvasWidth = Math.max(width, REFERENCE_ASPECT * height)
  return { width: q * canvasWidth, height: q * canvasWidth / REFERENCE_ASPECT, q }
}

function panelIds(count: number) {
  return Array.from({ length: count }, (_, index) => String(index + 1))
}

function evaluateTree(
  tree: LayoutNode,
  largeIds: string[],
  smallIds: string[],
  aspect: number,
  width: number,
  height: number,
  variant: string,
  position: HighlightPosition | null,
  highlightCount: number,
): CandidateMetrics {
  const assigned = assignSlots(tree, largeIds, smallIds)
  const baselineRects = calculateLayout(assigned).rects
  const started = performance.now()
  const optimization = optimizeVideoLayout(assigned, baselineRects, new Set(largeIds), aspect)
  const optimizerMs = performance.now() - started
  const optimized = optimization.status === 'optimized' ? applySplitRatios(assigned, optimization.ratios) : assigned
  const valid = validateLayout(calculateLayout(optimized), new Set([...largeIds, ...smallIds]))
  const rects = calculateLayout(valid ? optimized : assigned).rects
  const allIds = [...largeIds, ...smallIds]
  let coverage = 0
  let sumWidth = 0
  let baselineCoverage = 0
  let baselineSumWidth = 0
  const videos: Array<{ panelId: string; width: number; height: number }> = []
  const baselineById = new Map(baselineRects.map((rect) => [rect.panelId, rect]))
  for (const id of allIds) {
    const rect = rects.find((entry) => entry.panelId === id)!
    const video = videoSize(rect, aspect, width, height)
    const baseline = videoSize(baselineById.get(id)!, aspect, width, height)
    coverage += video.q * video.q
    sumWidth += video.width
    baselineCoverage += baseline.q * baseline.q
    baselineSumWidth += baseline.width
    videos.push({ panelId: id, width: video.width, height: video.height })
  }
  const largeQs = rects.filter((rect) => largeIds.includes(rect.panelId)).map((rect) => videoSize(rect, aspect, width, height).q)
  const smallQs = rects.filter((rect) => smallIds.includes(rect.panelId)).map((rect) => videoSize(rect, aspect, width, height).q)
  const minSmallQ = smallQs.length > 0 ? Math.min(...smallQs) : Math.min(...largeQs, 0)
  const highlightRatio = largeQs.length > 0 && smallQs.length > 0
    ? Math.min(...largeQs) / Math.max(...smallQs)
    : Number.POSITIVE_INFINITY
  return {
    variant,
    position,
    highlightCount,
    coverage: coverage * 100,
    sumWidth,
    viewingScore: viewingScore(tree, aspect),
    minSmallQ,
    highlightRatio,
    optimizerStatus: optimization.status,
    optimizerMs,
    gained: sumWidth > baselineSumWidth + 0.001,
    baselineCoverage: baselineCoverage * 100,
    baselineSumWidth,
    valid,
    rects,
    baselineRects,
    videos,
  }
}

function exploreEqual(count: number, aspect: number, width: number, height: number) {
  const ids = panelIds(count)
  const slots = ids.map((_, index) => `small-${index}`)
  const results: CandidateMetrics[] = []
  for (let rows = 1; rows <= count; rows += 1) {
    const tree = gridTree(slots, rows, 'e')
    results.push(evaluateTree(tree, [], ids, aspect, width, height, `${count}-0:rows-${rows}`, null, 0))
  }
  return results.sort(rankCandidates)
}

function exploreSides(count: number, highlightCount: number, aspect: number, width: number, height: number, weights = [2, 3, 4, 5, 6, 7]) {
  const ids = panelIds(count)
  const largeIds = ids.slice(0, highlightCount)
  const smallIds = ids.slice(highlightCount)
  const largeSlots = largeIds.map((_, index) => `large-${index}`)
  const smallSlots = smallIds.map((_, index) => `small-${index}`)
  const results: CandidateMetrics[] = []
  for (const place of SIDES) {
    for (const weight of weights) {
      const tree = makeSideSplit(place, weight, largeSlots, smallSlots, aspect)
      results.push(evaluateTree(
        tree,
        largeIds,
        smallIds,
        aspect,
        width,
        height,
        `${count}-${highlightCount}:${place}:${weight}`,
        place,
        highlightCount,
      ))
    }
  }
  return results.sort(rankCandidates)
}

function exploreCorners(count: number, highlightCount: number, aspect: number, width: number, height: number) {
  const ids = panelIds(count)
  const largeIds = ids.slice(0, highlightCount)
  const smallIds = ids.slice(highlightCount)
  const results: CandidateMetrics[] = []
  for (const place of CORNERS) {
    try {
      const tree = quadrantTree(count, highlightCount, place)
      results.push(evaluateTree(
        tree,
        largeIds,
        smallIds,
        aspect,
        width,
        height,
        `${count}-${highlightCount}:quadrants`,
        place,
        highlightCount,
      ))
    } catch {
      // Invalid quadrant geometry for this count/highlights.
    }
  }
  return results.sort(rankCandidates)
}

function hierarchyTier(ratio: number) {
  if (!Number.isFinite(ratio)) return 3
  if (ratio > 3) return 3
  if (ratio > 1.1) return 2
  if (ratio > 1) return 1
  return 0
}

function rankCandidates(a: CandidateMetrics, b: CandidateMetrics) {
  if (a.valid !== b.valid) return a.valid ? -1 : 1
  const tierDiff = hierarchyTier(b.highlightRatio) - hierarchyTier(a.highlightRatio)
  if (tierDiff !== 0) return tierDiff
  if (Math.abs(a.coverage - b.coverage) > 1e-6) return b.coverage - a.coverage
  if (Math.abs(a.sumWidth - b.sumWidth) > 1e-6) return b.sumWidth - a.sumWidth
  if (Math.abs(a.minSmallQ - b.minSmallQ) > 1e-9) return b.minSmallQ - a.minSmallQ
  return b.viewingScore - a.viewingScore
}

function pickWeightForResolve(count: number, highlightCount: number, position: HighlightPosition, aspect: number, width: number, height: number) {
  const explored = exploreSides(count, highlightCount, aspect, width, height, [2, 3, 4, 5, 6, 7])
    .filter((entry) => entry.position === position && entry.valid)
  if (explored.length === 0) return { weight: 4, candidate: null as CandidateMetrics | null }
  const ranked = [...explored].sort(rankCandidates)
  const bestWeight = Number(ranked[0].variant.split(':').at(-1))
  // SIDE_WEIGHTS[n] is the center of a ±1 search. Prefer a center that still selects the global best.
  const byWeight = new Map<number, CandidateMetrics>()
  for (const entry of explored) {
    const weight = Number(entry.variant.split(':').at(-1))
    if (!byWeight.has(weight)) byWeight.set(weight, entry)
  }
  let center = bestWeight
  for (const candidate of [bestWeight, bestWeight - 1, bestWeight + 1]) {
    if (!byWeight.has(candidate) && candidate !== bestWeight) continue
    const neighborhood = [candidate - 1, candidate, candidate + 1]
      .map((value) => byWeight.get(value))
      .filter((entry): entry is CandidateMetrics => Boolean(entry))
    if (neighborhood.length === 0) continue
    const winner = [...neighborhood].sort(rankCandidates)[0]
    if (Number(winner.variant.split(':').at(-1)) === bestWeight) {
      center = candidate
      break
    }
  }
  return { weight: center, candidate: byWeight.get(bestWeight) ?? ranked[0] }
}

function recommendForCount(count: number, width = 1920, height = 1080) {
  const aspect = width / height
  const recommendations: CompositionRecommendation[] = []
  const equal = exploreEqual(count, aspect, width, height)
  const equalBest = equal[0]
  recommendations.push({
    count,
    highlightCount: 0,
    style: 'equal',
    recommendedVariant: equalBest.variant,
    recommendedPosition: null,
    coverage: equalBest.coverage,
    sumWidth: equalBest.sumWidth,
    highlightRatio: equalBest.highlightRatio,
    minSmallQ: equalBest.minSmallQ,
    robustAtAspects: true,
    top: equal.slice(0, 3),
  })

  for (const highlightCount of [1, 2, 3]) {
    if (highlightCount >= count) continue
    const sides = exploreSides(count, highlightCount, aspect, width, height)
    const corners = exploreCorners(count, highlightCount, aspect, width, height)
    const sideBest = sides[0]
    const cornerBest = corners[0]
    const useCorners = Boolean(
      cornerBest?.valid
      && sideBest?.valid
      && (
        cornerBest.coverage > sideBest.coverage + 0.5
        || (cornerBest.highlightRatio >= 3 && sideBest.highlightRatio < 3 && cornerBest.coverage >= sideBest.coverage - 1)
      ),
    )
    // Special-case: 18 with 2 mirrors the proven 10-with-2 quadrant pattern when geometry fits.
    const preferCornersLikeTen = count === 18 && highlightCount === 2 && Boolean(cornerBest?.valid)
    const style = preferCornersLikeTen || useCorners ? 'corners' : 'sides'
    if (style === 'corners' && cornerBest) {
      const robust = CORNERS.every((place) => {
        const match = corners.find((entry) => entry.position === place)
        return Boolean(match?.valid)
      })
      recommendations.push({
        count,
        highlightCount,
        style,
        recommendedVariant: cornerBest.variant,
        recommendedPosition: cornerBest.position,
        coverage: cornerBest.coverage,
        sumWidth: cornerBest.sumWidth,
        highlightRatio: cornerBest.highlightRatio,
        minSmallQ: cornerBest.minSmallQ,
        robustAtAspects: robust,
        top: corners.slice(0, 3),
      })
    } else if (sideBest) {
      const leftPick = pickWeightForResolve(count, highlightCount, 'left', aspect, width, height)
      const topPick = pickWeightForResolve(count, highlightCount, 'top', aspect, width, height)
      const bestWeights = [leftPick, topPick]
        .map((pick) => pick.candidate ? Number(pick.candidate.variant.split(':').at(-1)) : pick.weight)
        .filter((value) => Number.isFinite(value))
      // One shared SIDE_WEIGHTS[n] center whose ±1 window covers the per-position winners.
      const minBest = Math.min(...bestWeights)
      const maxBest = Math.max(...bestWeights)
      const resolvedWeight = Math.min(7, Math.max(2, Math.round((minBest + maxBest) / 2)))
      const representative = [leftPick.candidate, topPick.candidate, sideBest].find((entry): entry is CandidateMetrics => Boolean(entry))!
      const robustAspects = [
        { width: 1920, height: 1080 },
        { width: 2520, height: 1080 },
        { width: 1440, height: 900 },
      ].every((size) => {
        const local = exploreSides(count, highlightCount, size.width / size.height, size.width, size.height, [resolvedWeight - 1, resolvedWeight, resolvedWeight + 1])
          .filter((entry) => entry.position === 'left' && entry.valid)
          .sort(rankCandidates)
        return local.length > 0 && hierarchyTier(local[0].highlightRatio) >= 2
      })
      recommendations.push({
        count,
        highlightCount,
        style,
        recommendedWeight: resolvedWeight,
        recommendedVariant: representative.variant,
        recommendedPosition: representative.position,
        coverage: representative.coverage,
        sumWidth: representative.sumWidth,
        highlightRatio: representative.highlightRatio,
        minSmallQ: representative.minSmallQ,
        robustAtAspects: robustAspects,
        top: sides.filter((entry) => entry.position === representative.position).slice(0, 3),
      })
    }
  }
  return recommendations
}

function validateReferences() {
  const reference = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as {
    width: number
    height: number
    cases: Array<{
      key: string
      count: number
      highlightCount: number
      position: HighlightPosition | null
      variant: string
      expectedCoverage: number
      expectedSumWidth: number
      expectedVideos: Array<{ panelId: string; width: number; height: number }>
      baselineRects: Array<{ panelId: string; width: number; height: number }>
    }>
  }
  const aspect = reference.width / reference.height
  const mismatches: string[] = []
  let gains = 0
  for (const entry of reference.cases) {
    if (entry.count > 16) continue
    const ids = panelIds(entry.count)
    const resolved = resolveComposition(ids, {
      mode: entry.highlightCount === 0 ? 'equal' : 'highlights',
      highlighted: new Set(ids.slice(0, entry.highlightCount)),
      position: entry.position ?? undefined,
      aspect,
    })
    if (resolved.variant !== entry.variant) mismatches.push(`${entry.key}: variant ${resolved.variant} != ${entry.variant}`)
    const result = calculateLayout(resolved.tree)
    let coverage = 0
    let sumWidth = 0
    let baselineWidth = 0
    for (const baseline of entry.baselineRects) baselineWidth += videoSize(baseline, aspect, reference.width, reference.height).width
    for (const expected of entry.expectedVideos) {
      const rect = result.rects.find((candidate) => candidate.panelId === expected.panelId)!
      const video = videoSize(rect, aspect, reference.width, reference.height)
      if (Math.abs(video.width - expected.width) > 0.05) mismatches.push(`${entry.key}/${expected.panelId}: width`)
      if (Math.abs(video.height - expected.height) > 0.05) mismatches.push(`${entry.key}/${expected.panelId}: height`)
      coverage += video.q * video.q
      sumWidth += video.width
    }
    if (Math.abs(coverage * 100 - entry.expectedCoverage) > 0.001) mismatches.push(`${entry.key}: coverage`)
    if (Math.abs(sumWidth - entry.expectedSumWidth) > 0.05) mismatches.push(`${entry.key}: sumWidth`)
    if (entry.expectedSumWidth > baselineWidth + 0.001) gains += 1
  }
  const expected = reference.cases.filter((entry) => entry.count <= 16).length
  return { matched: expected - mismatches.length, expected, gains, ok: mismatches.length === 0, mismatches: mismatches.slice(0, 20) }
}

function toFixtureCase(candidate: CandidateMetrics, count: number) {
  const positionKey = candidate.position ?? 'equal'
  return {
    key: `${count}-${candidate.highlightCount}-${positionKey}`,
    count,
    highlightCount: candidate.highlightCount,
    position: candidate.position,
    variant: candidate.variant,
    baselineRects: candidate.baselineRects.map(({ panelId, x, y, width, height }) => ({ panelId, x, y, width, height })),
    expectedVideos: candidate.videos.map(({ panelId, width, height }) => ({ panelId, width, height })),
    expectedCoverage: candidate.coverage,
    expectedSumWidth: candidate.sumWidth,
  }
}

function buildFixtureCases() {
  const width = 1920
  const height = 1080
  const aspect = width / height
  const cases = []
  for (let count = 1; count <= MAX_PANELS; count += 1) {
    for (const composition of getCompositions(count)) {
      const positions = composition.positions.length > 0 ? composition.positions : [undefined]
      for (const position of positions) {
        const ids = panelIds(count)
        const resolved = resolveComposition(ids, {
          mode: composition.highlightCount === 0 ? 'equal' : 'highlights',
          highlighted: new Set(ids.slice(0, composition.highlightCount)),
          position,
          aspect,
        })
        const assignedTree = (() => {
          // Rebuild baseline (pre-optimizer) by re-resolving with a no-op path: capture via evaluate.
          return resolved
        })()
        void assignedTree
        // Use explore helpers to capture baseline + optimized consistently with the product path.
        let metrics: CandidateMetrics
        if (composition.highlightCount === 0) {
          const rows = Number(resolved.variant.split('rows-')[1])
          metrics = exploreEqual(count, aspect, width, height).find((entry) => entry.variant === resolved.variant)
            ?? evaluateTree(gridTree(ids.map((_, index) => `small-${index}`), rows, 'e'), [], ids, aspect, width, height, resolved.variant, null, 0)
        } else if (composition.positions[0] === 'top-left') {
          metrics = evaluateTree(
            quadrantTree(count, composition.highlightCount, position!),
            ids.slice(0, composition.highlightCount),
            ids.slice(composition.highlightCount),
            aspect,
            width,
            height,
            resolved.variant,
            position!,
            composition.highlightCount,
          )
        } else {
          const weight = Number(resolved.variant.split(':').at(-1))
          metrics = evaluateTree(
            makeSideSplit(position!, weight, ids.slice(0, composition.highlightCount).map((_, index) => `large-${index}`), ids.slice(composition.highlightCount).map((_, index) => `small-${index}`), aspect),
            ids.slice(0, composition.highlightCount),
            ids.slice(composition.highlightCount),
            aspect,
            width,
            height,
            resolved.variant,
            position!,
            composition.highlightCount,
          )
        }
        // Prefer the actual resolved tree videos to guarantee fixture matches resolveComposition.
        const result = calculateLayout(resolved.tree)
        let coverage = 0
        let sumWidth = 0
        const videos = result.rects.map((rect) => {
          const video = videoSize(rect, aspect, width, height)
          coverage += video.q * video.q
          sumWidth += video.width
          return { panelId: rect.panelId, width: video.width, height: video.height }
        })
        cases.push({
          key: `${count}-${composition.highlightCount}-${position ?? 'equal'}`,
          count,
          highlightCount: composition.highlightCount,
          position: position ?? null,
          variant: resolved.variant,
          baselineRects: metrics.baselineRects.map(({ panelId, x, y, width: w, height: h }) => ({ panelId, x, y, width: w, height: h })),
          expectedVideos: videos.sort((a, b) => Number(a.panelId) - Number(b.panelId)),
          expectedCoverage: coverage * 100,
          expectedSumWidth: sumWidth,
        })
      }
    }
  }
  return cases
}

function svgFor(candidate: CandidateMetrics, title: string) {
  const width = 960
  const height = 540
  const rects = candidate.rects.map((rect) => {
    const x = rect.x * width
    const y = rect.y * height
    const w = rect.width * width
    const h = rect.height * height
    const isLarge = !rect.panelId.startsWith('small') && Number(rect.panelId) <= candidate.highlightCount
    const fill = isLarge || (candidate.highlightCount > 0 && Number(rect.panelId) <= candidate.highlightCount)
      ? '#2f6f4e'
      : '#1a3d2e'
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" stroke="#020806" stroke-width="2"/><text x="${(x + w / 2).toFixed(2)}" y="${(y + h / 2).toFixed(2)}" fill="#c8f560" font-size="14" text-anchor="middle" dominant-baseline="middle">${rect.panelId}</text>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${title}</title><rect width="100%" height="100%" fill="#020806"/>${rects}<text x="12" y="24" fill="#c8f560" font-size="16">${title}</text><text x="12" y="44" fill="#9bb89a" font-size="12">coverage=${candidate.coverage.toFixed(2)} sumWidth=${candidate.sumWidth.toFixed(1)} ratio=${Number.isFinite(candidate.highlightRatio) ? candidate.highlightRatio.toFixed(2) : 'n/a'}</text></svg>`
}

function markdownReport(report: StudyReport) {
  const lines = [
    '# Layout study: 17 and 18 panels',
    '',
    `Reference validation: ${report.validatedReferences.ok ? 'PASS' : 'FAIL'} (${report.validatedReferences.matched}/${report.validatedReferences.expected}, gains=${report.validatedReferences.gains})`,
    '',
    '## Decisions',
    '',
    '```json',
    JSON.stringify(report.decisions, null, 2),
    '```',
    '',
    '## Recommendations',
    '',
  ]
  for (const entry of report.recommendations) {
    lines.push(`### ${entry.count} panels · ${entry.highlightCount} highlights · ${entry.style}`)
    lines.push('')
    lines.push(`- variant: \`${entry.recommendedVariant}\``)
    if (entry.recommendedWeight != null) lines.push(`- weight: ${entry.recommendedWeight}`)
    lines.push(`- coverage: ${entry.coverage.toFixed(3)}`)
    lines.push(`- sumWidth: ${entry.sumWidth.toFixed(2)}`)
    lines.push(`- highlightRatio: ${Number.isFinite(entry.highlightRatio) ? entry.highlightRatio.toFixed(3) : 'n/a'}`)
    lines.push(`- minSmallQ: ${entry.minSmallQ.toFixed(5)}`)
    lines.push(`- robust: ${entry.robustAtAspects}`)
    lines.push('')
    lines.push('| rank | variant | coverage | sumWidth | ratio | optimizer |')
    lines.push('| --- | --- | ---: | ---: | ---: | --- |')
    entry.top.forEach((candidate, index) => {
      lines.push(`| ${index + 1} | \`${candidate.variant}\` | ${candidate.coverage.toFixed(3)} | ${candidate.sumWidth.toFixed(1)} | ${Number.isFinite(candidate.highlightRatio) ? candidate.highlightRatio.toFixed(2) : 'n/a'} | ${candidate.optimizerStatus} (${candidate.optimizerMs.toFixed(1)}ms) |`)
    })
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log('Validating existing 1–16 references…')
  const validatedReferences = validateReferences()
  console.log(JSON.stringify(validatedReferences, null, 2))
  if (!validatedReferences.ok) {
    console.error('Reference validation failed; aborting study.')
    process.exitCode = 1
    return
  }

  console.log('Studying 17 and 18…')
  const recommendations = [...recommendForCount(17), ...recommendForCount(18)]
  const corners18 = recommendations.some((entry) => entry.count === 18 && entry.highlightCount === 2 && entry.style === 'corners')
  // Keep the standard [0,1,2] catalog unless 3 highlights clearly beats 2 with the same style
  // and a usable hierarchy (mirrors the special-case reasoning used for 7 panels).
  const includeThree = (count: number) => {
    const two = recommendations.find((entry) => entry.count === count && entry.highlightCount === 2)
    const three = recommendations.find((entry) => entry.count === count && entry.highlightCount === 3)
    return Boolean(
      three
      && two
      && three.style === two.style
      && hierarchyTier(three.highlightRatio) >= 2
      && three.coverage > two.coverage + 2,
    )
  }

  // Shared SIDE_WEIGHTS[n] must also suit 2-highlight side layouts when that count uses sides.
  const weightFor = (count: number) => {
    const one = recommendations.find((entry) => entry.count === count && entry.highlightCount === 1 && entry.style === 'sides')
    if (Number.isFinite(one?.recommendedWeight)) return one!.recommendedWeight!
    const two = recommendations.find((entry) => entry.count === count && entry.highlightCount === 2 && entry.style === 'sides')
    return two?.recommendedWeight ?? 4
  }

  const decisions = {
    weights: { 17: weightFor(17), 18: weightFor(18) },
    defaultHighlightCount: {
      17: 0,
      18: corners18 ? 2 : 0,
    },
    capacities: {
      17: includeThree(17) ? [0, 1, 2, 3] : [0, 1, 2],
      18: includeThree(18) ? [0, 1, 2, 3] : [0, 1, 2],
    },
    cornerCompositions: corners18 ? [{ count: 18, highlightCount: 2 }] : [],
  }

  const report: StudyReport = { validatedReferences, recommendations, decisions }
  fs.writeFileSync(path.join(OUT_DIR, 'study-17-18.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(OUT_DIR, 'study-17-18.md'), markdownReport(report))

  for (const entry of recommendations) {
    entry.top.slice(0, 3).forEach((candidate, index) => {
      const name = `${entry.count}-${entry.highlightCount}-${entry.style}-top${index + 1}.svg`
      fs.writeFileSync(path.join(OUT_DIR, name), svgFor(candidate, name))
    })
  }

  // Persist decisions for the implementation step.
  fs.writeFileSync(path.join(OUT_DIR, 'decisions.json'), `${JSON.stringify(decisions, null, 2)}\n`)
  console.log('Wrote study artifacts to', OUT_DIR)
  console.log('Decisions:', JSON.stringify(decisions, null, 2))

  if (WRITE_FIXTURE) {
    // Apply decided weights into SIDE_WEIGHTS before regenerating (caller should have updated layout.ts).
    const cases = buildFixtureCases()
    const sourceFiles = ['src/layout.ts', 'src/video-layout.ts']
      .map((relative) => fs.readFileSync(path.join(ROOT, relative)))
    const sourceHash = crypto.createHash('sha256').update(Buffer.concat(sourceFiles)).digest('hex')
    const fixture = { width: 1920, height: 1080, sourceHash, cases }
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
    const gains = cases.filter((entry) => entry.expectedSumWidth > entry.baselineRects.reduce((sum, rect) => sum + videoSize(rect, REFERENCE_ASPECT, 1920, 1080).width, 0) + 0.001).length
    console.log(`Wrote fixture with ${cases.length} cases (gains≈${gains}), sourceHash=${sourceHash}`)
  }
}

main()
