import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alertLabel,
  classifyIncident,
  createScannerState,
  detectMatchEnd,
  extractWilliamHillId,
  filterNew,
  HISTORY_GRACE_MS,
  type RawIncident,
} from '../src/match-events.ts'
import { ALERT_SOUNDS, ALERT_SOUND_IDS } from '../src/alert-sounds.ts'
import { AUTO_HIGHLIGHT_OPTIONS, DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '../src/alert-settings.ts'

const NOW = Date.parse('2026-10-22T19:40:00.000Z')
const incident = (id: string, type: string, offsetMs = 0, extra: Partial<RawIncident> = {}): RawIncident => ({
  id,
  type,
  teamType: 'HOME',
  timestamp: new Date(NOW + offsetMs).toISOString(),
  time: { duration: 1380 },
  ...extra,
})

test('classifica apenas gol, pênalti e cartões', () => {
  assert.equal(classifyIncident(incident('a', 'GOAL'))?.kind, 'goal')
  assert.equal(classifyIncident(incident('b', 'PENALTY'))?.kind, 'penalty')
  assert.equal(classifyIncident(incident('c', 'RED_CARD'))?.kind, 'red')
  assert.equal(classifyIncident(incident('d', 'YELLOW_CARD'))?.kind, 'yellow')
  for (const type of ['CORNER', 'ATTACK', 'DANGEROUS_ATTACK', 'PENALTY_MISSED', 'SUBSTITUTION']) {
    assert.equal(classifyIncident(incident('x', type)), null, type)
  }
})

test('extrai time, minuto e gol contra', () => {
  const goal = classifyIncident(incident('g', 'GOAL', 0, { teamType: 'AWAY', subType: 'OWN_GOAL' }))
  assert.equal(goal?.team, 'away')
  assert.equal(goal?.minute, 24)
  assert.equal(goal?.ownGoal, true)
})

test('rejeita incidentes malformados', () => {
  assert.equal(classifyIncident({ type: 'GOAL' }), null)
  assert.equal(classifyIncident({ id: '', type: 'GOAL' }), null)
  assert.equal(classifyIncident({ id: 'z'.repeat(300), type: 'GOAL' }), null)
  assert.equal(classifyIncident({ id: 'a', type: 42 }), null)
})

test('histórico reenviado na conexão não gera alerta', () => {
  const state = createScannerState(NOW)
  const result = filterNew(state, [
    incident('old-goal', 'GOAL', -20 * 60_000),
    incident('old-card', 'YELLOW_CARD', -10 * 60_000),
    incident('live-goal', 'GOAL', -5_000),
  ])
  assert.deepEqual(result.fresh.map((entry) => entry.id), ['live-goal'])
  assert.equal(result.ignored, 2)
})

test('deduplica por id mesmo após reconexão', () => {
  const state = createScannerState(NOW)
  assert.equal(filterNew(state, [incident('g1', 'GOAL')]).fresh.length, 1)
  assert.equal(filterNew(state, [incident('g1', 'GOAL')]).fresh.length, 0)
  assert.equal(filterNew(state, [incident('g2', 'GOAL')]).fresh.length, 1)
})

test('valida o id do William Hill', () => {
  assert.equal(extractWilliamHillId('41630411'), '41630411')
  assert.equal(extractWilliamHillId('OB_EV41630411'), '41630411')
  assert.equal(extractWilliamHillId(41630411), '41630411')
  assert.equal(extractWilliamHillId('41630411&x=1'), null)
  assert.equal(extractWilliamHillId('../etc'), null)
  assert.equal(extractWilliamHillId(''), null)
  assert.equal(extractWilliamHillId(undefined), null)
})

test('monta o rótulo do alerta', () => {
  assert.equal(alertLabel('goal', 'Botafogo', 23), "GOL · Botafogo · 23'")
  assert.equal(alertLabel('red', '', 0), 'CARTÃO VERMELHO')
})

test('há 33 sons únicos e válidos', () => {
  assert.equal(ALERT_SOUNDS.length, 33)
  assert.equal(new Set(ALERT_SOUND_IDS).size, 33)
  for (const sound of ALERT_SOUNDS) {
    assert.ok(sound.label.length > 0)
    if (sound.src) {
      assert.equal(sound.notes.length, 0, `${sound.id} arquivo não tem notas`)
      continue
    }
    assert.ok(sound.notes.length > 0)
    for (const note of sound.notes) {
      assert.ok(note.freq > 20 && note.freq < 12000, `${sound.id} freq`)
      assert.ok(note.dur > 0 && note.at >= 0 && note.at + note.dur <= 2, `${sound.id} timing`)
      assert.ok(note.gain > 0 && note.gain <= 1, `${sound.id} gain`)
      if (note.to !== undefined) assert.ok(note.to > 20, `${sound.id} glide`)
    }
  }
})

test('preferências: padrões, valores salvos e dados corrompidos', () => {
  assert.deepEqual(parseAlertSettings(null, ALERT_SOUND_IDS), DEFAULT_ALERT_SETTINGS)
  assert.deepEqual(parseAlertSettings('{oops', ALERT_SOUND_IDS), DEFAULT_ALERT_SETTINGS)
  const saved = parseAlertSettings(JSON.stringify({ soundId: 'gongo', kinds: { yellow: true, goal: false } }), ALERT_SOUND_IDS)
  assert.equal(saved.sounds.penalty, 'gongo')
  assert.equal(saved.sounds.goal, 'gongo', 'preferência antiga (um só som) vale também para o gol')
  assert.equal(saved.kinds.yellow, true)
  assert.equal(saved.kinds.goal, false)
  assert.equal(saved.kinds.red, true)
  assert.deepEqual(parseAlertSettings(JSON.stringify({ soundId: 'inexistente' }), ALERT_SOUND_IDS).sounds, DEFAULT_ALERT_SETTINGS.sounds)
  assert.equal(DEFAULT_ALERT_SETTINGS.kinds.yellow, false)
  for (const id of Object.values(DEFAULT_ALERT_SETTINGS.sounds)) assert.ok(ALERT_SOUND_IDS.includes(id))
})

test('mesmo id repetido no mesmo lote alerta uma única vez', () => {
  const state = createScannerState(NOW)
  const result = filterNew(state, [incident('dup', 'GOAL'), incident('dup', 'GOAL'), incident('dup', 'GOAL')])
  assert.deepEqual(result.fresh.map((entry) => entry.id), ['dup'])
  assert.equal(result.ignored, 0)
})

test('incidentes sem timestamp ou com timestamp inválido são tratados como novos', () => {
  const state = createScannerState(NOW)
  const result = filterNew(state, [
    incident('no-ts', 'GOAL', 0, { timestamp: undefined }),
    incident('bad-ts', 'RED_CARD', 0, { timestamp: 'não é data' }),
  ])
  assert.deepEqual(result.fresh.map((entry) => entry.id), ['no-ts', 'bad-ts'])
  assert.equal(result.ignored, 0)
  assert.equal(classifyIncident(incident('bad-ts', 'RED_CARD', 0, { timestamp: 'não é data' }))?.timestamp, 0)
})

test('lista de ids vistos é aparada sem quebrar a deduplicação dos ids recentes', () => {
  const state = createScannerState(NOW)
  const batch = Array.from({ length: 2500 }, (_, i) => incident(`g${i}`, 'GOAL'))
  assert.equal(filterNew(state, batch).fresh.length, 2500)
  assert.ok(state.seen.size <= 2000, `seen size ${state.seen.size}`)
  assert.equal(filterNew(state, [incident('g2499', 'GOAL')]).fresh.length, 0)
  assert.equal(filterNew(state, [incident('g2000', 'GOAL')]).fresh.length, 0)
  assert.equal(filterNew(state, [incident('novo', 'GOAL')]).fresh.length, 1)
})

test('minuto é arredondado para cima a partir da duração em segundos', () => {
  const minuteOf = (duration: number) => classifyIncident(incident('m', 'GOAL', 0, { time: { duration } }))?.minute
  assert.equal(minuteOf(0), 1)
  assert.equal(minuteOf(59), 1)
  assert.equal(minuteOf(60), 2)
})

test('teamType MATCH ou desconhecido vira team match', () => {
  assert.equal(classifyIncident(incident('t1', 'GOAL', 0, { teamType: 'MATCH' }))?.team, 'match')
  assert.equal(classifyIncident(incident('t2', 'GOAL', 0, { teamType: 'NEUTRAL' }))?.team, 'match')
  assert.equal(classifyIncident(incident('t3', 'GOAL', 0, { teamType: undefined }))?.team, 'match')
})

test('duração negativa, NaN ou ausente resulta em minuto 0', () => {
  const minuteOf = (time: RawIncident['time']) => classifyIncident(incident('m', 'GOAL', 0, { time }))?.minute
  assert.equal(minuteOf({ duration: -5 }), 0)
  assert.equal(minuteOf({ duration: Number.NaN }), 0)
  assert.equal(minuteOf({ duration: 'abc' }), 0)
  assert.equal(minuteOf(null), 0)
})

test('id do William Hill: espaços, 13 dígitos e letras são rejeitados', () => {
  assert.equal(extractWilliamHillId(' 41630411'), null)
  assert.equal(extractWilliamHillId('41630411 '), null)
  assert.equal(extractWilliamHillId('OB_EV 41630411'), null)
  assert.equal(extractWilliamHillId('1234567890123'), null)
  assert.equal(extractWilliamHillId(1234567890123), null)
  assert.equal(extractWilliamHillId('123456789012'), '123456789012')
  assert.equal(extractWilliamHillId('4163x0411'), null)
  assert.equal(extractWilliamHillId('abc'), null)
  assert.equal(extractWilliamHillId('OB_EVabc'), null)
  assert.equal(extractWilliamHillId('ob_ev41630411'), null)
})

test('preferências: valores não booleanos, JSON null e chaves extras', () => {
  const noisy = parseAlertSettings(
    JSON.stringify({ kinds: { goal: 'sim', penalty: 0, red: null, yellow: 'true' } }),
    ALERT_SOUND_IDS,
  )
  assert.deepEqual(noisy, DEFAULT_ALERT_SETTINGS)
  assert.deepEqual(parseAlertSettings('null', ALERT_SOUND_IDS), DEFAULT_ALERT_SETTINGS)
  const extra = parseAlertSettings(
    JSON.stringify({ soundId: 'gongo', volume: 11, kinds: { goal: false, extra: true } }),
    ALERT_SOUND_IDS,
  )
  assert.deepEqual(extra, { sounds: { ...DEFAULT_ALERT_SETTINGS.sounds, goal: 'gongo', penalty: 'gongo', red: 'gongo', yellow: 'gongo', var: 'gongo' }, kinds: { ...DEFAULT_ALERT_SETTINGS.kinds, goal: false }, autoHighlight: true, autoHighlightSec: 45, scoreDelaySec: 0, closeFinishedSec: 60 })
})

test('detectMatchEnd avisa o fim uma vez quando a partida estava ao vivo', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, 'SECOND_HALF', 0), false)
  assert.equal(detectMatchEnd(state, 'GAME_FINISHED', NOW + 1000), true)
  assert.equal(detectMatchEnd(state, 'GAME_FINISHED', NOW + 2000), false)
})

