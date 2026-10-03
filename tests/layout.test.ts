import test from 'node:test'
import assert from 'node:assert/strict'
import './organizer.test.ts'
import fs from 'node:fs'
import {
  buildLayoutTree,
  calculateLayout,
  collectPanelIds,
  getCompositions,
  defaultHighlightCount,
  resolveComposition,
  updateSplitRatio,
  validateLayout,
  type HighlightPosition,
  type LayoutNode,
} from '../src/layout.ts'
import { optimizeVideoLayout } from '../src/video-layout.ts'

const ASPECTS = [16 / 9, 9 / 16, 21 / 9]
const CORNERS: HighlightPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const SIDES: HighlightPosition[] = ['left', 'right', 'top', 'bottom']

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `panel-${index + 1}`)
}

function rectFor(tree: LayoutNode, id: string) {
  return calculateLayout(tree).rects.find((rect) => rect.panelId === id)!
}

function videoSize(rect: { width: number; height: number }, aspect: number, width: number, height: number) {
  const reference = 16 / 9
  const a = Math.min(1, aspect / reference)
  const b = Math.min(1, reference / aspect)
  const q = Math.min(a * rect.width, b * rect.height)
  const canvasWidth = Math.max(width, reference * height)
  return { width: q * canvasWidth, height: q * canvasWidth / reference, q }
}

test('catálogo expõe equal, 1 e 2 destaques (3 em 7) com posições válidas', () => {
  assert.deepEqual(defaultHighlightCount(1), 0)
  for (let count = 1; count <= 16; count += 1) {
    const catalog = getCompositions(count)
    assert.ok(catalog.some((entry) => entry.highlightCount === 0))
    if (count >= 3) {
      assert.ok(catalog.some((entry) => entry.highlightCount === 1))
      assert.ok(catalog.every((entry) => entry.highlightCount < count))
    }
    if (count >= 5) assert.ok(catalog.some((entry) => entry.highlightCount === 2), `falta 2 destaques em ${count}`)
    if (count === 3) assert.ok(!catalog.some((entry) => entry.highlightCount >= 2))
    if (count === 7) assert.ok(catalog.some((entry) => entry.highlightCount === 3))
    for (const entry of catalog) {
      if (entry.highlightCount === 0) assert.deepEqual(entry.positions, [])
      else if ([13, 10, 7].includes(count) && entry.highlightCount === (count === 13 ? 1 : count === 10 ? 2 : 3)) assert.deepEqual(entry.positions, CORNERS)
      else assert.deepEqual(entry.positions, SIDES)
    }
  }
  assert.equal(defaultHighlightCount(10), 2)
  assert.equal(defaultHighlightCount(13), 1)
  assert.equal(defaultHighlightCount(14), 2)
  assert.equal(defaultHighlightCount(4), 0)
})

test('gera composições válidas para cada quantidade, destaque, posição e formato', () => {
  for (let count = 1; count <= 16; count += 1) {
    for (const composition of getCompositions(count)) {
      for (const position of composition.positions.length > 0 ? composition.positions : [undefined]) {
        for (const aspect of ASPECTS) {
          const panelIds = ids(count)
          const resolved = resolveComposition(panelIds, {
            mode: composition.highlightCount === 0 ? 'equal' : 'highlights',
            highlighted: new Set(panelIds.slice(0, composition.highlightCount)),
            position,
            aspect,
          })
          assert.equal(resolved.highlighted.length, composition.highlightCount)
          assert.equal(validateLayout(calculateLayout(resolved.tree), new Set(panelIds)), true, `${composition.id} ${position} ${aspect}`)
        }
      }
    }
  }
})

