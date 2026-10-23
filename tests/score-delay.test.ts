import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createScoreTimeline,
  nextScoreChangeAt,
  pushScore,
  visibleScore,
} from '../src/score-delay.ts'

test('primeiro placar aparece imediatamente mesmo com atraso configurado', () => {
  const timeline = createScoreTimeline()
  assert.equal(pushScore(timeline, 1_000, { home: 1, away: 0 }), true)
  assert.deepEqual(visibleScore(timeline, 1_000, 30_000), { home: 1, away: 0 })
})

test('placar repetido é ignorado e pushScore retorna false', () => {
  const timeline = createScoreTimeline()
  pushScore(timeline, 0, { home: 1, away: 0 })
  assert.equal(pushScore(timeline, 5_000, { home: 1, away: 0 }), false)
  assert.equal(timeline.entries.length, 1)
})

test('novo placar fica oculto até o atraso passar e depois aparece', () => {
  const timeline = createScoreTimeline()
  pushScore(timeline, 0, { home: 1, away: 0 })
  assert.equal(pushScore(timeline, 10_000, { home: 2, away: 0 }), true)

  // Enquanto o atraso não passa, o placar anterior continua visível
  assert.deepEqual(visibleScore(timeline, 10_000, 30_000), { home: 1, away: 0 })
  assert.deepEqual(visibleScore(timeline, 39_999, 30_000), { home: 1, away: 0 })
  // Exatamente em at + delay, o novo placar aparece
  assert.deepEqual(visibleScore(timeline, 40_000, 30_000), { home: 2, away: 0 })
})

test('com atraso zero o novo placar aparece no mesmo instante', () => {
  const timeline = createScoreTimeline()
  pushScore(timeline, 0, { home: 0, away: 0 })
  pushScore(timeline, 2_000, { home: 0, away: 1 })
  assert.deepEqual(visibleScore(timeline, 2_000, 0), { home: 0, away: 1 })
})

test('nextScoreChangeAt informa o horário pendente e depois retorna null', () => {
  const timeline = createScoreTimeline()
  pushScore(timeline, 0, { home: 1, away: 0 })
  pushScore(timeline, 10_000, { home: 2, away: 0 })

  assert.equal(nextScoreChangeAt(timeline, 10_000, 30_000), 40_000)
  assert.equal(nextScoreChangeAt(timeline, 39_000, 30_000), 40_000)
  assert.equal(nextScoreChangeAt(timeline, 40_000, 30_000), null)
})

test('nextScoreChangeAt retorna null quando não há placar pendente', () => {
  const timeline = createScoreTimeline()
  assert.equal(nextScoreChangeAt(timeline, 0, 30_000), null)
  pushScore(timeline, 0, { home: 1, away: 0 })
  assert.equal(nextScoreChangeAt(timeline, 0, 30_000), null)
})

test('alterar o atraso na leitura muda o que está visível', () => {
  const timeline = createScoreTimeline()
  pushScore(timeline, 0, { home: 1, away: 0 })
  pushScore(timeline, 10_000, { home: 2, away: 0 })

  // Com 30 s de atraso, em 40 s o 2-0 já aparece
  assert.deepEqual(visibleScore(timeline, 40_000, 30_000), { home: 2, away: 0 })
  // Com 60 s de atraso, o mesmo instante volta a mostrar o 1-0
  assert.deepEqual(visibleScore(timeline, 40_000, 60_000), { home: 1, away: 0 })
  assert.equal(nextScoreChangeAt(timeline, 40_000, 60_000), 70_000)
})

test('a linha do tempo guarda no máximo 8 entradas', () => {
  const timeline = createScoreTimeline()
  for (let goals = 0; goals < 12; goals += 1) {
    pushScore(timeline, goals * 1_000, { home: goals, away: 0 })
  }
  assert.equal(timeline.entries.length, 8)
  // As entradas mais antigas são descartadas; a mais recente continua visível
  assert.deepEqual(visibleScore(timeline, 100_000, 0), { home: 11, away: 0 })
  assert.deepEqual(visibleScore(timeline, 100_000, 60_000), { home: 11, away: 0 })
})