test('detectMatchEnd ignora fim de partida que já estava encerrada ao abrir', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, 'GAME_FINISHED', 0), false)
  assert.equal(state.ended, false)
})

test('detectMatchEnd ignora fim antigo do histórico e aceita fim depois de abrir', () => {
  const old = createScannerState(NOW)
  assert.equal(detectMatchEnd(old, 'GAME_FINISHED', NOW - HISTORY_GRACE_MS - 1000), false)
  const fresh = createScannerState(NOW)
  assert.equal(detectMatchEnd(fresh, 'GAME_FINISHED', NOW + 1000), true)
})

test('detectMatchEnd não conta NOT_STARTED como partida ao vivo', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, 'NOT_STARTED', 0), false)
  assert.equal(state.live, false)
  assert.equal(detectMatchEnd(state, 'GAME_FINISHED', 0), false)
})

test('detectMatchEnd usa o horário do fim quando o período não pode ser lido', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, '', NOW + 1000), true)
  assert.equal(detectMatchEnd(state, '', NOW + 2000), false)
})

test('detectMatchEnd dá prioridade ao período ao vivo sobre o horário do fim', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, 'SECOND_HALF', NOW + 1000), false)
  assert.equal(state.live, true)
  assert.equal(state.ended, false)
})

test('detectMatchEnd continua ao vivo na prorrogação e nos pênaltis', () => {
  const state = createScannerState(NOW)
  assert.equal(detectMatchEnd(state, 'FIRST_HALF_EXTRA_TIME', 0), false)
  assert.equal(detectMatchEnd(state, 'PENALTIES', 0), false)
  assert.equal(detectMatchEnd(state, 'GAME_FINISHED', NOW + 1000), true)
})