test('reproduz as 124 referências aprovadas de vídeo 16:9', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('./fixtures/video-layout-reference.json', import.meta.url), 'utf8')) as {
    width: number
    height: number
    cases: Array<{
      key: string
      count: number
      highlightCount: number
      position: HighlightPosition | null
      variant: string
      baselineRects: Array<{ panelId: string; width: number; height: number }>
      expectedVideos: Array<{ panelId: string; width: number; height: number }>
      expectedCoverage: number
      expectedSumWidth: number
    }>
  }
  const aspect = reference.width / reference.height
  let gains = 0
  for (const entry of reference.cases) {
    const panelIds = Array.from({ length: entry.count }, (_, index) => String(index + 1))
    const resolved = resolveComposition(panelIds, {
      mode: entry.highlightCount === 0 ? 'equal' : 'highlights',
      highlighted: new Set(panelIds.slice(0, entry.highlightCount)),
      position: entry.position ?? undefined,
      aspect,
    })
    assert.equal(resolved.variant, entry.variant, entry.key)
    assert.deepEqual(resolved.highlighted, panelIds.slice(0, entry.highlightCount), entry.key)
    const result = calculateLayout(resolved.tree)
    assert.equal(validateLayout(result, new Set(panelIds)), true, entry.key)
    const actual = new Map(result.rects.map((rect) => [rect.panelId, rect]))
    let actualCoverage = 0
    let baselineWidth = 0
    for (const baseline of entry.baselineRects) {
      baselineWidth += videoSize(baseline, aspect, reference.width, reference.height).width
    }
    for (const expected of entry.expectedVideos) {
      const rect = actual.get(expected.panelId)!
      const video = videoSize(rect, aspect, reference.width, reference.height)
      assert.ok(Math.abs(video.width - expected.width) <= 0.05, `${entry.key}/${expected.panelId} width`)
      assert.ok(Math.abs(video.height - expected.height) <= 0.05, `${entry.key}/${expected.panelId} height`)
      const baseline = entry.baselineRects.find((candidate) => candidate.panelId === expected.panelId)!
      const baselineVideo = videoSize(baseline, aspect, reference.width, reference.height)
      assert.ok(video.width >= baselineVideo.width - 0.05, `${entry.key}/${expected.panelId} width shrink`)
      assert.ok(video.height >= baselineVideo.height - 0.05, `${entry.key}/${expected.panelId} height shrink`)
      actualCoverage += video.q * video.q
    }
    assert.ok(Math.abs(actualCoverage * 100 - entry.expectedCoverage) <= 0.001, `${entry.key} coverage`)
    assert.ok(Math.abs(entry.expectedSumWidth - entry.expectedVideos.reduce((sum, video) => sum + video.width, 0)) <= 0.001, `${entry.key} fixture sum`)
    if (entry.expectedSumWidth > baselineWidth + 0.001) gains += 1
  }
  assert.equal(reference.cases.length, 124)
  assert.equal(gains, 57)
  assert.equal(reference.cases.length - gains, 67)
})

test('mantém a geometria válida em combinações representativas de destaques até 16 painéis', () => {
  for (let count = 1; count <= 16; count += 1) {
    const panelIds = ids(count)
    const masks = count <= 6
      ? Array.from({ length: 2 ** count }, (_, mask) => mask)
      : [...new Set([0, 1, 2 ** count - 1, (1 << Math.min(count, 4)) - 1, 1 << Math.floor(count / 2)])]
    for (const mask of masks) {
      const highlighted = [...panelIds.filter((_, index) => (mask & (1 << index)) !== 0)]
      const resolved = resolveComposition(panelIds, { mode: mask === 0 ? 'equal' : 'highlights', highlighted: new Set(highlighted) })
      assert.equal(validateLayout(calculateLayout(resolved.tree), new Set(panelIds)), true, `layout inválido para ${count}/${mask}`)
      assert.equal(resolved.highlighted.length, Math.min(highlighted.length, getCompositions(count).at(-1)!.highlightCount))
      const rects = calculateLayout(resolved.tree).rects
      const largeAreas = rects.filter((rect) => resolved.highlighted.includes(rect.panelId)).map((rect) => rect.width * rect.height)
      const smallAreas = rects.filter((rect) => !resolved.highlighted.includes(rect.panelId)).map((rect) => rect.width * rect.height)
      if (largeAreas.length > 0 && smallAreas.length > 0) assert.ok(Math.min(...largeAreas) > Math.max(...smallAreas), `destaque não é maior em ${count}/${mask}`)
    }
  }
})

