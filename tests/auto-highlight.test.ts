import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_HIGHLIGHT_MS,
  companionHelps,
  composeHighlighted,
  endVarAuto,
  expireAutos,
  highlightCapacity,
  registerGoal,
  secondsLeft,
  VAR_AFTER_MS,
  VAR_MAX_MS,
  type AutoEntry,
} from '../src/auto-highlight.ts'

test('menos de 3 painéis não destaca nem altera os autos', () => {
  const autos: AutoEntry[] = []
  const result = registerGoal(autos, 'p2', 0, 2, [])
  assert.equal(result.highlighted, null)
  assert.deepEqual(result.autos, autos)
})

test('com 3 painéis o gol já destaca o painel', () => {
  const result = registerGoal([], 'p2', 0, 3, [])
  assert.deepEqual(result.highlighted, ['p2'])
})

test('gol com 9 painéis destaca o painel e mantém os dois gols mais recentes', () => {
  const first = registerGoal([], 'p5', 0, 9, [])
  assert.deepEqual(first.highlighted, ['p5'])
  assert.deepEqual(first.autos, [{ id: 'p5', expiresAt: 45000 }])

  const second = registerGoal(first.autos, 'p2', 15000, 9, [])
  assert.deepEqual(second.highlighted, ['p2', 'p5'])
  assert.deepEqual(second.autos, [
    { id: 'p5', expiresAt: 45000 },
    { id: 'p2', expiresAt: 60000 },
  ])
})

test('expiração: expiresAt igual a agora já sai, e os destaques somem em ordem', () => {
  const autos: AutoEntry[] = [
    { id: 'p5', expiresAt: 45000 },
    { id: 'p2', expiresAt: 60000 },
  ]

  const at45 = expireAutos(autos, 45000)
  assert.equal(at45.changed, true)
  assert.deepEqual(at45.autos, [{ id: 'p2', expiresAt: 60000 }])

  const at60 = expireAutos(at45.autos, 60000)
  assert.equal(at60.changed, true)
  assert.deepEqual(at60.autos, [])

  assert.deepEqual(composeHighlighted(at60.autos, [], 9), [])
})

test('capacidade excedida: só os 2 gols mais recentes permanecem', () => {
  let autos: AutoEntry[] = []
  autos = registerGoal(autos, 'p1', 0, 9, []).autos
  autos = registerGoal(autos, 'p2', 1000, 9, []).autos
  const third = registerGoal(autos, 'p3', 2000, 9, [])
  assert.deepEqual(third.autos.map((entry) => entry.id), ['p2', 'p3'])
  assert.deepEqual(third.highlighted, ['p3', 'p2'])
})

test('painel já destacado pelo usuário não é alterado por gol', () => {
  const autos: AutoEntry[] = []
  const result = registerGoal(autos, 'p3', 0, 9, ['p3'])
  assert.equal(result.highlighted, null)
  assert.deepEqual(result.autos, autos)
})

test('gol repetido em painel já automático renova o prazo e vai para o topo', () => {
  const autos: AutoEntry[] = [
    { id: 'p5', expiresAt: 45000 },
    { id: 'p2', expiresAt: 60000 },
  ]
  const result = registerGoal(autos, 'p5', 30000, 9, [])
  assert.deepEqual(result.autos, [
    { id: 'p2', expiresAt: 60000 },
    { id: 'p5', expiresAt: 30000 + AUTO_HIGHLIGHT_MS },
  ])
  assert.deepEqual(result.highlighted, ['p5', 'p2'])
})

test('destaques do usuário têm menor prioridade que os automáticos', () => {
  const first = registerGoal([], 'p5', 0, 9, ['u1'])
  assert.deepEqual(first.highlighted, ['p5', 'u1'])

  const second = registerGoal(first.autos, 'p6', 1000, 9, ['u1'])
  assert.deepEqual(second.highlighted, ['p6', 'p5'])
})