test('preferência de auto-destaque: padrão ligado e valor salvo respeitado', () => {
  assert.equal(DEFAULT_ALERT_SETTINGS.autoHighlight, true)
  assert.equal(parseAlertSettings(JSON.stringify({ autoHighlight: false }), ALERT_SOUND_IDS).autoHighlight, false)
  assert.equal(parseAlertSettings(JSON.stringify({ autoHighlight: 'não' }), ALERT_SOUND_IDS).autoHighlight, true)
})

test('duração do auto-destaque: padrão 45 s, valores salvos válidos respeitados', () => {
  assert.equal(DEFAULT_ALERT_SETTINGS.autoHighlightSec, 45)
  assert.equal(parseAlertSettings(null, ALERT_SOUND_IDS).autoHighlightSec, 45)
  assert.equal(parseAlertSettings(JSON.stringify({ autoHighlightSec: 90 }), ALERT_SOUND_IDS).autoHighlightSec, 90)
  assert.equal(parseAlertSettings(JSON.stringify({ autoHighlightSec: 180 }), ALERT_SOUND_IDS).autoHighlightSec, 180)
  assert.equal(parseAlertSettings(JSON.stringify({ autoHighlightSec: 15 }), ALERT_SOUND_IDS).autoHighlightSec, 15)
})

