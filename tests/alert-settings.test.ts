import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '../src/alert-settings.ts'

const SOUND_IDS = [...new Set(Object.values(DEFAULT_ALERT_SETTINGS.sounds)), 'gongo', 'sirene']

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

test('cada tipo de alerta guarda o seu som', () => {
  assert.notEqual(DEFAULT_ALERT_SETTINGS.sounds.goal, DEFAULT_ALERT_SETTINGS.sounds.penalty)
  const sounds = { goal: 'gongo', penalty: 'sirene', red: 'gongo', yellow: 'sirene', var: 'gongo', touchdown: 'sirene', 'field-goal': 'gongo' }
  assert.deepEqual(parseAlertSettings(JSON.stringify({ sounds }), SOUND_IDS).sounds, sounds)
})

test('som inválido de um tipo volta para o padrão só daquele tipo', () => {
  const settings = parseAlertSettings(JSON.stringify({ sounds: { goal: 'inexistente', red: 'sirene', var: 7 } }), SOUND_IDS)
  assert.deepEqual(settings.sounds, { ...DEFAULT_ALERT_SETTINGS.sounds, red: 'sirene' })
})

test('preferência com um só som (soundId) vale para todos os tipos daquela época', () => {
  const settings = parseAlertSettings(JSON.stringify({ soundId: 'sirene' }), SOUND_IDS)
  assert.deepEqual(settings.sounds, { ...DEFAULT_ALERT_SETTINGS.sounds, goal: 'sirene', penalty: 'sirene', red: 'sirene', yellow: 'sirene', var: 'sirene' })
})

test('preferência com som do gol + outros alertas é migrada por tipo', () => {
  const settings = parseAlertSettings(JSON.stringify({ soundId: 'sirene', goalSoundId: 'gongo' }), SOUND_IDS)
  assert.deepEqual(settings.sounds, { ...DEFAULT_ALERT_SETTINGS.sounds, goal: 'gongo', penalty: 'sirene', red: 'sirene', yellow: 'sirene', var: 'sirene' })
  assert.equal(parseAlertSettings(JSON.stringify({ soundId: 'sirene', goalSoundId: 'inexistente' }), SOUND_IDS).sounds.goal, DEFAULT_ALERT_SETTINGS.sounds.goal)
  assert.equal(parseAlertSettings(JSON.stringify({ goalSoundId: 'gongo' }), SOUND_IDS).sounds.penalty, DEFAULT_ALERT_SETTINGS.sounds.penalty)
})

test('formato novo ignora os campos antigos', () => {
  const settings = parseAlertSettings(JSON.stringify({ soundId: 'sirene', goalSoundId: 'gongo', sounds: { red: 'gongo' } }), SOUND_IDS)
  assert.deepEqual(settings.sounds, { ...DEFAULT_ALERT_SETTINGS.sounds, red: 'gongo' })
})
