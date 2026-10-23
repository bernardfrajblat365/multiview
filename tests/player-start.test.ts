import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLoadPacer,
  PLAYBACK_CHECK_INTERVAL_MS,
  PLAYBACK_MAX_RETRIES,
  PLAYBACK_TIMEOUT_MS,
  PLAYER_LOAD_SPACING_MS,
  playbackProbeScript,
} from '../electron/player-start.ts'

function fakeClock(start = 0) {
  const clock = {
    time: start,
    now: () => clock.time,
  }
  return clock
}

test('createLoadPacer: primeira reserva não espera', () => {
  const clock = fakeClock(0)
  const pacer = createLoadPacer(1000, clock.now)
  assert.equal(pacer.reserve(), 0)
})

test('createLoadPacer: reservas seguidas no mesmo instante são espaçadas', () => {
  const clock = fakeClock(0)
  const pacer = createLoadPacer(1000, clock.now)
  assert.equal(pacer.reserve(), 0)
  assert.equal(pacer.reserve(), 1000)
  assert.equal(pacer.reserve(), 2000)
})

test('createLoadPacer: depois de passar o tempo reservado, a reserva volta a ser 0', () => {
  const clock = fakeClock(0)
  const pacer = createLoadPacer(1000, clock.now)
  assert.equal(pacer.reserve(), 0)
  assert.equal(pacer.reserve(), 1000)
  clock.time = 10_000
  assert.equal(pacer.reserve(), 0)
  assert.equal(pacer.reserve(), 1000)
})

test('createLoadPacer: tempo parcial devolve o intervalo restante', () => {
  const clock = fakeClock(0)
  const pacer = createLoadPacer(1000, clock.now)
  assert.equal(pacer.reserve(), 0)
  clock.time = 400
  assert.equal(pacer.reserve(), 600)
})

test('constantes de player são positivas', () => {
  assert.ok(PLAYER_LOAD_SPACING_MS > 0)
  assert.ok(PLAYBACK_CHECK_INTERVAL_MS > 0)
  assert.ok(PLAYBACK_TIMEOUT_MS > 0)
  assert.ok(PLAYBACK_MAX_RETRIES > 0)
})

test('PLAYBACK_TIMEOUT_MS é maior que o intervalo de checagem', () => {
  assert.ok(PLAYBACK_TIMEOUT_MS > PLAYBACK_CHECK_INTERVAL_MS)
})

test('playbackProbeScript é string com readyState e paused', () => {
  assert.equal(typeof playbackProbeScript, 'string')
  assert.ok(playbackProbeScript.includes('readyState'))
  assert.ok(playbackProbeScript.includes('paused'))
})
