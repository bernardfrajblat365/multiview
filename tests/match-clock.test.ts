import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clockElapsedAt,
  clockPeriod365,
  clockView,
  createClockTimeline,
  formatMatchTime,
  HALF_TIME_MS,
  nextClockChangeAt,
  normalizeElapsed,
  pushClock,
  sameClock,
  visibleClock,
  whClockPeriod,
  type MatchClock,
} from '../src/match-clock.ts'
import { clockFrom365, type Detail365 } from '../src/livescore-365.ts'

const running = (period: MatchClock['period'], elapsed: number, at = 0): MatchClock => ({ period, elapsed, running: true, at, breakStartedAt: null })

test('períodos do William Hill', () => {
  assert.equal(whClockPeriod('FIRST_HALF'), 'first')
  assert.equal(whClockPeriod('HALF_TIME'), 'half-time')
  assert.equal(whClockPeriod('SECOND_HALF'), 'second')
  assert.equal(whClockPeriod('FIRST_HALF_EXTRA_TIME'), 'extra-first')
  assert.equal(whClockPeriod('SECOND_HALF_EXTRA_TIME'), 'extra-second')
  assert.equal(whClockPeriod('PENALTIES'), 'penalties')
  assert.equal(whClockPeriod('NOT_STARTED'), null)
  assert.equal(whClockPeriod('GAME_FINISHED'), null)
  assert.equal(whClockPeriod('STOP_GAME'), null)
})

test('períodos do 365Scores por statusId e pelo texto', () => {
  assert.equal(clockPeriod365(6, 'Primeiro Tempo'), 'first')
  assert.equal(clockPeriod365(7, 'Intervalo'), 'half-time')
  assert.equal(clockPeriod365(-1, 'Segundo Tempo'), 'second')
  assert.equal(clockPeriod365(-1, 'Primeiro Tempo'), 'first')
  assert.equal(clockPeriod365(-1, 'Prorrogação - 1º Tempo'), 'extra-first')
  assert.equal(clockPeriod365(-1, 'Prorrogação - 2º Tempo'), 'extra-second')
  assert.equal(clockPeriod365(-1, 'Pênaltis'), 'penalties')
  assert.equal(clockPeriod365(175, 'Ao Vivo'), null)
})

test('feed que recomeça a contagem no 2º tempo é somado ao início do período', () => {
  assert.equal(normalizeElapsed('second', 600), 45 * 60 + 600)
  assert.equal(normalizeElapsed('second', 50 * 60), 50 * 60)
  assert.equal(normalizeElapsed('first', 600), 600)
})

test('tempo corrido e acréscimos com o relógio correndo', () => {
  assert.equal(formatMatchTime('first', 0), '0:00')
  assert.equal(formatMatchTime('first', 21 * 60 + 18), '21:18')
  assert.equal(formatMatchTime('first', 45 * 60 + 2 * 60 + 13), '45+2:13')
  assert.equal(formatMatchTime('second', 67 * 60 + 12), '67:12')
  assert.equal(formatMatchTime('second', 90 * 60 + 5), '90+0:05')
  assert.equal(formatMatchTime('extra-first', 98 * 60), '98:00')
  assert.equal(formatMatchTime('extra-second', 121 * 60), '120+1:00')
})

test('relógio correndo avança a partir da leitura; parado fica', () => {
  const clock = running('second', 67 * 60, 10_000)
  assert.equal(clockElapsedAt(clock, 15_000), 67 * 60 + 5)
  assert.equal(clockElapsedAt({ ...clock, running: false }, 15_000), 67 * 60)
  // Antes da leitura (atraso do painel) nunca volta para antes do início do período.
  assert.equal(clockElapsedAt(running('second', 45 * 60 + 2, 10_000), 0), 45 * 60)
})

test('sameClock ignora pequena deriva e detecta salto, troca de período e de estado', () => {
  const previous = running('first', 600, 0)
  assert.equal(sameClock(previous, running('first', 611, 10_000)), true)
  assert.equal(sameClock(previous, running('first', 620, 10_000)), false)
  assert.equal(sameClock(previous, running('second', 2710, 10_000)), false)
  assert.equal(sameClock(previous, { ...running('first', 610, 10_000), running: false }), false)
  assert.equal(sameClock(null, previous), false)
})

