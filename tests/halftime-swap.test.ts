import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIRST_HALF_CUTOFF_SEC,
  canComeIn,
  isBreakPeriod,
  planHalftimeSwaps,
  rankCandidates,
  type SwapPanelInfo,
  type SwapPlanInput,
} from '../src/halftime-swap.ts'

function info(id: string, overrides: Partial<SwapPanelInfo> = {}): SwapPanelInfo {
  return { id, period: 'first', elapsed: 20 * 60, score: { home: 0, away: 0 }, mainTeam: false, alertsOff: false, ...overrides }
}

function plan(overrides: Partial<SwapPlanInput> & Pick<SwapPlanInput, 'panels'>) {
  const order = overrides.order ?? overrides.panels.map((panel) => panel.id)
  return planHalftimeSwaps({ swaps: [], userHighlighted: ['a'], highlighted: ['a'], skipped: new Set(), ...overrides, order })
}

test('intervalos entre tempos contam; pênaltis e jogo sem relógio não', () => {
  assert.equal(isBreakPeriod('half-time'), true)
  assert.equal(isBreakPeriod('extra-break'), true)
  assert.equal(isBreakPeriod('extra-half-time'), true)
  assert.equal(isBreakPeriod('penalties'), false)
  assert.equal(isBreakPeriod('second'), false)
  assert.equal(isBreakPeriod(null), false)
})

test('só entra jogo rolando, com alertas ligados e longe do fim do 1º tempo', () => {
  assert.equal(canComeIn(info('x')), true)
  assert.equal(canComeIn(info('x', { period: 'second', elapsed: 88 * 60 })), true)
  assert.equal(canComeIn(info('x', { period: 'extra-first', elapsed: 95 * 60 })), true)
  assert.equal(canComeIn(info('x', { elapsed: FIRST_HALF_CUTOFF_SEC })), false)
  assert.equal(canComeIn(info('x', { elapsed: FIRST_HALF_CUTOFF_SEC - 1 })), true)
  assert.equal(canComeIn(info('x', { period: 'half-time' })), false)
  assert.equal(canComeIn(info('x', { period: 'penalties' })), false)
  assert.equal(canComeIn(info('x', { period: null })), false)
  assert.equal(canComeIn(info('x', { alertsOff: true })), false)
})

test('ordem: time principal, reta final apertada, placar apertado, tempo de jogo, grade', () => {
  const late = info('late', { period: 'second', elapsed: 78 * 60, score: { home: 1, away: 1 } })
  const early = info('early', { elapsed: 20 * 60, score: { home: 0, away: 0 } })
  const rout = info('rout', { period: 'second', elapsed: 80 * 60, score: { home: 3, away: 0 } })
  assert.deepEqual(rankCandidates([rout, early, late], ['rout', 'early', 'late']), ['late', 'early', 'rout'])
  const main = info('main', { period: 'first', elapsed: 10 * 60, score: { home: 4, away: 0 }, mainTeam: true })
  assert.deepEqual(rankCandidates([rout, early, late, main], []), ['main', 'late', 'early', 'rout'])
})

test('sem placar conta como não apertado; empate total segue a ordem da grade', () => {
  const noScore = info('noScore', { score: null, elapsed: 30 * 60 })
  const tight = info('tight', { score: { home: 1, away: 0 }, elapsed: 10 * 60 })
  assert.deepEqual(rankCandidates([noScore, tight], []), ['tight', 'noScore'])
  assert.deepEqual(rankCandidates([info('b'), info('a')], ['a', 'b']), ['a', 'b'])
})

test('prorrogação é reta final mesmo com placar aberto', () => {
  const extra = info('extra', { period: 'extra-first', elapsed: 95 * 60, score: { home: 2, away: 0 } })
  const second = info('second', { period: 'second', elapsed: 60 * 60, score: { home: 0, away: 0 } })
  assert.deepEqual(rankCandidates([second, extra], []), ['extra', 'second'])
})

