import assert from 'node:assert/strict'
import test from 'node:test'
import type { Game365 } from '../src/livescore-365.ts'
import {
  athletePhotoUrl,
  formatRating,
  initialsOf,
  parseLineups,
  parsePhotoRefs,
  parseWhLineup,
  photoKey,
  positionShort,
  ratingTone,
} from '../src/match-info.ts'
import { crestTeamsOf, findCrestTeams, findLinkedGame } from '../src/team-crests.ts'

const NOW = Date.parse('2026-10-26T20:00:00Z')
const GAME_ID = 555

type Raw = Record<string, unknown>

const STARTERS = [
  { name: 'Peter Gulacsi', formation: 'Goleiro', position: 'Goleiro', ranking: 7.5 },
  { name: 'Gabriel Veiga', formation: null, position: 'Lateral Direito', ranking: 0 },
  { name: 'Ruben Vargas', formation: null, position: 'Zagueiro Central', ranking: undefined },
  { name: 'Ezequiel Ponce', formation: 'Meia Atacante', position: 'Meia Central', ranking: 6.9 },
  { name: 'Rafael Lopez', formation: null, position: 'Volante', ranking: 6 },
  { name: 'Mateo Ramos', formation: null, position: 'Lateral Esquerdo', ranking: 7 },
  { name: 'Juan Diaz', formation: null, position: 'Zagueiro Central', ranking: 6.5 },
  { name: 'Luis Silva', formation: null, position: 'Ponta Direita', ranking: 8.2 },
  { name: 'Bruno Costa', formation: null, position: 'Centroavante', ranking: 5.9 },
  { name: 'Nicolas Alvarez', formation: null, position: 'Ponta Esquerda', ranking: 7.1 },
  { name: 'Diego Torres', formation: null, position: 'Meia Esquerda', ranking: 6.0 },
]

/** Membros do jogo: 11 titulares, um reserva (status 2), um desfalque (status 3) e o técnico (status 4). */
const MEMBERS: Raw[] = [
  ...STARTERS.map((starter, index) => ({
    id: 101 + index,
    athleteId: 5000 + index,
    name: starter.name,
    shortName: starter.name.split(' ').at(-1),
    jerseyNumber: index + 1,
    imageVersion: 38,
  })),
  { id: 121, athleteId: 5011, name: 'Reserva Um', shortName: 'Reserva', jerseyNumber: 12, imageVersion: 38 },
  { id: 122, athleteId: 5022, name: 'Desfalque Dois', shortName: 'Desfalque', jerseyNumber: 22, imageVersion: 38 },
  { id: 130, athleteId: 6000, name: 'Marcelo Diaz', shortName: 'Diaz', jerseyNumber: -1, imageVersion: 9 },
]

const STARTER_LINEUPS: Raw[] = [
  ...STARTERS.map((starter, index) => ({
    id: 101 + index,
    status: 1,
    ...(starter.formation ? { formation: { name: starter.formation } } : {}),
    position: { name: starter.position },
    ...(starter.ranking === undefined ? {} : { ranking: starter.ranking }),
  })),
  { id: 121, status: 2, position: { name: 'Atacante' }, ranking: 6.4 },
  { id: 122, status: 3, position: { name: 'Zagueiro Central' } },
  { id: 130, status: 4, position: { name: 'Técnico' } },
]

function homeCompetitor(lineupMembers: Raw[] = STARTER_LINEUPS): Raw {
  return { id: 10, name: 'Casa', imageVersion: 4, lineups: { status: 'Confirmado', members: lineupMembers } }
}

function awayCompetitor(): Raw {
  return { id: 20, name: 'Fora', imageVersion: 7, lineups: { status: 'Provável', members: [] } }
}

function gameRaw(over: Raw = {}, homeLineups?: Raw[]): Raw {
  return {
    game: {
      id: GAME_ID,
      statusGroup: 3,
      hasLineups: true,
      members: MEMBERS,
      homeCompetitor: homeCompetitor(homeLineups),
      awayCompetitor: awayCompetitor(),
      ...over,
    },
  }
}