test('duração do auto-destaque: valores inválidos voltam para 45 s', () => {
  for (const invalid of [50, '60', -1, null, 0]) {
    assert.equal(parseAlertSettings(JSON.stringify({ autoHighlightSec: invalid }), ALERT_SOUND_IDS).autoHighlightSec, 45, `valor ${String(invalid)}`)
  }
})

test('duração do auto-destaque: toda opção de AUTO_HIGHLIGHT_OPTIONS sobrevive ao salvar e reler', () => {
  for (const option of AUTO_HIGHLIGHT_OPTIONS) {
    const saved = JSON.stringify({ ...DEFAULT_ALERT_SETTINGS, autoHighlightSec: option })
    assert.equal(parseAlertSettings(saved, ALERT_SOUND_IDS).autoHighlightSec, option)
  }
})

test('duração do auto-destaque não altera o liga/desliga autoHighlight', () => {
  const on = parseAlertSettings(JSON.stringify({ autoHighlightSec: 120 }), ALERT_SOUND_IDS)
  assert.equal(on.autoHighlight, true)
  const off = parseAlertSettings(JSON.stringify({ autoHighlight: false, autoHighlightSec: 120 }), ALERT_SOUND_IDS)
  assert.equal(off.autoHighlight, false)
  assert.equal(off.autoHighlightSec, 120)
})

test('rótulo do alerta sem time, com time e com minuto 0', () => {
  assert.equal(alertLabel('yellow', '', 0), 'CARTÃO AMARELO')
  assert.equal(alertLabel('penalty', 'Flamengo', 0), 'PÊNALTI · Flamengo')
  assert.equal(alertLabel('goal', '', 45), "GOL · 45'")
})

test('classifyIncident guarda a camisa e o nome do jogador quando o feed os traz', () => {
  const withShirt = classifyIncident({ ...incident('s1', 'GOAL'), shirt: '10', playerName: '  Frandsen, M ' })
  assert.equal(withShirt?.shirt, 10)
  assert.equal(withShirt?.player, 'Frandsen, M')
  const without = classifyIncident({ ...incident('s2', 'GOAL'), shirt: 'abc', playerName: '' })
  assert.equal('shirt' in (without ?? {}), false)
  assert.equal('player' in (without ?? {}), false)
  assert.equal(classifyIncident({ ...incident('s3', 'GOAL'), shirt: 0 })?.shirt, undefined)
})