test('modo sem destaques maximiza o vídeo mesmo quando os painéis têm áreas diferentes', () => {
  for (const aspect of ASPECTS) {
    for (let count = 2; count <= 16; count += 1) {
      const resolved = resolveComposition(ids(count), { mode: 'equal', aspect })
      const rects = calculateLayout(resolved.tree).rects
      assert.equal(validateLayout({ rects, splits: calculateLayout(resolved.tree).splits }, new Set(ids(count))), true)
      const scales = rects.map((rect) => Math.min(Math.min(1, aspect / (16 / 9)) * rect.width, Math.min(1, (16 / 9) / aspect) * rect.height))
      assert.ok(Math.max(...scales) >= Math.min(...scales) - 1e-7, `vídeos inválidos para ${count} em ${aspect}`)
    }
  }
})

test('cinco telas sem destaques dão mais espaço de vídeo à linha inferior', () => {
  const panelIds = ids(5)
  const rects = calculateLayout(resolveComposition(panelIds, { mode: 'equal', aspect: 16 / 9 }).tree).rects
  const top = rects.filter((rect) => rect.y < 0.1).map((rect) => Math.min(rect.width, rect.height))
  const bottom = rects.filter((rect) => rect.y > 0.3).map((rect) => Math.min(rect.width, rect.height))
  assert.equal(top.length, 3)
  assert.equal(bottom.length, 2)
  assert.ok(Math.min(...bottom) > Math.max(...top))
})

test('otimizador é determinístico, não mistura IDs e recua para fallback em entrada inválida', () => {
  const firstIds = ['panel-42', 'preview-0', 'panel-99', 'preview-1', 'panel-100']
  const firstTree = resolveComposition(firstIds, { mode: 'equal', aspect: 16 / 9 }).tree
  const firstRects = calculateLayout(firstTree).rects
  const first = optimizeVideoLayout(firstTree, firstRects, new Set(), 16 / 9)
  const repeated = optimizeVideoLayout(firstTree, firstRects, new Set(), 16 / 9)
  assert.equal(first.status, repeated.status)
  assert.deepEqual([...first.ratios], [...repeated.ratios])
  const secondIds = firstIds.map((id) => `other-${id}`)
  const secondTree = resolveComposition(secondIds, { mode: 'equal', aspect: 16 / 9 }).tree
  const second = optimizeVideoLayout(secondTree, calculateLayout(secondTree).rects, new Set(), 16 / 9)
  assert.deepEqual([...first.ratios.values()], [...second.ratios.values()])
  assert.equal(optimizeVideoLayout(firstTree, firstRects, new Set(), Number.NaN).status, 'fallback')
})

test('automático usa os defaults por quantidade', () => {
  for (let count = 1; count <= 16; count += 1) {
    const resolved = resolveComposition(ids(count), { mode: 'auto' })
    assert.equal(resolved.highlighted.length, Math.min(defaultHighlightCount(count), count - 1 >= 0 ? defaultHighlightCount(count) : 0))
    assert.equal(validateLayout(calculateLayout(resolved.tree), new Set(ids(count))), true)
  }
  assert.deepEqual(resolveComposition(ids(10), { mode: 'auto' }).highlighted, [ids(10)[0], ids(10)[1]])
  assert.deepEqual(resolveComposition(ids(13), { mode: 'auto' }).highlighted, [ids(13)[0]])
})

test('destaque em 13 painéis ocupa um bloco 2x2 na malha 4x4 em qualquer canto', () => {
  for (const corner of CORNERS) {
    const panelIds = ids(13)
    const resolved = resolveComposition(panelIds, { mode: 'highlights', highlighted: new Set([panelIds[4]]), position: corner })
    assert.equal(resolved.position, corner)
    const result = calculateLayout(resolved.tree)
    assert.equal(validateLayout(result, new Set(panelIds)), true)
    const hero = result.rects.find((rect) => rect.panelId === panelIds[4])!
    const others = result.rects.filter((rect) => rect.panelId !== panelIds[4])
    assert.ok(Math.abs(hero.width - 0.5) < 1e-8 && Math.abs(hero.height - 0.5) < 1e-8, `${corner}: ${JSON.stringify(hero)}`)
    assert.equal(others.length, 12)
    for (const rect of others) assert.ok(Math.abs(rect.width * rect.height - 1 / 16) < 1e-8)
    const [col, row] = corner === 'top-left' ? [0, 0] : corner === 'top-right' ? [1, 0] : corner === 'bottom-left' ? [0, 1] : [1, 1]
    assert.ok(Math.abs(hero.x - col * 0.5) < 1e-8 && Math.abs(hero.y - row * 0.5) < 1e-8)
  }
})

