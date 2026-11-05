import assert from 'node:assert/strict'
import test from 'node:test'
import type { Game365, VarReview, Detail365, PbpMessage } from '../src/livescore-365.ts'
import { createLiveState, diffPbp, dropRepeatedVar } from '../src/livescore-365.ts'
import type { MatchIncident } from '../src/match-events.ts'
import { findLinkedGame } from '../src/team-crests.ts'
import {
  cancelsWhGoal,
  flipScore,
  flipSide,
  orientReview,
  recordWhGoal,
  varOnly,
  WH_GOAL_MATCH_MS,
  type WhGoal,
} from '../src/wh-var.ts'

const NOW = Date.parse('2026-11-04T20:00:00Z')

function incident(kind: MatchIncident['kind'], team: MatchIncident['team'], minute: number, note = ''): MatchIncident {
  return { id: `365:1:${kind}:${team}:${minute}`, kind, team, minute, ownGoal: false, timestamp: 0, note }
}

function game(id: number, home: string, away: string): Game365 {
  return { id, home, away, homeNames: [home], awayNames: [away], competition: '', startTime: NOW - 30 * 60_000, statusGroup: 3, statusText: '' }
}

test('varOnly: só o VAR passa; gols, cartões e pênaltis ficam com o William Hill', () => {
  const incidents = [
    incident('goal', 'home', 30),
    incident('penalty', 'away', 31),
    incident('red', 'home', 40),
    incident('yellow', 'away', 41),
    incident('var', 'home', 32, 'gol anulado'),
  ]
  const result = varOnly(incidents, false)
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'var')
  assert.equal(result[0].team, 'home')
  assert.equal(result[0].note, 'gol anulado')
})

test('varOnly: com o feed na ordem inversa, o lado do VAR vira', () => {
  const [home] = varOnly([incident('var', 'home', 20, 'pênalti')], true)
  const [away] = varOnly([incident('var', 'away', 20)], true)
  const [match] = varOnly([incident('var', 'match', 20)], true)
  assert.equal(home.team, 'away')
  assert.equal(away.team, 'home')
  assert.equal(match.team, 'match')
})

test('varOnly: não altera o lance original (o mesmo lance vai para painéis 365Scores sem virar)', () => {
  const original = incident('var', 'home', 20)
  varOnly([original], true)
  assert.equal(original.team, 'home')
})

test('flipSide e flipScore', () => {
  assert.equal(flipSide('home'), 'away')
  assert.equal(flipSide('away'), 'home')
  assert.equal(flipSide('match'), 'match')
  assert.equal(flipSide(null), null)
  assert.equal(flipScore('2 - 1'), '1 - 2')
  assert.equal(flipScore('10-0'), '0 - 10')
  assert.equal(flipScore(''), '')
  assert.equal(flipScore('?'), '?')
})

test('orientReview: vira o time revisado só quando a ordem é inversa', () => {
  const review: VarReview & { teamName: string } = { kind: 'penalty', team: 'home', minute: 26, player: 'Fulano', teamName: 'Lille' }
  assert.equal(orientReview(review, false), review)
  assert.deepEqual(orientReview(review, true), { ...review, team: 'away' })
  assert.equal(orientReview(null, true), null)
  assert.deepEqual(orientReview({ ...review, team: null }, true), { ...review, team: null })
})

test('recordWhGoal: guarda os gols recentes e esquece os antigos', () => {
  let goals: WhGoal[] = []
  goals = recordWhGoal(goals, { team: 'home', minute: 10, at: NOW - WH_GOAL_MATCH_MS - 1 })
  goals = recordWhGoal(goals, { team: 'away', minute: 60, at: NOW })
  assert.deepEqual(goals, [{ team: 'away', minute: 60, at: NOW }])
})

test('cancelsWhGoal: gol anulado do mesmo time perto do minuto do gol do WH solta o destaque', () => {
  const goals: WhGoal[] = [{ team: 'home', minute: 77, at: NOW - 60_000 }]
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 78, 'gol anulado'), NOW), true)
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 74, 'gol anulado'), NOW), true)
  // Minuto desconhecido (0) num dos lados: vale o tempo de relógio.
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 0, 'gol anulado'), NOW), true)
})

test('cancelsWhGoal: outro time, minuto longe, gol velho ou outra decisão não soltam o destaque', () => {
  const goals: WhGoal[] = [{ team: 'home', minute: 77, at: NOW - 60_000 }]
  assert.equal(cancelsWhGoal(goals, incident('var', 'away', 77, 'gol anulado'), NOW), false)
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 60, 'gol anulado'), NOW), false)
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 77, 'gol confirmado'), NOW), false)
  assert.equal(cancelsWhGoal(goals, incident('var', 'match', 77, 'gol anulado'), NOW), false)
  assert.equal(cancelsWhGoal(goals, incident('goal', 'home', 77), NOW), false)
  assert.equal(cancelsWhGoal(goals, incident('var', 'home', 77, 'gol anulado'), NOW + WH_GOAL_MATCH_MS), false)
  assert.equal(cancelsWhGoal([], incident('var', 'home', 77, 'gol anulado'), NOW), false)
})

test('vínculo WH → 365Scores: ordem inversa vira o VAR para a ordem do feed', () => {
  const games = [game(4242, 'Lille', 'Galatasaray'), game(7, 'Flamengo', 'Palmeiras')]
  const linked = findLinkedGame('Galatasaray', 'Lille', games, NOW)
  assert.ok(linked)
  assert.equal(linked.game.id, 4242)
  assert.equal(linked.reversed, true)
  // VAR contra o mandante do 365Scores (Lille) = visitante no feed WH.
  const [oriented] = varOnly([incident('var', 'home', 55, 'gol anulado')], linked.reversed)
  assert.equal(oriented.team, 'away')
  const goals: WhGoal[] = [{ team: 'away', minute: 54, at: NOW - 30_000 }]
  assert.equal(cancelsWhGoal(goals, oriented, NOW), true)
})

test('vínculo WH → 365Scores: sem jogo claro, nenhum VAR emprestado', () => {
  assert.equal(findLinkedGame('Santos', 'Pumas', [game(1, 'Flamengo', 'Palmeiras')], NOW), null)
})

test('narração do 365Scores: pênalti marcado não vai ao painel WH, a decisão do VAR vai', () => {
  const detail = { id: 9, home: { id: 1, name: 'Lille', score: 1, redCards: 0 }, away: { id: 2, name: 'Galatasaray', score: 0, redCards: 0 } } as unknown as Detail365
  const state = createLiveState()
  diffPbp(state, [], detail) // primeira leitura só registra
  const messages: PbpMessage[] = [
    { id: 1, type: 28, minute: 70, competitorNum: 1, comment: 'Pênalti para o Lille.' },
    { id: 2, type: 8, minute: 71, competitorNum: 1, comment: 'Decisão do VAR: Não Há Gol Lille 1-0' },
  ]
  const fresh = dropRepeatedVar(state, diffPbp(state, messages, detail))
  assert.deepEqual(fresh.map((entry) => entry.kind), ['penalty', 'var'])
  const forWh = varOnly(fresh, false)
  assert.equal(forWh.length, 1)
  assert.equal(forWh[0].note, 'gol anulado')
})
