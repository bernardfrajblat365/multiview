import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateLayout,
  getCompositions,
  resolveComposition,
  validateLayout,
  type HighlightPosition,
  type LayoutMode,
  type LayoutNode,
  type PanelId,
} from '../src/layout.ts'
import {
  SPOTLIGHT_MIN_PANELS,
  SPOTLIGHT_MS,
  deriveHighlights,
  expire,
  formatSpotlightCountdown,
  registerAlert,
  removePanelEntry,
  type SpotlightBaseline,
  type SpotlightCurrent,
  type SpotlightState,
} from '../src/goal-spotlight.ts'

function ids(count: number): PanelId[] {
  return Array.from({ length: count }, (_, index) => `panel-${index + 1}`)
}

function capacityFor(count: number) {
  return getCompositions(count).at(-1)!.highlightCount
}

function leafTree(panelIds: PanelId[]): LayoutNode {
  return { kind: 'leaf', panelId: panelIds[0]! }
}

function currentFor(
  panelIds: PanelId[],
  highlighted: PanelId[] = [],
  mode: LayoutMode = highlighted.length > 0 ? 'highlights' : 'equal',
): SpotlightCurrent {
  return {
    highlighted,
    mode,
    position: highlighted.length > 0 ? 'left' : undefined,
    variant: highlighted.length > 0 ? `${panelIds.length}-1:left:3` : `${panelIds.length}-0:rows-2`,
    order: [...panelIds],
    tree: leafTree(panelIds),
    aspect: 16 / 9,
    panelCount: panelIds.length,
  }
}

