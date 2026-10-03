import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateLayout,
  getCompositions,
  resolveComposition,
  validateLayout,
  type HighlightPosition,
} from '../src/layout.ts'
import {
  buildOrganizerChoices,
  organizerDraftKey,
  organizerDraftValid,
  sameOrganizerRects,
  type OrganizerDraft,
} from '../src/organizer.ts'

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `panel-${index + 1}`)
}

test('organizer cobre todas as 124 combinações do catálogo', () => {
  const aspects = [16 / 9, 9 / 16, 21 / 9]
  let combinations = 0

  for (let count = 1; count <= 16; count++) {
    const order = ids(count)

    for (const composition of getCompositions(count)) {
      const positions = composition.positions.length > 0 ? composition.positions : [undefined]
      combinations += positions.length
      const selections = [
        order.slice(0, composition.highlightCount),
        [...order].reverse().slice(0, composition.highlightCount),
      ]

      for (const selectedIds of selections) {
        for (const aspect of aspects) {
          for (const position of positions) {
            const draft: OrganizerDraft = {
              count: composition.highlightCount,
              ids: selectedIds,
              position,
              previousVariant: undefined,
            }

            assert.equal(organizerDraftValid(order, draft), true)
            const choices = buildOrganizerChoices(order, draft, aspect)
            const selected = choices.find((choice) => choice.positions.includes(position ?? 'none'))
            assert.ok(selected)
            assert.equal(validateLayout({ rects: selected.rects, splits: [] }, new Set(order)), true)

            const expected = resolveComposition(order, {
              mode: draft.count === 0 ? 'equal' : 'highlights',
              highlighted: new Set(selectedIds),
              position,
              aspect,
            })

            assert.equal(sameOrganizerRects(selected.rects, calculateLayout(expected.tree).rects), true)
            assert.deepEqual([...selected.result.highlighted].sort(), [...selectedIds].sort())
            assert.equal(sameOrganizerRects(selected.rects, calculateLayout(selected.result.tree).rects), true)

            for (let first = 0; first < choices.length; first++) {
              for (let second = first + 1; second < choices.length; second++) {
                assert.equal(sameOrganizerRects(choices[first].rects, choices[second].rects), false)
              }
            }
          }
        }
      }
    }
  }

  assert.equal(combinations, 124)
})

test('organizer agrupa os pares equivalentes de 10 telas', () => {
  const order = ids(10)
  const choices = buildOrganizerChoices(order, {
    count: 2,
    ids: ['panel-1', 'panel-10'],
    position: 'top-left',
    previousVariant: undefined,
  }, 16 / 9)

  assert.equal(choices.length, 2)
  assert.deepEqual(new Set(choices.flatMap((choice) => choice.positions)), new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']))
  assert.equal(choices.filter((choice) => choice.label === 'Principais em cima').length, 1)
  assert.equal(choices.filter((choice) => choice.label === 'Principais embaixo').length, 1)
  assert.deepEqual(choices.find((choice) => choice.label === 'Principais em cima')?.positions, ['top-left', 'top-right'])
  assert.deepEqual(choices.find((choice) => choice.label === 'Principais embaixo')?.positions, ['bottom-left', 'bottom-right'])
})

test('organizer descreve os quatro arranjos em L', () => {
  const order = ids(7)
  const choices = buildOrganizerChoices(order, {
    count: 3,
    ids: ['panel-1', 'panel-4', 'panel-7'],
    position: 'top-left',
    previousVariant: undefined,
  }, 16 / 9)

  assert.equal(choices.length, 4)
  assert.deepEqual(new Set(choices.flatMap((choice) => choice.positions)), new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']))
  assert.equal(choices.every((choice) => choice.label.startsWith('Telas menores no canto ')), true)
})

test('organizer preserva os quatro cantos em 13 telas', () => {
  const order = ids(13)
  const choices = buildOrganizerChoices(order, {
    count: 1,
    ids: ['panel-13'],
    position: 'bottom-right',
    previousVariant: undefined,
  }, 16 / 9)

  assert.equal(choices.length, 4)
  assert.deepEqual(new Set(choices.flatMap((choice) => choice.positions)), new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']))
  assert.equal(choices.every((choice) => choice.result.highlighted.includes('panel-13')), true)
})

test('organizer rejeita seleções inválidas', () => {
  const order = ids(5)
  const draft: OrganizerDraft = {
    count: 2,
    ids: ['panel-1', 'panel-5'],
    position: 'left',
    previousVariant: undefined,
  }

  assert.equal(organizerDraftValid(order, { ...draft, count: 3 }), false)
  assert.equal(organizerDraftValid(order, { ...draft, ids: ['panel-1'] }), false)
  assert.equal(organizerDraftValid(order, { ...draft, ids: ['panel-1', 'panel-1'] }), false)
  assert.equal(organizerDraftValid(order, { ...draft, ids: ['panel-1', 'panel-99'] }), false)
  assert.equal(organizerDraftValid(order, { ...draft, position: 'top-left' as HighlightPosition }), false)
})

test('organizer não altera seus argumentos', () => {
  const order = ids(7)
  const draft: OrganizerDraft = {
    count: 3,
    ids: ['panel-1', 'panel-4', 'panel-7'],
    position: 'top-left',
    previousVariant: '7-3:top-left:quadrants',
  }
  const beforeOrder = JSON.stringify(order)
  const beforeDraft = JSON.stringify(draft)

  buildOrganizerChoices(order, draft, 16 / 9)

  assert.equal(JSON.stringify(order), beforeOrder)
  assert.equal(JSON.stringify(draft), beforeDraft)
})

test('organizer reconhece posições equivalentes no rascunho', () => {
  const topLeft: OrganizerDraft = { count: 2, ids: ['panel-1', 'panel-2'], position: 'top-left', previousVariant: undefined }
  const topRight: OrganizerDraft = { ...topLeft, position: 'top-right' }
  const bottomLeft: OrganizerDraft = { ...topLeft, position: 'bottom-left' }
  const bottomRight: OrganizerDraft = { ...topLeft, position: 'bottom-right' }

  assert.equal(organizerDraftKey(topLeft, 10), organizerDraftKey(topRight, 10))
  assert.equal(organizerDraftKey(bottomLeft, 10), organizerDraftKey(bottomRight, 10))
  assert.notEqual(organizerDraftKey(topLeft, 10), organizerDraftKey(bottomLeft, 10))
})

test('organizer não reúne jogos em posições diferentes', () => {
  const first = [
    { panelId: 'panel-1', x: 0, y: 0, width: 0.5, height: 1 },
    { panelId: 'panel-2', x: 0.5, y: 0, width: 0.5, height: 1 },
  ]
  const second = [
    { panelId: 'panel-1', x: 0.5, y: 0, width: 0.5, height: 1 },
    { panelId: 'panel-2', x: 0, y: 0, width: 0.5, height: 1 },
  ]

  assert.equal(sameOrganizerRects(first, second), false)
})
