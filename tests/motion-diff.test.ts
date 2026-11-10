import test from 'node:test'
import assert from 'node:assert/strict'
import { diffRender, type RenderSnapshot } from '../src/motion-diff.ts'

const half = (x: number) => ({ x, y: 0, width: 0.5, height: 1 })
const full = { x: 0, y: 0, width: 1, height: 1 }

function snapshot(partial: Partial<RenderSnapshot>): RenderSnapshot {
  return { count: Object.keys(partial.rects ?? {}).length, rects: {}, urls: {}, highlighted: [], ...partial }
}

test('sem render anterior não anima nada', () => {
  const next = snapshot({ rects: { a: full }, urls: { a: '' } })
  assert.deepEqual(diffRender(null, next), {
    entered: [], removed: [], movedEmpty: [], movedLoaded: [], highlightAdded: [], countDelta: 0,
  })
})

test('render idêntico não gera movimento', () => {
  const state = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: 'https://x.test', b: '' }, highlighted: ['a'] })
  const diff = diffRender(state, structuredClone(state))
  assert.deepEqual([diff.entered, diff.removed, diff.movedEmpty, diff.movedLoaded, diff.highlightAdded, diff.countDelta], [[], [], [], [], [], 0])
})

test('adicionar tela: a nova entra e a vazia existente se move', () => {
  const previous = snapshot({ rects: { a: full }, urls: { a: '' } })
  const next = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: '', b: '' } })
  const diff = diffRender(previous, next)
  assert.deepEqual(diff.entered, ['b'])
  assert.deepEqual(diff.movedEmpty, ['a'])
  assert.deepEqual(diff.movedLoaded, [])
  assert.equal(diff.countDelta, 1)
})

test('painel com vídeo que muda de lugar nunca vai para movedEmpty', () => {
  const previous = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: 'https://x.test', b: '' } })
  const next = snapshot({ rects: { a: half(0.5), b: half(0) }, urls: { a: 'https://x.test', b: '' } })
  const diff = diffRender(previous, next)
  assert.deepEqual(diff.movedLoaded, ['a'])
  assert.deepEqual(diff.movedEmpty, ['b'])
})

test('remover: só painéis vazios viram fantasma e a contagem cai', () => {
  const previous = snapshot({ rects: { a: half(0), b: half(0.5), c: full }, urls: { a: '', b: 'https://x.test', c: '' }, count: 3 })
  const next = snapshot({ rects: { a: full }, urls: { a: '' }, count: 1 })
  const diff = diffRender(previous, next)
  assert.deepEqual(diff.removed, ['c'])
  assert.equal(diff.countDelta, -2)
})

test('tela nova já carregada (desfazer) não recebe animação de entrada', () => {
  const previous = snapshot({ rects: { a: full }, urls: { a: '' } })
  const next = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: '', b: 'https://x.test' } })
  assert.deepEqual(diffRender(previous, next).entered, [])
})

test('destaque novo é detectado, destaque mantido não', () => {
  const previous = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: '', b: '' }, highlighted: ['a'] })
  const next = snapshot({ rects: { a: half(0), b: half(0.5) }, urls: { a: '', b: '' }, highlighted: ['a', 'b'] })
  assert.deepEqual(diffRender(previous, next).highlightAdded, ['b'])
})