function baselineFrom(current: SpotlightCurrent): SpotlightBaseline {
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

test('equal grids 6/8/16: one goal promotes one panel; two promote two; third replaces oldest', () => {
  for (const count of [6, 8, 16]) {
    const panelIds = ids(count)
    const capacity = capacityFor(count)
    assert.ok(capacity >= 2, `capacity for ${count}`)
    const current = currentFor(panelIds)
    const t0 = 1_000_000

    const first = registerAlert(null, {
      panelId: panelIds[0]!,
      kind: 'goal',
      now: t0,
      current,
      capacity,
    })
    assert.ok(first)
    assert.deepEqual(deriveHighlights(first.baseline, first.entries, capacity), [panelIds[0]])

    const second = registerAlert(first, {
      panelId: panelIds[1]!,
      kind: 'penalty',
      now: t0 + 1000,
      current,
      capacity,
    })
    assert.ok(second)
    assert.deepEqual(deriveHighlights(second.baseline, second.entries, capacity), [panelIds[1], panelIds[0]])

    const third = registerAlert(second, {
      panelId: panelIds[2]!,
      kind: 'red',
      now: t0 + 2000,
      current,
      capacity,
    })
    assert.ok(third)
    assert.deepEqual(deriveHighlights(third.baseline, third.entries, capacity), [panelIds[2], panelIds[1]])
  }
})

test('highlighted baselines 5/11 (1) and 10/18 (2): goal replaces a user principal; restore keeps originals', () => {
  const cases: { count: number; principals: number }[] = [
    { count: 5, principals: 1 },
    { count: 11, principals: 1 },
    { count: 10, principals: 2 },
    { count: 18, principals: 2 },
  ]

  for (const { count, principals } of cases) {
    const panelIds = ids(count)
    const capacity = capacityFor(count)
    const userHighlighted = panelIds.slice(0, principals)
    const scorer = panelIds[principals]!
    const current = currentFor(panelIds, userHighlighted)
    const t0 = 2_000_000

    const next = registerAlert(null, {
      panelId: scorer,
      kind: 'goal',
      now: t0,
      current,
      capacity,
    })
    assert.ok(next, `register for ${count}`)
    assert.deepEqual(next.baseline.highlighted, userHighlighted)

    const derived = deriveHighlights(next.baseline, next.entries, capacity)
    assert.equal(derived.length, principals)
    assert.ok(derived.includes(scorer))
    if (principals === 1) {
      assert.deepEqual(derived, [scorer])
    } else {
      assert.deepEqual(derived, [userHighlighted[0], scorer])
    }

    const after = expire(next, t0 + SPOTLIGHT_MS + 1)
    assert.equal(after.restored, true)
    assert.equal(after.state, null)
    assert.deepEqual(next.baseline.highlighted, userHighlighted)
  }
})

test('fewer than SPOTLIGHT_MIN_PANELS does nothing', () => {
  for (const count of [1, 2, 3, 4]) {
    const panelIds = ids(count)
    const capacity = capacityFor(count)
    const current = currentFor(panelIds)
    const result = registerAlert(null, {
      panelId: panelIds[0]!,
      kind: 'goal',
      now: 0,
      current,
      capacity,
    })
    assert.equal(result, null, `count ${count}`)
  }
  assert.equal(SPOTLIGHT_MIN_PANELS, 5)
})

test('var without entry is ignored; var with entry renews until', () => {
  const panelIds = ids(6)
  const capacity = capacityFor(6)
  const current = currentFor(panelIds)
  const t0 = 3_000_000

  assert.equal(
    registerAlert(null, { panelId: panelIds[0]!, kind: 'var', now: t0, current, capacity }),
    null,
  )

  const withGoal = registerAlert(null, {
    panelId: panelIds[0]!,
    kind: 'goal',
    now: t0,
    current,
    capacity,
  })
  assert.ok(withGoal)
  assert.equal(withGoal.entries[0]!.until, t0 + SPOTLIGHT_MS)

  const renewed = registerAlert(withGoal, {
    panelId: panelIds[0]!,
    kind: 'var',
    now: t0 + 10_000,
    current,
    capacity,
  })
  assert.ok(renewed)
  assert.equal(renewed.entries[0]!.until, t0 + 10_000 + SPOTLIGHT_MS)
  assert.equal(renewed.entries[0]!.startedAt, t0)
})

test('alert on a user principal does nothing', () => {
  const panelIds = ids(8)
  const capacity = capacityFor(8)
  const current = currentFor(panelIds, [panelIds[0]!])
  const result = registerAlert(null, {
    panelId: panelIds[0]!,
    kind: 'goal',
    now: 0,
    current,
    capacity,
  })
  assert.equal(result, null)
})

test('partial expiry recalculates; last expiry signals restore', () => {
  const panelIds = ids(8)
  const capacity = capacityFor(8)
  const current = currentFor(panelIds)
  const t0 = 4_000_000

  let state = registerAlert(null, {
    panelId: panelIds[0]!,
    kind: 'goal',
    now: t0,
    current,
    capacity,
  })
  assert.ok(state)
  state = registerAlert(state, {
    panelId: panelIds[1]!,
    kind: 'goal',
    now: t0 + 5_000,
    current,
    capacity,
  })
  assert.ok(state)

  const partial = expire(state, t0 + SPOTLIGHT_MS + 1)
  assert.equal(partial.changed, true)
  assert.equal(partial.restored, false)
  assert.ok(partial.state)
  assert.deepEqual(
    deriveHighlights(partial.state.baseline, partial.state.entries, capacity),
    [panelIds[1]],
  )

  const last = expire(partial.state, t0 + 5_000 + SPOTLIGHT_MS + 1)
  assert.equal(last.restored, true)
  assert.equal(last.state, null)
})

test('removePanelEntry restores when last entry is removed', () => {
  const panelIds = ids(6)
  const capacity = capacityFor(6)
  const current = currentFor(panelIds)
  const state = registerAlert(null, {
    panelId: panelIds[2]!,
    kind: 'goal',
    now: 0,
    current,
    capacity,
  })
  assert.ok(state)
  const gone = removePanelEntry(state, panelIds[2]!)
  assert.equal(gone.restored, true)
  assert.equal(gone.state, null)
})

test('renewing an existing entry bumps startedAt so it becomes newest', () => {
  const panelIds = ids(8)
  const capacity = capacityFor(8)
  const current = currentFor(panelIds)
  const t0 = 5_000_000
  let state = registerAlert(null, {
    panelId: panelIds[0]!,
    kind: 'goal',
    now: t0,
    current,
    capacity,
  })!
  state = registerAlert(state, {
    panelId: panelIds[1]!,
    kind: 'goal',
    now: t0 + 1_000,
    current,
    capacity,
  })!
  assert.deepEqual(deriveHighlights(state.baseline, state.entries, capacity), [panelIds[1], panelIds[0]])

  state = registerAlert(state, {
    panelId: panelIds[0]!,
    kind: 'goal',
    now: t0 + 2_000,
    current,
    capacity,
  })!
  assert.deepEqual(deriveHighlights(state.baseline, state.entries, capacity), [panelIds[0], panelIds[1]])
})

test('formatSpotlightCountdown formats mm:ss', () => {
  assert.equal(formatSpotlightCountdown(60_000), '1:00')
  assert.equal(formatSpotlightCountdown(45_100), '0:46')
  assert.equal(formatSpotlightCountdown(0), '0:00')
  assert.equal(formatSpotlightCountdown(-100), '0:00')
})

test('deriveHighlights + resolveComposition validates for every count 5–18', () => {
  for (let count = 5; count <= 18; count += 1) {
    const panelIds = ids(count)
    const capacity = capacityFor(count)
    assert.ok(capacity >= 1, `capacity ${count}`)

    const equalCurrent = currentFor(panelIds)
    const equalState: SpotlightState = {
      baseline: baselineFrom(equalCurrent),
      entries: [{ panelId: panelIds[count - 1]!, startedAt: 1, until: 1 + SPOTLIGHT_MS }],
    }
    const equalHighlights = deriveHighlights(equalState.baseline, equalState.entries, capacity)
    assert.ok(equalHighlights.includes(panelIds[count - 1]!))
    const equalResolved = resolveComposition(panelIds, {
      mode: 'highlights',
      highlighted: new Set(equalHighlights),
      aspect: 16 / 9,
    })
    assert.ok(
      validateLayout(calculateLayout(equalResolved.tree), new Set(panelIds)),
      `equal baseline layout invalid for ${count}`,
    )
    assert.ok(equalResolved.highlighted.includes(panelIds[count - 1]!))

    const principalCount = Math.min(capacity, capacity >= 2 && [10, 14, 18].includes(count) ? 2 : 1)
    const userHighlighted = panelIds.slice(0, principalCount)
    const scorer = panelIds[principalCount]!
    const highlightedCurrent = currentFor(panelIds, userHighlighted)
    const highlightedState: SpotlightState = {
      baseline: baselineFrom(highlightedCurrent),
      entries: [{ panelId: scorer, startedAt: 1, until: 1 + SPOTLIGHT_MS }],
    }
    const derived = deriveHighlights(highlightedState.baseline, highlightedState.entries, capacity)
    assert.equal(derived.length, principalCount)
    assert.ok(derived.includes(scorer))
    const position: HighlightPosition | undefined = highlightedCurrent.position
    const resolved = resolveComposition(panelIds, {
      mode: 'highlights',
      highlighted: new Set(derived),
      position,
      aspect: 16 / 9,
    })
    assert.ok(
      validateLayout(calculateLayout(resolved.tree), new Set(panelIds)),
      `highlighted baseline layout invalid for ${count}`,
    )
    assert.ok(resolved.highlighted.includes(scorer))
  }
})
