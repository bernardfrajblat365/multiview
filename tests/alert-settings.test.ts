import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '../src/alert-settings.ts'

const SOUND_IDS = [DEFAULT_ALERT_SETTINGS.soundId]

test('scoreDelaySec padrão é 0 quando não há configuração salva', () => {
  const settings = parseAlertSettings(null, SOUND_IDS)
  assert.equal(settings.scoreDelaySec, 0)
})

test('scoreDelaySec válido é mantido', () => {
  const settings = parseAlertSettings(JSON.stringify({ scoreDelaySec: 30 }), SOUND_IDS)
  assert.equal(settings.scoreDelaySec, 30)
})

test('scoreDelaySec nulo é mantido e significa ocultar o placar', () => {
  const settings = parseAlertSettings(JSON.stringify({ scoreDelaySec: null }), SOUND_IDS)
  assert.equal(settings.scoreDelaySec, null)
})

test('scoreDelaySec inválido volta para 0', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ scoreDelaySec: 7 }), SOUND_IDS).scoreDelaySec, 0)
  assert.equal(parseAlertSettings(JSON.stringify({ scoreDelaySec: 'x' }), SOUND_IDS).scoreDelaySec, 0)
})

test('JSON corrompido devolve as configurações padrão', () => {
  const settings = parseAlertSettings('{não é json', SOUND_IDS)
  assert.deepEqual(settings, DEFAULT_ALERT_SETTINGS)
})

test('closeFinishedSec padrão é 60 quando não há configuração salva', () => {
  assert.equal(parseAlertSettings(null, SOUND_IDS).closeFinishedSec, 60)
})

test('closeFinishedSec válido é mantido', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ closeFinishedSec: 120 }), SOUND_IDS).closeFinishedSec, 120)
  assert.equal(parseAlertSettings(JSON.stringify({ closeFinishedSec: 0 }), SOUND_IDS).closeFinishedSec, 0)
})

test('closeFinishedSec nulo é mantido e significa não fechar', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ closeFinishedSec: null }), SOUND_IDS).closeFinishedSec, null)
})

test('closeFinishedSec inválido volta para 60', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ closeFinishedSec: 45 }), SOUND_IDS).closeFinishedSec, 60)
  assert.equal(parseAlertSettings(JSON.stringify({ closeFinishedSec: '60' }), SOUND_IDS).closeFinishedSec, 60)
})
