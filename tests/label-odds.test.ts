import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOddsTimeline,
  labelOddsText,
  loadLabelOddsSetting,
  nextOddsChangeAt,
  oddsSpoken,
  orientOdds,
  pushOdds,
  saveLabelOddsSetting,
  visibleOdds,
} from '../src/label-odds.ts'
import type { Moneyline } from '../src/match-info.ts'

const A: Moneyline = { home: { rate: 3.76, trend: 'up' }, draw: { rate: 1.73, trend: 'down' }, away: { rate: 4.77, trend: null } }
const B: Moneyline = { home: { rate: 1.5, trend: 'down' }, draw: { rate: 4.2, trend: 'up' }, away: { rate: 7, trend: 'up' } }

test('a primeira leitura aparece na hora; as seguintes esperam o atraso do placar', () => {
  const timeline = createOddsTimeline()
  assert.equal(pushOdds(timeline, 1000, A), true)
  assert.deepEqual(visibleOdds(timeline, 1000, 30_000), A)
  assert.equal(pushOdds(timeline, 5000, B), true)
  assert.deepEqual(visibleOdds(timeline, 20_000, 30_000), A)
  assert.equal(nextOddsChangeAt(timeline, 20_000, 30_000), 35_000)
  assert.deepEqual(visibleOdds(timeline, 35_000, 30_000), B)
  assert.equal(nextOddsChangeAt(timeline, 35_000, 30_000), null)
  // Sem atraso, a nova já vale.
  assert.deepEqual(visibleOdds(timeline, 5000, 0), B)
})

test('leitura repetida não entra; odds que somem (null) também esperam o atraso', () => {
  const timeline = createOddsTimeline()
  assert.equal(pushOdds(timeline, 0, null), false, 'sem odds desde o começo: nada a guardar')
  pushOdds(timeline, 1000, A)
  assert.equal(pushOdds(timeline, 2000, { ...A, home: { ...A.home } }), false)
  assert.equal(pushOdds(timeline, 3000, null), true)
  assert.deepEqual(visibleOdds(timeline, 4000, 10_000), A)
  assert.equal(visibleOdds(timeline, 13_000, 10_000), null)
})

test('guarda no máximo 8 leituras', () => {
  const timeline = createOddsTimeline()
  for (let i = 0; i < 12; i += 1) pushOdds(timeline, i * 1000, { ...A, home: { rate: 2 + i / 10, trend: null } })
  assert.equal(timeline.entries.length, 8)
  assert.equal(visibleOdds(timeline, 100_000, 0)?.home.rate, 3.1)
})

test('orientOdds troca os times e mantém o empate; textos da legenda', () => {
  assert.deepEqual(orientOdds(A, false), A)
  assert.deepEqual(orientOdds(A, true), { home: A.away, draw: A.draw, away: A.home })
  assert.deepEqual(labelOddsText(A), { home: '3,76', draw: 'X 1,73', away: '4,77' })
  assert.deepEqual(labelOddsText({ ...A, draw: null }), { home: '3,76', draw: '', away: '4,77' })
  assert.equal(oddsSpoken(A), '1 3,76 · X 1,73 · 2 4,77')
  assert.equal(oddsSpoken({ ...A, draw: null }), '1 3,76 · 2 4,77')
})

test('preferência do menu: ligada por padrão, salva como on/off, tolera storage bloqueado', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  assert.equal(loadLabelOddsSetting(storage), true)
  saveLabelOddsSetting(storage, false)
  assert.equal(loadLabelOddsSetting(storage), false)
  saveLabelOddsSetting(storage, true)
  assert.equal(loadLabelOddsSetting(storage), true)
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(loadLabelOddsSetting(blocked), true)
  assert.doesNotThrow(() => saveLabelOddsSetting(blocked, false))
  assert.equal(loadLabelOddsSetting(null), true)
})