test('secondsLeft arredonda para cima e nunca fica negativo', () => {
  const entry: AutoEntry = { id: 'p1', expiresAt: 45000 }
  assert.equal(secondsLeft(entry, 0), 45)
  assert.equal(secondsLeft(entry, 44001), 1)
  assert.equal(secondsLeft(entry, 50000), 0)
})

test('highlightCapacity(0) é 0', () => {
  assert.equal(highlightCapacity(0), 0)
})

const panelOrderOf = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`)

test('companionHelps: falso com 3 e 4 telas (capacidade 1)', () => {
  assert.equal(companionHelps(3), false)
  assert.equal(companionHelps(4), false)
})

test('companionHelps: falso com 5 e 13 telas (um destaque já é grande)', () => {
  assert.equal(companionHelps(5), false)
  assert.equal(companionHelps(13), false)
})

test('companionHelps: verdadeiro com 6, 11, 12 e 18 telas', () => {
  assert.equal(companionHelps(6), true)
  assert.equal(companionHelps(11), true)
  assert.equal(companionHelps(12), true)
  assert.equal(companionHelps(18), true)
})

test('gol sozinho com 12 telas traz o primeiro outro painel como companheiro', () => {
  const autos: AutoEntry[] = [{ id: 'p5', expiresAt: 45000 }]
  assert.deepEqual(composeHighlighted(autos, [], 12, panelOrderOf(12)), ['p5', 'p0'])
})

test('gol no p0 com 12 telas traz o p1 como companheiro', () => {
  const autos: AutoEntry[] = [{ id: 'p0', expiresAt: 45000 }]
  assert.deepEqual(composeHighlighted(autos, [], 12, panelOrderOf(12)), ['p0', 'p1'])
})

test('sem panelOrder a chamada antiga de 3 argumentos devolve só o gol', () => {
  const autos: AutoEntry[] = [{ id: 'p5', expiresAt: 45000 }]
  assert.deepEqual(composeHighlighted(autos, [], 12), ['p5'])
})

test('com destaque do usuário em outro painel não há companheiro', () => {
  const autos: AutoEntry[] = [{ id: 'p5', expiresAt: 45000 }]
  const highlighted = composeHighlighted(autos, ['u1'], 12, panelOrderOf(12))
  assert.deepEqual(highlighted, ['p5', 'u1'])
  assert.equal(highlighted.length, 2)
})

test('com dois gols não há companheiro', () => {
  const autos: AutoEntry[] = [
    { id: 'p5', expiresAt: 45000 },
    { id: 'p2', expiresAt: 60000 },
  ]
  assert.deepEqual(composeHighlighted(autos, [], 12, panelOrderOf(12)), ['p2', 'p5'])
})

test('com 13 telas o gol sozinho fica sem companheiro', () => {
  const autos: AutoEntry[] = [{ id: 'p5', expiresAt: 45000 }]
  assert.deepEqual(composeHighlighted(autos, [], 13, panelOrderOf(13)), ['p5'])
})

test('registerGoal com 12 telas destaca o gol e o primeiro outro painel, sem companheiro em autos', () => {
  const result = registerGoal([], 'p5', 0, 12, [], panelOrderOf(12))
  assert.deepEqual(result.highlighted, ['p5', 'p0'])
  assert.deepEqual(result.autos, [{ id: 'p5', expiresAt: AUTO_HIGHLIGHT_MS }])
})

test('registerGoal com duração personalizada define expiresAt = agora + duração', () => {
  const result = registerGoal([], 'p5', 1000, 9, [], panelOrderOf(9), 120_000)
  assert.deepEqual(result.autos, [{ id: 'p5', expiresAt: 121_000 }])
  assert.deepEqual(result.highlighted, ['p5'])
})

test('registerGoal sem duração usa AUTO_HIGHLIGHT_MS', () => {
  const result = registerGoal([], 'p5', 1000, 9, [])
  assert.deepEqual(result.autos, [{ id: 'p5', expiresAt: 1000 + AUTO_HIGHLIGHT_MS }])
})

test('expireAutos com duração personalizada mantém antes do prazo e remove no prazo', () => {
  const { autos } = registerGoal([], 'p5', 0, 9, [], panelOrderOf(9), 120_000)
  const before = expireAutos(autos, 119_999)
  assert.equal(before.changed, false)
  assert.deepEqual(before.autos, [{ id: 'p5', expiresAt: 120_000 }])

  const atDeadline = expireAutos(autos, 120_000)
  assert.equal(atDeadline.changed, true)
  assert.deepEqual(atDeadline.autos, [])
})

test('gol repetido no mesmo painel com outra duração substitui o expiresAt', () => {
  const first = registerGoal([], 'p5', 0, 9, [], panelOrderOf(9), 180_000)
  assert.deepEqual(first.autos, [{ id: 'p5', expiresAt: 180_000 }])

  const second = registerGoal(first.autos, 'p5', 30_000, 9, [], panelOrderOf(9), 15_000)
  assert.deepEqual(second.autos, [{ id: 'p5', expiresAt: 45_000 }])
})

test('a VAR review highlights its panel until the review ends, then VAR_AFTER_MS more', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const started = registerGoal([], 'c', 1000, 5, [], order, VAR_MAX_MS, 'var')
  assert.deepEqual(started.autos, [{ id: 'c', expiresAt: 1000 + VAR_MAX_MS, reason: 'var', reviewing: true }])
  assert.equal(started.highlighted?.[0], 'c')
  const ended = endVarAuto(started.autos, 'c', 60_000)
  assert.deepEqual(ended, [{ id: 'c', expiresAt: 60_000 + VAR_AFTER_MS, reason: 'var' }])
  // Ending again (or another panel) changes nothing.
  assert.deepEqual(endVarAuto(ended, 'c', 70_000), ended)
  assert.deepEqual(endVarAuto(started.autos, 'a', 60_000), started.autos)
})

test('a goal during a VAR review keeps at least the goal time after the review', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const review = registerGoal([], 'c', 0, 5, [], order, VAR_MAX_MS, 'var').autos
  const goal = registerGoal(review, 'c', 10_000, 5, [], order, AUTO_HIGHLIGHT_MS).autos
  assert.equal(goal[0].reviewing, true)
  assert.equal(goal[0].holdUntil, 10_000 + AUTO_HIGHLIGHT_MS)
  // The VAR decides 5 s later: the goal's 45 s outlast the 15 s after the review, so it is a goal highlight again.
  assert.deepEqual(endVarAuto(goal, 'c', 15_000), [{ id: 'c', expiresAt: 10_000 + AUTO_HIGHLIGHT_MS }])
})

test('a VAR review right after a goal keeps the goal time too', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const goal = registerGoal([], 'c', 0, 5, [], order, AUTO_HIGHLIGHT_MS).autos
  const review = registerGoal(goal, 'c', 5000, 5, [], order, VAR_MAX_MS, 'var').autos
  assert.deepEqual(review, [{ id: 'c', expiresAt: 5000 + VAR_MAX_MS, reason: 'var', reviewing: true, holdUntil: AUTO_HIGHLIGHT_MS }])
  // A long review: past the goal's time, the review's 15 s decide.
  assert.deepEqual(endVarAuto(review, 'c', 100_000), [{ id: 'c', expiresAt: 100_000 + VAR_AFTER_MS, reason: 'var' }])
})

test('a VAR review follows the same rules as a goal: 3+ panels, never a panel the user highlighted', () => {
  assert.equal(registerGoal([], 'a', 0, 2, [], ['a', 'b'], VAR_MAX_MS, 'var').highlighted, null)
  assert.equal(registerGoal([], 'a', 0, 5, ['a'], ['a', 'b', 'c', 'd', 'e'], VAR_MAX_MS, 'var').highlighted, null)
})