test('visão do relógio: tempos, acréscimos e relógio parado', () => {
  assert.deepEqual(clockView(running('second', 67 * 60 + 12, 0), 0), { tag: '2T', time: '67:12', paused: false, title: '2º tempo' })
  assert.equal(clockView(running('first', 45 * 60, 0), 133_000).time, '45+2:13')
  const stopped = clockView({ ...running('second', 70 * 60, 0), running: false }, 60_000)
  assert.equal(stopped.time, '70:00')
  assert.equal(stopped.paused, true)
  assert.equal(clockView({ period: 'penalties', elapsed: null, running: false, at: 0, breakStartedAt: null }, 0).tag, 'Pênaltis')
})

test('intervalo conta 15 minutos para trás desde o apito; depois só "Intervalo"', () => {
  const half: MatchClock = { period: 'half-time', elapsed: null, running: false, at: 0, breakStartedAt: 100_000 }
  assert.deepEqual(
    { tag: clockView(half, 100_000).tag, time: clockView(half, 100_000).time, paused: clockView(half, 100_000).paused },
    { tag: 'Intervalo', time: '15:00', paused: true },
  )
  assert.equal(clockView(half, 100_000 + 2 * 60_000 + 26_000).time, '12:34')
  assert.equal(clockView(half, 100_000 + HALF_TIME_MS).time, '')
  assert.equal(clockView(half, 100_000 + HALF_TIME_MS + 60_000).time, '')
  assert.equal(clockView({ ...half, breakStartedAt: null }, 0).time, '')
})

test('linha do tempo do relógio segue o atraso do painel', () => {
  const timeline = createClockTimeline()
  pushClock(timeline, 1_000, running('first', 2600, 1_000))
  pushClock(timeline, 5_000, { period: 'half-time', elapsed: null, running: false, at: 5_000, breakStartedAt: 5_000 })
  assert.equal(visibleClock(timeline, 5_000, 0)?.period, 'half-time')
  assert.equal(visibleClock(timeline, 5_000, 30_000)?.period, 'first')
  assert.equal(visibleClock(timeline, 35_000, 30_000)?.period, 'half-time')
  assert.equal(nextClockChangeAt(timeline, 5_000, 30_000), 35_000)
  pushClock(timeline, 40_000, null)
  assert.equal(visibleClock(timeline, 40_000, 0), null)
})

function detail(status: Detail365['status'], gameTime = 30, statusGroup = 3): Detail365 {
  return {
    id: 1,
    statusGroup,
    gameTime,
    home: { id: 10, name: 'A', score: 0, redCards: 0 },
    away: { id: 20, name: 'B', score: 0, redCards: 0 },
    events: [],
    pbpUrl: null,
    status,
  }
}

test('365Scores: relógio com segundos e autoProgress', () => {
  const clock = clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: { seconds: 41 * 60 + 6, running: true } }), null, 50_000)
  assert.deepEqual(clock, { period: 'first', elapsed: 41 * 60 + 6, running: true, at: 50_000, breakStartedAt: null })
  const half = clockFrom365(detail({ id: 7, text: 'Intervalo', precise: { seconds: 45 * 60, running: false } }), null, 60_000)
  assert.deepEqual(half, { period: 'half-time', elapsed: null, running: false, at: 60_000, breakStartedAt: null })
})

test('365Scores: intervalo começa quando o jogo sai do 1º tempo', () => {
  const first = clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: { seconds: 47 * 60, running: true } }), null, 0)
  const half = clockFrom365(detail({ id: 7, text: 'Intervalo', precise: null }), first, 90_000)
  assert.equal(half?.breakStartedAt, 90_000)
  const later = clockFrom365(detail({ id: 7, text: 'Intervalo', precise: null }), half, 180_000)
  assert.equal(later?.breakStartedAt, 90_000)
})

test('365Scores: sem segundos o minuto começa a contagem e não volta a cada consulta', () => {
  const first = clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: null }, 42), null, 0)
  assert.equal(first?.elapsed, 41 * 60)
  assert.equal(first?.running, true)
  // Mesmo minuto 20 s depois: mantém a contagem que já anda.
  assert.equal(clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: null }, 42), first, 20_000), first)
  // Minuto seguinte com a contagem atrasada: recomeça no minuto novo.
  const next = clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: null }, 44), first, 30_000)
  assert.equal(next?.elapsed, 43 * 60)
})

test('365Scores: sem relógio antes do jogo, depois do fim e sem status', () => {
  assert.equal(clockFrom365(detail({ id: 1, text: 'Programação', precise: null }, -1, 1), null, 0), null)
  assert.equal(clockFrom365(detail({ id: 6, text: 'Primeiro Tempo', precise: null }, 30, 4), null, 0), null)
  assert.equal(clockFrom365(detail(undefined), null, 0), null)
})
