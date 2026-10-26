import assert from 'node:assert/strict'
import test from 'node:test'
import type { Game365, TeamRef365 } from '../src/livescore-365.ts'
import { crestKey, crestUrl, findCrestTeams, liveTeams } from '../src/team-crests.ts'

const NOW = Date.parse('2026-10-26T20:00:00Z')

function game(id: number, home: string, away: string, extra: Partial<Game365> = {}): Game365 {
  return {
    id,
    home,
    away,
    homeNames: [home],
    awayNames: [away],
    competition: 'Liga teste',
    startTime: NOW,
    statusGroup: 3,
    statusText: 'Ao vivo',
    homeTeam: { id: id * 10 + 1, imageVersion: 1 },
    awayTeam: { id: id * 10 + 2, imageVersion: 1 },
    ...extra,
  }
}

test('crestUrl monta a URL do escudo com o tamanho do rótulo e sem imagem padrão', () => {
  const url = crestUrl({ id: 8508, imageVersion: 2 })
  assert.equal(url, 'https://imagecache.365scores.com/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2/v2/Competitors/8508')
  assert.ok(!url.includes('d_'))
})

test('crestUrl aceita outra base sem barra dupla', () => {
  assert.equal(
    crestUrl({ id: 8508, imageVersion: 2 }, 'http://127.0.0.1:1/'),
    'http://127.0.0.1:1/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2/v2/Competitors/8508',
  )
})

test('crestKey é id:imageVersion', () => {
  assert.equal(crestKey({ id: 8508, imageVersion: 2 }), '8508:2')
  assert.equal(crestKey({ id: 8508, imageVersion: 0 }), '8508:0')
})

test('findCrestTeams devolve as referências na mesma ordem quando os nomes batem de frente', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  const result = findCrestTeams('Lille', 'Galatasaray', [lille], NOW)
  assert.deepEqual(result, { home: lille.homeTeam, away: lille.awayTeam })
})

test('findCrestTeams inverte as referências quando o feed lista os times ao contrário', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  const result = findCrestTeams('Galatasaray', 'Lille', [lille], NOW)
  assert.ok(result)
  assert.deepEqual(result.home, lille.awayTeam)
  assert.deepEqual(result.away, lille.homeTeam)
})

test('findCrestTeams devolve null quando nenhum jogo combina', () => {
  const games = [game(1, 'Flamengo', 'Palmeiras')]
  assert.equal(findCrestTeams('Santos', 'Pumas', games, NOW), null)
})

test('findCrestTeams devolve null quando dois jogos combinam igualmente', () => {
  const games = [game(1, 'Inter', 'Sporting'), game(2, 'Inter', 'Sporting')]
  assert.equal(findCrestTeams('Inter', 'Sporting', games, NOW), null)
})

test('findCrestTeams devolve null quando o jogo combinado não tem referências dos times', () => {
  const noRefs = game(1, 'Lille', 'Galatasaray', { homeTeam: undefined, awayTeam: undefined })
  assert.equal(findCrestTeams('Lille', 'Galatasaray', [noRefs], NOW), null)
  const onlyHome = game(2, 'Lille', 'Galatasaray', { awayTeam: undefined })
  assert.equal(findCrestTeams('Lille', 'Galatasaray', [onlyHome], NOW), null)
})

test('findCrestTeams devolve null com nomes vazios', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  assert.equal(findCrestTeams('', 'Galatasaray', [lille], NOW), null)
  assert.equal(findCrestTeams('Lille', '', [lille], NOW), null)
  assert.equal(findCrestTeams('', '', [lille], NOW), null)
})

test('liveTeams pega só os times de jogos ao vivo (statusGroup 3)', () => {
  const live = game(1, 'Lille', 'Galatasaray')
  const finished = game(2, 'Flamengo', 'Palmeiras', { statusGroup: 4 })
  const scheduled = game(3, 'Santos', 'Pumas', { statusGroup: 1 })
  const teams = liveTeams([live, finished, scheduled], 10)
  assert.deepEqual(teams, [live.homeTeam, live.awayTeam])
})

test('liveTeams não repete o mesmo time em jogos diferentes', () => {
  const shared: TeamRef365 = { id: 77, imageVersion: 3 }
  const first = game(1, 'Lille', 'Galatasaray', { homeTeam: shared })
  const second = game(2, 'Lille', 'Roma', { homeTeam: shared })
  const teams = liveTeams([first, second], 10)
  assert.equal(teams.filter((team) => crestKey(team) === crestKey(shared)).length, 1)
  assert.equal(teams.length, 3)
})

test('liveTeams respeita o limite', () => {
  const games = [game(1, 'A', 'B'), game(2, 'C', 'D'), game(3, 'E', 'F')]
  assert.equal(liveTeams(games, 4).length, 4)
  assert.equal(liveTeams(games, 0).length, 0)
})

test('liveTeams ignora jogos sem referência de time', () => {
  const games = [game(1, 'A', 'B', { homeTeam: undefined, awayTeam: undefined }), game(2, 'C', 'D', { awayTeam: undefined })]
  const teams = liveTeams(games, 10)
  assert.deepEqual(teams, [games[1].homeTeam])
})