test('qualquer painel pode ser o destaque com área visivelmente maior', () => {
  const panelIds = ids(13)
  for (const highlighted of panelIds) {
    const resolved = resolveComposition(panelIds, { mode: 'highlights', highlighted: new Set([highlighted]) })
    const rects = calculateLayout(resolved.tree).rects
    const hero = rects.find((rect) => rect.panelId === highlighted)!
    const others = rects.filter((rect) => rect.panelId !== highlighted)
    assert.ok(hero.width * hero.height > Math.max(...others.map((rect) => rect.width * rect.height)) * 3)
  }
})

test('dois destaques mantêm áreas equivalentes entre grandes e entre pequenos', () => {
  const panelIds = ids(14)
  const highlighted = [panelIds[2], panelIds[7]]
  for (const corner of CORNERS) {
    const resolved = resolveComposition(panelIds, { mode: 'highlights', highlighted: new Set(highlighted), position: corner })
    const rects = calculateLayout(resolved.tree).rects
    const large = rects.filter((rect) => highlighted.includes(rect.panelId)).map((rect) => rect.width * rect.height)
    const small = rects.filter((rect) => !highlighted.includes(rect.panelId)).map((rect) => rect.width * rect.height)
    assert.ok(Math.max(...large) / Math.min(...large) < 1.001)
    assert.ok(Math.max(...small) / Math.min(...small) < 1.001)
    assert.ok(Math.min(...large) > Math.max(...small) * 3)
  }
})

test('histerese mantém a variante anterior a menos que a melhoria supere 12%', () => {
  const panelIds = ids(9)
  const first = resolveComposition(panelIds, { mode: 'equal', aspect: 16 / 9 })
  const stable = resolveComposition(panelIds, { mode: 'equal', aspect: first.variant === '' ? 16 / 9 : 16 / 9, previousVariant: first.variant })
  assert.equal(stable.variant, first.variant)
  const shifted = resolveComposition(panelIds, { mode: 'equal', aspect: 1.05, previousVariant: first.variant })
  const forced = resolveComposition(panelIds, { mode: 'equal', aspect: 1.05 })
  assert.ok(forced.variant !== first.variant || shifted.variant === first.variant)
})

test('redimensiona uma divisão sem sair dos limites e preserva a geometria', () => {
  const panelIds = ids(4)
  const tree = resolveComposition(panelIds, { mode: 'equal' }).tree
  const splitId = calculateLayout(tree).splits[0].id
  const resized = updateSplitRatio(tree, splitId, 0.8)
  const resizedResult = calculateLayout(resized)
  assert.equal(validateLayout(resizedResult, new Set(panelIds)), true)
  assert.equal(rectFor(resized, panelIds[0]).height, 0.8)
})

test('buildLayoutTree mantém compatibilidade: sem conjunto é automático, vazio é igual', () => {
  const panelIds = ids(13)
  assert.equal(resolveComposition(panelIds, { mode: 'auto' }).highlighted.length, 1)
  assert.equal(collectPanelIds(buildLayoutTree(panelIds)).length, 13)
  const equal = buildLayoutTree(panelIds, new Set())
  const equalRects = calculateLayout(equal).rects
  const equalScales = equalRects.map((rect) => Math.min(rect.width, rect.height))
  assert.ok(Math.max(...equalScales) / Math.min(...equalScales) < 1.001)
  const highlighted = buildLayoutTree(panelIds, new Set([panelIds[2]]))
  const hero = rectFor(highlighted, panelIds[2])
  assert.ok(hero.width * hero.height > 3 / 13)
})