test('destaque do usuário no intervalo troca com o melhor jogo fora do destaque', () => {
  const result = plan({
    panels: [info('a', { period: 'half-time' }), info('b'), info('c', { period: 'second', elapsed: 75 * 60, score: { home: 1, away: 0 } })],
  })
  assert.deepEqual(result, { restore: [], start: [{ out: 'a', in: 'c' }] })
})

test('sem candidato, nada troca', () => {
  const result = plan({ panels: [info('a', { period: 'half-time' }), info('b', { period: 'half-time' }), info('c', { period: null })] })
  assert.deepEqual(result, { restore: [], start: [] })
})

test('destaque pulado, fora do destaque do usuário ou rolando não troca', () => {
  const panels = [info('a', { period: 'half-time' }), info('b')]
  assert.deepEqual(plan({ panels, skipped: new Set(['a']) }).start, [])
  // A goal highlight (not the user's) in a break stays: it ends on its own.
  assert.deepEqual(plan({ panels, userHighlighted: [], highlighted: ['a'] }).start, [])
  assert.deepEqual(plan({ panels: [info('a'), info('b')] }).start, [])
})

test('candidato já em destaque (gol ou companheiro) não entra', () => {
  const result = plan({
    panels: [info('a', { period: 'half-time' }), info('b', { mainTeam: true }), info('c')],
    highlighted: ['b', 'a'],
  })
  assert.deepEqual(result.start, [{ out: 'a', in: 'c' }])
})

test('dois destaques no intervalo pegam os dois melhores, na ordem da grade', () => {
  const result = plan({
    panels: [info('a', { period: 'half-time' }), info('b', { period: 'half-time' }), info('c'), info('d', { mainTeam: true })],
    userHighlighted: ['b', 'a'],
    highlighted: ['b', 'a'],
  })
  assert.deepEqual(result.start, [{ out: 'a', in: 'd' }, { out: 'b', in: 'c' }])
})

test('troca volta quando o jogo original sai do intervalo ou perde o relógio', () => {
  const swaps = [{ out: 'a', in: 'c' }]
  const back = plan({ swaps, userHighlighted: ['c'], highlighted: ['c'], panels: [info('a', { period: 'second', elapsed: 45 * 60 }), info('c')] })
  assert.deepEqual(back, { restore: swaps, start: [] })
  const lost = plan({ swaps, userHighlighted: ['c'], highlighted: ['c'], panels: [info('a', { period: null }), info('c')] })
  assert.deepEqual(lost.restore, swaps)
  const closed = plan({ swaps, userHighlighted: ['c'], highlighted: ['c'], panels: [info('c')] })
  assert.deepEqual(closed.restore, swaps)
})

test('troca continua enquanto o original está no intervalo e o substituto rolando', () => {
  const swaps = [{ out: 'a', in: 'c' }]
  const result = plan({ swaps, userHighlighted: ['c'], highlighted: ['c'], panels: [info('a', { period: 'half-time' }), info('b'), info('c')] })
  assert.deepEqual(result, { restore: [], start: [] })
})

test('substituto que entra em intervalo dá lugar ao próximo candidato', () => {
  const swaps = [{ out: 'a', in: 'c' }]
  const result = plan({
    swaps,
    userHighlighted: ['c'],
    highlighted: ['c'],
    panels: [info('a', { period: 'half-time' }), info('b'), info('c', { period: 'half-time' })],
  })
  assert.deepEqual(result, { restore: swaps, start: [{ out: 'a', in: 'b' }] })
})

test('substituto em intervalo sem outro candidato: o original volta ao destaque', () => {
  const swaps = [{ out: 'a', in: 'c' }]
  const result = plan({ swaps, userHighlighted: ['c'], highlighted: ['c'], panels: [info('a', { period: 'half-time' }), info('c', { period: 'half-time' })] })
  assert.deepEqual(result, { restore: swaps, start: [] })
})