test('parseLineups: só os 11 titulares entram, na ordem da API, com técnico separado', () => {
  const result = parseLineups(gameRaw(), GAME_ID)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  const [home, away] = result.teams

  assert.equal(home.players.length, 11)
  assert.deepEqual(home.players.map((player) => player.name), STARTERS.map((starter) => starter.name))
  assert.ok(!home.players.some((player) => player.name === 'Reserva Um' || player.name === 'Desfalque Dois'))

  assert.deepEqual(home.coach, { name: 'Marcelo Diaz', photo: { athleteId: 6000, imageVersion: 9 } })
  assert.deepEqual(home.players[0], {
    number: 1,
    name: 'Peter Gulacsi',
    shortName: 'Gulacsi',
    position: 'Goleiro',
    positionShort: 'GOL',
    rating: 7.5,
    photo: { athleteId: 5000, imageVersion: 38 },
  })

  assert.equal(home.name, 'Casa')
  assert.equal(home.competitorId, 10)
  assert.deepEqual(home.crestRef, { id: 10, imageVersion: 4 })
  assert.equal(home.confirmed, true)

  assert.equal(away.confirmed, false)
  assert.deepEqual(away.players, [])
  assert.equal(away.coach, null)
  assert.deepEqual(away.crestRef, { id: 20, imageVersion: 7 })
})

test('parseLineups: position usa formation.name e cai para position.name; rating vem de ranking', () => {
  const result = parseLineups(gameRaw(), GAME_ID)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  const players = result.teams[0].players

  // formation.name tem prioridade sobre position.name
  assert.equal(players[3].position, 'Meia Atacante')
  assert.equal(players[3].positionShort, 'MEI')
  // sem formation, cai para position.name
  assert.equal(players[1].position, 'Lateral Direito')
  assert.equal(players[1].positionShort, 'LD')

  // ranking 7.5 vira nota; 0 e ausente viram null
  assert.equal(players[0].rating, 7.5)
  assert.equal(players[1].rating, null)
  assert.equal(players[2].rating, null)
  assert.equal(players[3].rating, 6.9)
})

test('parseLineups: confirmed só com status Confirmado e live só com statusGroup 3', () => {
  const live = parseLineups(gameRaw(), GAME_ID)
  assert.equal(live.status, 'ok')
  if (live.status === 'ok') assert.equal(live.live, true)

  const finished = parseLineups(gameRaw({ statusGroup: 4 }), GAME_ID)
  assert.equal(finished.status, 'ok')
  if (finished.status === 'ok') assert.equal(finished.live, false)

  const scheduled = parseLineups(gameRaw({ statusGroup: 1 }), GAME_ID)
  if (scheduled.status === 'ok') assert.equal(scheduled.live, false)
})

test('parseLineups: foto do jogador vem de athleteId/imageVersion do membro', () => {
  const result = parseLineups(gameRaw(), GAME_ID)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.deepEqual(result.teams[0].players[10].photo, { athleteId: 5010, imageVersion: 38 })
  assert.equal(result.teams[0].players[10].number, 11)
})

test('parseLineups: none quando hasLineups é false ou nenhum time tem titulares', () => {
  assert.deepEqual(parseLineups(gameRaw({ hasLineups: false }), GAME_ID), { status: 'none' })

  const onlyBench: Raw[] = [{ id: 121, status: 2, position: { name: 'Atacante' } }]
  const noStarters = parseLineups(gameRaw({}, onlyBench), GAME_ID)
  assert.deepEqual(noStarters, { status: 'none' })
})

test('parseLineups: invalid com id de jogo diferente, sem game ou sem competidores', () => {
  assert.deepEqual(parseLineups(gameRaw(), GAME_ID + 1), { status: 'invalid' })
  assert.deepEqual(parseLineups({}, GAME_ID), { status: 'invalid' })
  assert.deepEqual(parseLineups(null, GAME_ID), { status: 'invalid' })
  assert.deepEqual(parseLineups({ game: { id: GAME_ID, members: [] } }, GAME_ID), { status: 'invalid' })
  assert.deepEqual(
    parseLineups({ game: { id: GAME_ID, members: MEMBERS, homeCompetitor: homeCompetitor() } }, GAME_ID),
    { status: 'invalid' },
  )
})

test('parseLineups: titular sem correspondente em game.members é ignorado', () => {
  const extra: Raw[] = [{ id: 999, status: 1, position: { name: 'Goleiro' } }, ...STARTER_LINEUPS]
  const result = parseLineups(gameRaw({}, extra), GAME_ID)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal(result.teams[0].players.length, 11)
  assert.ok(result.teams[0].players.every((player) => player.name && player.name !== 'undefined'))
})

