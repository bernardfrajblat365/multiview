import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '../src/alert-settings.ts'

const SOUND_IDS = [DEFAULT_ALERT_SETTINGS.soundId, DEFAULT_ALERT_SETTINGS.goalSoundId, 'gongo', 'sirene']

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

test('som do gol é separado do som dos outros alertas', () => {
  assert.notEqual(DEFAULT_ALERT_SETTINGS.goalSoundId, DEFAULT_ALERT_SETTINGS.soundId)
  const settings = parseAlertSettings(JSON.stringify({ soundId: 'sirene', goalSoundId: 'gongo' }), SOUND_IDS)
  assert.equal(settings.soundId, 'sirene')
  assert.equal(settings.goalSoundId, 'gongo')
})

test('preferência salva antes do som do gol usa o som escolhido também para o gol', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ soundId: 'sirene' }), SOUND_IDS).goalSoundId, 'sirene')
})

test('som do gol inválido volta para o padrão do gol', () => {
  assert.equal(parseAlertSettings(JSON.stringify({ soundId: 'sirene', goalSoundId: 'inexistente' }), SOUND_IDS).goalSoundId, DEFAULT_ALERT_SETTINGS.goalSoundId)
  assert.equal(parseAlertSettings(JSON.stringify({ goalSoundId: 'inexistente' }), SOUND_IDS).goalSoundId, DEFAULT_ALERT_SETTINGS.goalSoundId)
})
