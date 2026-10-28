import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAmericanFootballState,
  diffAmericanFootball,
  GOAL_EVENT_GRACE_MS,
  matchGame,
  parseGameDetail,
  parseGameList,
  scoringPlayOf,
  SPORT_IDS,
  sportOfBllName,
  type Detail365,
  type Game365,
} from '../src/livescore-365.ts'

const NOW = Date.parse('2026-10-29T23:00:00.000Z')
const EAGLES = 6671
const COWBOYS = 6661

function game(id: number, home: string, away: string, extra: Partial<Game365> = {}): Game365 {
  const short = (name: string) => name.split(' ').at(-1) ?? name
  return { id, home, away, homeNames: [home, short(home)], awayNames: [away, short(away)], competition: 'NFL', startTime: NOW, statusGroup: 2, statusText: '', ...extra }
}

/** Formato do `/web/game/` da NFL (Eagles x Cowboys, 26/10/2026). */
function detail(home: number, away: number, events: Array<[order: number, type: number, subType: number, team: number, stage: number]> | null): Detail365 {
  const raw = {
    game: {
      id: 4715013,
      statusGroup: 3,
      gameTime: 10,
      homeCompetitor: { id: EAGLES, name: 'Philadelphia Eagles', score: home, imageVersion: 1 },
      awayCompetitor: { id: COWBOYS, name: 'Dallas Cowboys', score: away, imageVersion: 1 },
      events: events?.map(([order, id, subTypeId, competitorId, stageId]) => ({ order, competitorId, stageId, gameTime: 10, eventType: { id, subTypeId } })),
    },
  }
  const parsed = parseGameDetail(raw)
  assert.ok(parsed)
  return parsed
}

test('sportOfBllName: 🏈 no nome da BLL marca futebol americano', () => {
  assert.equal(sportOfBllName('🏈 Green Bay Packers x Carolina Panthers'), 'american-football')
  assert.equal(sportOfBllName('🏀 Boston Celtics x Brooklyn Nets'), 'basketball')
  assert.equal(sportOfBllName('Sassuolo x Lazio'), 'football')
})

test('parseGameList com o id do futebol americano guarda só esses jogos', () => {
  const competitor = (id: number, name: string) => ({ id, name })
  const raw = {
    games: [
      { id: 1, sportId: 6, homeCompetitor: competitor(10, 'Green Bay Packers'), awayCompetitor: competitor(11, 'Carolina Panthers') },
      { id: 2, sportId: 1, homeCompetitor: competitor(20, 'Santos'), awayCompetitor: competitor(21, 'Pumas') },
    ],
  }
  assert.equal(SPORT_IDS['american-football'], 6)
  assert.deepEqual(parseGameList(raw, SPORT_IDS['american-football']).map((entry) => entry.id), [1])
})

test('matchGame liga o nome da BLL ao jogo da NFL, com nome inteiro ou só o apelido', () => {
  const games = [
    game(4715014, 'Green Bay Packers', 'Carolina Panthers'),
    game(4715003, 'New York Jets', 'Miami Dolphins'),
    game(4715008, 'Houston Texans', 'New York Giants'),
  ]
  const full = matchGame('🏈 Green Bay Packers x Carolina Panthers', games, NOW, 'american-football')
  assert.equal(full.status === 'matched' && full.game.id, 4715014)
  const nicknames = matchGame('Packers x Panthers', games, NOW, 'american-football')
  assert.equal(nicknames.status === 'matched' && nicknames.game.id, 4715014)
  const giants = matchGame('New York Giants x Houston Texans', games, NOW, 'american-football')
  assert.equal(giants.status === 'matched' && giants.game.id, 4715008)
})

test('scoringPlayOf: 6+ pontos é touchdown, 3+ é field goal, o resto não alerta', () => {
  assert.equal(scoringPlayOf(6), 'touchdown')
  assert.equal(scoringPlayOf(7), 'touchdown')
  assert.equal(scoringPlayOf(8), 'touchdown')
  assert.equal(scoringPlayOf(3), 'field-goal')
  assert.equal(scoringPlayOf(2), null)
  assert.equal(scoringPlayOf(1), null)
  assert.equal(scoringPlayOf(0), null)
  assert.equal(scoringPlayOf(-3), null)
})

test('diffAmericanFootball: a primeira leitura só registra o jogo', () => {
  const state = createAmericanFootballState()
  assert.deepEqual(diffAmericanFootball(state, detail(7, 3, [[1, 17, -1, COWBOYS, 64], [2, 16, 27, EAGLES, 64]]), NOW), [])
})

test('diffAmericanFootball: touchdown e field goal pelos eventos, com tipo e quarto', () => {
  const state = createAmericanFootballState()
  diffAmericanFootball(state, detail(0, 0, []), NOW)
  const td = diffAmericanFootball(state, detail(6, 0, [[1, 16, 26, EAGLES, 65]]), NOW + 3000)
  assert.equal(td.length, 1)
  assert.equal(td[0].kind, 'touchdown')
  assert.equal(td[0].team, 'home')
  assert.equal(td[0].minute, 0)
  assert.equal(td[0].note, 'passe · 2º quarto')
  // O ponto extra (+1) não alerta.
  assert.deepEqual(diffAmericanFootball(state, detail(7, 0, [[1, 16, 26, EAGLES, 65]]), NOW + 6000), [])
  const fg = diffAmericanFootball(state, detail(7, 3, [[1, 16, 26, EAGLES, 65], [2, 17, -1, COWBOYS, 66]]), NOW + 9000)
  assert.equal(fg.length, 1)
  assert.equal(fg[0].kind, 'field-goal')
  assert.equal(fg[0].team, 'away')
  assert.equal(fg[0].note, '3º quarto')
  // Nem o placar nem os eventos repetem depois da carência.
  assert.deepEqual(diffAmericanFootball(state, detail(7, 3, [[1, 16, 26, EAGLES, 65], [2, 17, -1, COWBOYS, 66]]), NOW + 60_000), [])
})

test('diffAmericanFootball: placar sem evento alerta após a carência, e o evento atrasado fica quieto', () => {
  const state = createAmericanFootballState()
  diffAmericanFootball(state, detail(0, 0, []), NOW)
  assert.deepEqual(diffAmericanFootball(state, detail(0, 6, []), NOW + 3000), [])
  const late = diffAmericanFootball(state, detail(0, 7, []), NOW + 3000 + GOAL_EVENT_GRACE_MS)
  assert.equal(late.length, 1)
  assert.equal(late[0].kind, 'touchdown')
  assert.equal(late[0].team, 'away')
  assert.deepEqual(diffAmericanFootball(state, detail(0, 7, [[1, 16, 27, COWBOYS, 64]]), NOW + 20_000), [])
})

test('diffAmericanFootball: jogo sem eventos alerta pelo placar na hora', () => {
  const state = createAmericanFootballState()
  diffAmericanFootball(state, detail(0, 0, null), NOW)
  const fg = diffAmericanFootball(state, detail(3, 0, null), NOW + 3000)
  assert.equal(fg.length, 1)
  assert.equal(fg[0].kind, 'field-goal')
  assert.deepEqual(diffAmericanFootball(state, detail(3, 2, null), NOW + 6000), [], 'safety não alerta')
  const td = diffAmericanFootball(state, detail(3, 10, null), NOW + 9000)
  assert.equal(td.length, 1)
  assert.equal(td[0].kind, 'touchdown')
  assert.equal(td[0].team, 'away')
})