test('positionShort: siglas das posições do 365Scores e fallback', () => {
  const cases: [string, string][] = [
    ['Goleiro', 'GOL'],
    ['Lateral Direito', 'LD'],
    ['Lateral Esquerdo', 'LE'],
    ['Zagueiro Central', 'ZAG'],
    ['Volante', 'VOL'],
    ['Meia Central', 'MC'],
    ['Meia Atacante', 'MEI'],
    ['Meia Direita', 'MD'],
    ['Meia Esquerda', 'ME'],
    ['Ponta Direita', 'PD'],
    ['Ponta Esquerda', 'PE'],
    ['Centroavante', 'CA'],
    ['Segundo Atacante', 'SA'],
    ['Atacante', 'ATA'],
    ['Meio-campo', 'MC'],
    ['Defesa', 'DEF'],
    ['Líbero', 'LÍB'],
    ['', ''],
  ]
  for (const [name, short] of cases) assert.equal(positionShort(name), short, name)
})

test('formatRating usa vírgula e uma casa; sem nota vira traço', () => {
  assert.equal(formatRating(7.1), '7,1')
  assert.equal(formatRating(6), '6,0')
  assert.equal(formatRating(null), '–')
  assert.equal(formatRating(Number.NaN), '–')
})

test('ratingTone: 7 ou mais alto, 6 a 6,9 médio, abaixo de 6 baixo, sem nota none', () => {
  assert.equal(ratingTone(7), 'high')
  assert.equal(ratingTone(8.2), 'high')
  assert.equal(ratingTone(6), 'mid')
  assert.equal(ratingTone(6.9), 'mid')
  assert.equal(ratingTone(5.9), 'low')
  assert.equal(ratingTone(null), 'none')
})

test('initialsOf: primeiro e último nome, uma palavra, vazio', () => {
  assert.equal(initialsOf('Peter Gulacsi'), 'PG')
  assert.equal(initialsOf('Veiga'), 'V')
  assert.equal(initialsOf(''), '?')
  assert.equal(initialsOf('   '), '?')
})

test('athletePhotoUrl monta a URL com o transform de 68 px e a versão da imagem', () => {
  const ref = { athleteId: 7897, imageVersion: 38 }
  assert.equal(
    athletePhotoUrl(ref),
    'https://imagecache.365scores.com/image/upload/f_png,w_68,h_68,c_limit,q_auto:eco,dpr_2/v38/Athletes/7897',
  )
  assert.ok(athletePhotoUrl(ref).includes('/image/upload/f_png,w_68,h_68,c_limit,q_auto:eco,dpr_2/v38/Athletes/7897'))
  assert.equal(
    athletePhotoUrl(ref, 'http://127.0.0.1:9/'),
    'http://127.0.0.1:9/image/upload/f_png,w_68,h_68,c_limit,q_auto:eco,dpr_2/v38/Athletes/7897',
  )
})

test('photoKey é athleteId:imageVersion', () => {
  assert.equal(photoKey({ athleteId: 7897, imageVersion: 38 }), '7897:38')
})

test('parsePhotoRefs aceita lista válida', () => {
  assert.deepEqual(
    parsePhotoRefs([{ athleteId: 1, imageVersion: 2 }, { athleteId: 7897, imageVersion: 38 }]),
    [{ athleteId: 1, imageVersion: 2 }, { athleteId: 7897, imageVersion: 38 }],
  )
  assert.deepEqual(parsePhotoRefs([]), [])
  const thirty = Array.from({ length: 30 }, (_, index) => ({ athleteId: index + 1, imageVersion: 1 }))
  assert.equal(parsePhotoRefs(thirty)?.length, 30)
})

test('parsePhotoRefs rejeita mais de 30, ids inválidos e formatos errados', () => {
  const thirtyOne = Array.from({ length: 31 }, (_, index) => ({ athleteId: index + 1, imageVersion: 1 }))
  assert.equal(parsePhotoRefs(thirtyOne), null)
  assert.equal(parsePhotoRefs([{ athleteId: 0, imageVersion: 1 }]), null)
  assert.equal(parsePhotoRefs([{ athleteId: -5, imageVersion: 1 }]), null)
  assert.equal(parsePhotoRefs([{ athleteId: 1.5, imageVersion: 1 }]), null)
  assert.equal(parsePhotoRefs([{ athleteId: 1, imageVersion: 0 }]), null)
  assert.equal(parsePhotoRefs([{ athleteId: 'abc', imageVersion: 1 }]), null)
  assert.equal(parsePhotoRefs(['7897']), null)
  assert.equal(parsePhotoRefs([null]), null)
  assert.equal(parsePhotoRefs('7897'), null)
  assert.equal(parsePhotoRefs({ athleteId: 1, imageVersion: 1 }), null)
  assert.equal(parsePhotoRefs(undefined), null)
})

