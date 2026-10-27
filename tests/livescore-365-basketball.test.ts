import assert from 'node:assert/strict'
import test from 'node:test'
import { matchGame, parseGameList, SPORT_IDS, sportOfBllName, type Game365 } from '../src/livescore-365.ts'

const NOW = Date.parse('2026-10-27T18:00:00.000Z')

/** Jogo de basquete do 365Scores (nomes em português, como a API devolve com langId 31). */
function game(id: number, home: string, away: string, extra: Partial<Game365> = {}): Game365 {
  return { id, home, away, homeNames: [home], awayNames: [away], competition: 'Euroliga', startTime: NOW, statusGroup: 2, statusText: '', ...extra }
}

/** Euroliga e NBA de 27/10/2026, como vieram da API. */
const GAMES = [
  game(4798413, 'BC Dubai', 'Paris Basketball', { awayNames: ['Paris Basketball', 'Paris'], statusGroup: 3 }),
  game(4798414, 'Crvena Zvezda', 'Maccabi Tel Aviv'),
  game(4798416, 'Bayern de Munique', 'Barcelona'),
  game(4798415, 'Panathinaikos', 'Olimpia Milano', { awayNames: ['Olimpia Milano', 'Milano'] }),
  game(4798417, 'Valencia Basket', 'Fenerbahçe', { homeNames: ['Valencia Basket', 'Valencia'] }),
  game(4798418, 'Baskonia Vitoria', 'Real Madrid'),
  game(4812314, 'Boston Celtics', 'Brooklyn Nets', { competition: 'NBA', homeNames: ['Boston Celtics', 'Celtics'], awayNames: ['Brooklyn Nets', 'Nets'] }),
  game(4812317, 'New York Knicks', 'Detroit Pistons', { competition: 'NBA', homeNames: ['New York Knicks', 'Knicks'] }),
]

test('sportOfBllName: o emoji 🏀 no nome da BLL marca basquete; o resto é futebol', () => {
  assert.equal(sportOfBllName('🏀 Boston Celtics x Brooklyn Nets'), 'basketball')
  assert.equal(sportOfBllName('🏀 BC Dubai x Paris Basketball 🔊'), 'basketball')
  assert.equal(sportOfBllName('Sassuolo x Lazio'), 'football')
  assert.equal(sportOfBllName('🎾 ATP Vienna > 1 🔊'), 'football')
  assert.equal(sportOfBllName(''), 'football')
})

test('parseGameList com o id do basquete guarda só jogos de basquete', () => {
  const competitor = (id: number, name: string) => ({ id, name, imageVersion: 3 })
  const raw = {
    games: [
      { id: 1, sportId: 2, homeCompetitor: competitor(10, 'Boston Celtics'), awayCompetitor: competitor(11, 'Brooklyn Nets') },
      { id: 2, sportId: 1, homeCompetitor: competitor(20, 'Santos'), awayCompetitor: competitor(21, 'Pumas') },
    ],
  }
  assert.deepEqual(parseGameList(raw, SPORT_IDS.basketball).map((entry) => entry.id), [1])
  assert.deepEqual(parseGameList(raw).map((entry) => entry.id), [2])
})

test('matchGame (basquete): cada nome da lista da BLL liga ao jogo certo do 365Scores', () => {
  const cases: Array<[string, number]> = [
    ['🏀 BC Dubai x Paris Basketball 🔊', 4798413],
    ['🏀 KK Crvena zvezda x Maccabi Tel Aviv', 4798414],
    ['🏀 Bayern München x Barça Basket', 4798416],
    ['🏀 Panathinaikos BC x EA7 Emporio Armani Milano', 4798415],
    ['🏀 Valencia Basket x Fenerbahçe Tarfin', 4798417],
    ['🏀 Kosner Baskonia x Real Madrid', 4798418],
    ['🏀 Boston Celtics x Brooklyn Nets', 4812314],
    ['🏀 New York Knicks x Detroit Pistons', 4812317],
  ]
  for (const [title, id] of cases) {
    const result = matchGame(title, GAMES, NOW, 'basketball')
    assert.equal(result.status, 'matched', title)
    assert.equal(result.status === 'matched' && result.game.id, id, title)
  }
})

test('matchGame (basquete): palavra em comum com dois jogos pergunta em vez de ligar', () => {
  const games = [game(1, 'Olimpia Milano', 'Virtus Bologna'), game(2, 'Olimpia Milano', 'Fortitudo Bologna')]
  const result = matchGame('🏀 EA7 Emporio Armani Milano x Bologna', games, NOW, 'basketball')
  assert.equal(result.status, 'ambiguous')
})

test('matchGame (basquete): só uma palavra genérica em comum não liga', () => {
  const result = matchGame('🏀 Real Betis x Unicaja', [game(1, 'Real Madrid', 'Unicaja Malaga')], NOW, 'basketball')
  assert.notEqual(result.status, 'matched')
})

test('matchGame (futebol) segue exigindo os nomes inteiros: patrocinador no nome não liga', () => {
  const result = matchGame('Kosner Baskonia x Real Madrid', GAMES, NOW)
  assert.notEqual(result.status, 'matched')
})