test('parseWhLineup: monta titulares com nome no formato "Nome Sobrenome" e camisa', () => {
  const raw = {
    home: [{ number: 1, name: 'Herrera, Lautaro' }, { number: '7', name: 'Silva, M' }],
    away: [],
    homeCoach: null,
  }
  const result = parseWhLineup(raw, 'Casa', 'Fora')
  assert.ok(result)
  const [home, away] = result

  assert.equal(home.name, 'Casa')
  assert.equal(home.competitorId, 0)
  assert.equal(home.coach, null)
  assert.equal(home.crestRef, null)
  assert.equal(home.confirmed, true)
  assert.equal(home.players.length, 2)
  assert.deepEqual(home.players[0], {
    number: 1,
    name: 'Lautaro Herrera',
    shortName: 'Lautaro Herrera',
    position: '',
    positionShort: '',
    rating: null,
    photo: null,
  })
  assert.equal(home.players[1].name, 'M. Silva')
  assert.equal(home.players[1].number, 7)
  assert.equal(home.players[1].position, '')
  assert.equal(home.players[1].rating, null)
  assert.equal(home.players[1].photo, null)

  assert.equal(away.name, 'Fora')
  assert.deepEqual(away.players, [])
})

test('parseWhLineup: técnico no formato "Sobrenome, Nome"', () => {
  const raw = { home: [{ number: 1, name: 'Herrera, Lautaro' }], away: [], homeCoach: 'Diaz, Marcelo' }
  const result = parseWhLineup(raw, 'Casa', 'Fora')
  assert.ok(result)
  assert.deepEqual(result[0].coach, { name: 'Marcelo Diaz', photo: null })
})

test('parseWhLineup: ignora jogadores sem nome', () => {
  const raw = {
    home: [{ number: 2, name: '   ' }, { number: 3 }, { number: 4, name: 'Lopez, Ana' }],
    away: [],
  }
  const result = parseWhLineup(raw, 'Casa', 'Fora')
  assert.ok(result)
  assert.equal(result[0].players.length, 1)
  assert.equal(result[0].players[0].name, 'Ana Lopez')
  assert.equal(result[0].players[0].number, 4)
})

test('parseWhLineup: null quando os dois lados estão vazios ou o raw não é objeto', () => {
  assert.equal(parseWhLineup({ home: [], away: [] }, 'Casa', 'Fora'), null)
  assert.equal(parseWhLineup({}, 'Casa', 'Fora'), null)
  assert.equal(parseWhLineup('x', 'Casa', 'Fora'), null)
  assert.equal(parseWhLineup(null, 'Casa', 'Fora'), null)
  assert.equal(parseWhLineup([], 'Casa', 'Fora'), null)
})

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

test('findLinkedGame: acha o jogo e reversed false quando a ordem bate', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  const linked = findLinkedGame('Lille', 'Galatasaray', [lille], NOW)
  assert.ok(linked)
  assert.equal(linked.game, lille)
  assert.equal(linked.reversed, false)
})

test('findLinkedGame: reversed true quando o mandante do feed é o visitante no 365Scores', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  const linked = findLinkedGame('Galatasaray', 'Lille', [lille], NOW)
  assert.ok(linked)
  assert.equal(linked.game, lille)
  assert.equal(linked.reversed, true)
})

test('findLinkedGame: null quando não há jogo claro', () => {
  assert.equal(findLinkedGame('Santos', 'Pumas', [game(1, 'Flamengo', 'Palmeiras')], NOW), null)
  assert.equal(findLinkedGame('Inter', 'Sporting', [game(1, 'Inter', 'Sporting'), game(2, 'Inter', 'Sporting')], NOW), null)
  assert.equal(findLinkedGame('', 'Sporting', [game(1, 'Inter', 'Sporting')], NOW), null)
})

test('crestTeamsOf e findCrestTeams devolvem os times na ordem do feed', () => {
  const lille = game(1, 'Lille', 'Galatasaray')
  const straight = findCrestTeams('Lille', 'Galatasaray', [lille], NOW)
  assert.deepEqual(straight, { home: lille.homeTeam, away: lille.awayTeam })

  const linked = findLinkedGame('Galatasaray', 'Lille', [lille], NOW)
  assert.ok(linked)
  assert.deepEqual(crestTeamsOf(linked), { home: lille.awayTeam, away: lille.homeTeam })

  const reversed = findCrestTeams('Galatasaray', 'Lille', [lille], NOW)
  assert.deepEqual(reversed, { home: lille.awayTeam, away: lille.homeTeam })
})
