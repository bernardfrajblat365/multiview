import assert from 'node:assert/strict'
import test from 'node:test'
import type { Game365 } from '../src/livescore-365.ts'
import {
  athletePhotoUrl,
  crestKeyOf,
  formatRating,
  formatStatValue,
  initialsOf,
  parseLineupEventCounts,
  parseLineups,
  parseMatchStats,
  parsePhotoRefs,
  parseStandings,
  parseStandingsTarget,
  parseTeamRefs,
  parseWhLineup,
  photoKey,
  positionShort,
  ratingTone,
  type StandingsTarget,
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
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
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

test('parseLineupEventCounts: gols, assistências e cartões pelo id do membro', () => {
  const counts = parseLineupEventCounts([
    { playerId: 101, extraPlayers: [102], eventType: { id: 1, name: 'Gol' } },
    { playerId: 101, eventType: { id: 1, name: 'Gol' } },
    { playerId: 103, eventType: { id: 2, name: 'Cartão Amarelo' } },
    { playerId: 104, eventType: { id: 3, name: 'Cartão Vermelho', subTypeId: 21 } },
    // Substituição: extraPlayers não vira assistência
    { playerId: 105, extraPlayers: [106], eventType: { id: 1000, name: 'Substitution' } },
  ])
  assert.deepEqual(counts.get(101), { goals: 2, assists: 0, yellowCards: 0, redCards: 0 })
  assert.deepEqual(counts.get(102), { goals: 0, assists: 1, yellowCards: 0, redCards: 0 })
  assert.deepEqual(counts.get(103), { goals: 0, assists: 0, yellowCards: 1, redCards: 0 })
  assert.deepEqual(counts.get(104), { goals: 0, assists: 0, yellowCards: 0, redCards: 1 })
  assert.equal(counts.has(105), false)
  assert.equal(counts.has(106), false)
})

test('parseLineups: ícones do jogo entram nos titulares a partir de game.events', () => {
  const result = parseLineups(gameRaw({
    events: [
      { playerId: 108, extraPlayers: [105], eventType: { id: 1, name: 'Gol' } },
      { playerId: 110, eventType: { id: 2, name: 'Cartão Amarelo' } },
      { playerId: 111, eventType: { id: 3, name: 'Cartão Vermelho' } },
    ],
  }), GAME_ID)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  const byName = Object.fromEntries(result.teams[0].players.map((player) => [player.name, player]))
  assert.equal(byName['Luis Silva'].goals, 1)
  assert.equal(byName['Rafael Lopez'].assists, 1)
  assert.equal(byName['Nicolas Alvarez'].yellowCards, 1)
  assert.equal(byName['Diego Torres'].redCards, 1)
  assert.equal(byName['Peter Gulacsi'].goals, 0)
  assert.equal(byName['Bruno Costa'].assists, 0)
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
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
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

function targetRaw(over: Raw = {}): Raw {
  return {
    game: {
      id: GAME_ID,
      competitionId: 77,
      seasonNum: 2026,
      stageNum: 5,
      statusGroup: 3,
      homeCompetitor: { id: 10, name: 'Casa' },
      awayCompetitor: { id: 20, name: 'Fora' },
      ...over,
    },
  }
}

test('parseStandingsTarget: lê competição, temporada, fase, grupo, times e estado do jogo', () => {
  assert.deepEqual(parseStandingsTarget(targetRaw({ groupNum: 2 }), GAME_ID), {
    competitionId: 77,
    seasonNum: 2026,
    stageNum: 5,
    groupNum: 2,
    teamIds: [10, 20],
    hasStandings: true,
    live: true,
  })
})

test('parseStandingsTarget: null para outro jogo, sem objeto game ou sem competição, temporada ou fase', () => {
  assert.equal(parseStandingsTarget(targetRaw(), GAME_ID + 1), null)
  assert.equal(parseStandingsTarget(targetRaw({ competitionId: undefined }), GAME_ID), null)
  assert.equal(parseStandingsTarget(targetRaw({ seasonNum: 0 }), GAME_ID), null)
  assert.equal(parseStandingsTarget(targetRaw({ stageNum: '5' }), GAME_ID), null)
  assert.equal(parseStandingsTarget({}, GAME_ID), null)
  assert.equal(parseStandingsTarget(null, GAME_ID), null)
})

test('parseStandingsTarget: hasStandings só é false quando a API diz false; live só com statusGroup 3', () => {
  assert.equal(parseStandingsTarget(targetRaw({ hasStandings: false }), GAME_ID)?.hasStandings, false)
  assert.equal(parseStandingsTarget(targetRaw({ hasStandings: undefined }), GAME_ID)?.hasStandings, true)
  assert.equal(parseStandingsTarget(targetRaw(), GAME_ID)?.hasStandings, true)
  assert.equal(parseStandingsTarget(targetRaw({ statusGroup: 4 }), GAME_ID)?.live, false)
})

test('parseStandingsTarget: groupNum ausente vira null e time sem id fica fora de teamIds', () => {
  const target = parseStandingsTarget(targetRaw({ homeCompetitor: { name: 'Casa' } }), GAME_ID)
  assert.ok(target)
  assert.deepEqual(target.teamIds, [20])
  assert.equal(target.groupNum, null)
})

const TARGET: StandingsTarget = {
  competitionId: 77,
  seasonNum: 2026,
  stageNum: 5,
  groupNum: null,
  teamIds: [10, 20],
  hasStandings: true,
  live: true,
}

function standingRow(over: Raw = {}): Raw {
  return {
    position: 1,
    points: 0,
    ratio: 0,
    gamePlayed: 0,
    gamesWon: 0,
    gamesEven: 0,
    gamesLost: 0,
    destinationNum: null,
    competitor: { id: 1, name: 'Time', imageVersion: 1 },
    ...over,
  }
}

function standingsRaw(rows: Raw[], over: Raw = {}): Raw {
  return {
    standings: [
      {
        competitionId: 77,
        stageNum: 5,
        displayName: 'Liga Teste',
        destinations: [
          { num: 1, name: 'Libertadores', color: '#00ff00' },
          { num: 2, name: 'Rebaixamento', color: '#ff0000' },
          { num: 3, name: 'Sem linha', color: '#123456' },
        ],
        rows,
        ...over,
      },
    ],
  }
}

test('parseStandings: linhas em ordem de posição, shortName ou name, zonas só as usadas', () => {
  const raw = standingsRaw([
    standingRow({ position: 2, points: 7, ratio: 3, gamePlayed: 3, gamesWon: 2, gamesEven: 1, destinationNum: 1, competitor: { id: 10, name: 'Casa Futebol Clube', shortName: 'Casa', imageVersion: 4 } }),
    standingRow({ position: 1, points: 9, ratio: 5, gamePlayed: 3, gamesWon: 3, destinationNum: 1, competitor: { id: 30, name: 'Lider Esporte', shortName: '', imageVersion: 0 } }),
    standingRow({ position: 3, points: 4, ratio: -1, gamePlayed: 3, gamesWon: 1, gamesLost: 2, competitor: { id: 20, name: 'Fora', imageVersion: 7 } }),
    standingRow({ position: 4, points: 1, ratio: -7, gamePlayed: 3, gamesLost: 3, destinationNum: 2, competitor: { id: 40, name: 'Ultimo', imageVersion: 2 } }),
  ])
  assert.deepEqual(parseStandings(raw, TARGET), {
    title: 'Liga Teste',
    group: '',
    rows: [
      { position: 1, name: 'Lider Esporte', competitorId: 30, crestRef: { id: 30, imageVersion: 0 }, played: 3, won: 3, drawn: 0, lost: 0, diff: 5, points: 9, zone: 1 },
      { position: 2, name: 'Casa', competitorId: 10, crestRef: { id: 10, imageVersion: 4 }, played: 3, won: 2, drawn: 1, lost: 0, diff: 3, points: 7, zone: 1 },
      { position: 3, name: 'Fora', competitorId: 20, crestRef: { id: 20, imageVersion: 7 }, played: 3, won: 1, drawn: 0, lost: 2, diff: -1, points: 4, zone: null },
      { position: 4, name: 'Ultimo', competitorId: 40, crestRef: { id: 40, imageVersion: 2 }, played: 3, won: 0, drawn: 0, lost: 3, diff: -7, points: 1, zone: 2 },
    ],
    zones: [
      { num: 1, name: 'Libertadores', color: '#00ff00' },
      { num: 2, name: 'Rebaixamento', color: '#ff0000' },
    ],
  })
})

test('parseStandings: cor inválida de zona cai para #9bbdad', () => {
  const raw = {
    standings: [
      {
        competitionId: 77,
        stageNum: 5,
        displayName: 'Liga',
        destinations: [
          { num: 1, name: 'Verde curto', color: '#fff' },
          { num: 2, name: 'Nome', color: 'verde' },
        ],
        rows: [
          standingRow({ position: 1, destinationNum: 1, competitor: { id: 10, name: 'Casa', imageVersion: 4 } }),
          standingRow({ position: 2, destinationNum: 2, competitor: { id: 20, name: 'Fora', imageVersion: 7 } }),
        ],
      },
    ],
  }
  const table = parseStandings(raw, TARGET)
  assert.ok(table)
  assert.deepEqual(table.zones.map((zone) => zone.color), ['#9bbdad', '#9bbdad'])
})

test('parseStandings: escolhe a entrada da fase do jogo', () => {
  const raw = {
    standings: [
      { competitionId: 77, stageNum: 4, displayName: 'Fase 1', rows: [standingRow({ competitor: { id: 10, name: 'Casa', imageVersion: 4 } })] },
      { competitionId: 77, stageNum: 5, displayName: 'Fase 2', rows: [standingRow({ competitor: { id: 20, name: 'Fora', imageVersion: 7 } })] },
    ],
  }
  const table = parseStandings(raw, TARGET)
  assert.equal(table?.title, 'Fase 2')
  assert.deepEqual(table?.rows.map((row) => row.competitorId), [20])
})

test('parseStandings: em competição com grupos, mantém só o grupo do time do jogo', () => {
  const raw = standingsRaw([
    standingRow({ position: 1, groupNum: 1, competitor: { id: 99, name: 'Outro G1', imageVersion: 1 } }),
    standingRow({ position: 2, groupNum: 1, competitor: { id: 10, name: 'Casa', imageVersion: 4 } }),
    standingRow({ position: 1, groupNum: 2, competitor: { id: 50, name: 'Outro G2', imageVersion: 1 } }),
    standingRow({ position: 2, groupNum: 2, competitor: { id: 60, name: 'Outro G2b', imageVersion: 1 } }),
  ])
  const table = parseStandings(raw, TARGET)
  assert.ok(table)
  assert.equal(table.group, 'Grupo 1')
  assert.deepEqual(table.rows.map((row) => row.competitorId), [99, 10])
})

test('parseStandings: groupNum do alvo tem prioridade sobre o grupo das linhas', () => {
  const raw = standingsRaw([
    standingRow({ position: 1, groupNum: 1, competitor: { id: 99, name: 'Outro G1', imageVersion: 1 } }),
    standingRow({ position: 2, groupNum: 2, competitor: { id: 10, name: 'Casa', imageVersion: 4 } }),
    standingRow({ position: 1, groupNum: 2, competitor: { id: 50, name: 'Outro G2', imageVersion: 1 } }),
  ])
  const table = parseStandings(raw, { ...TARGET, groupNum: 2 })
  assert.ok(table)
  assert.equal(table.group, 'Grupo 2')
  assert.deepEqual(table.rows.map((row) => row.competitorId), [50, 10])
})

test('parseStandings: null sem lista de standings, sem linhas úteis ou com linhas sem time', () => {
  assert.equal(parseStandings(null, TARGET), null)
  assert.equal(parseStandings({}, TARGET), null)
  assert.equal(parseStandings({ standings: 'x' }, TARGET), null)
  assert.equal(parseStandings(standingsRaw([]), TARGET), null)
  assert.equal(parseStandings(standingsRaw([standingRow({ competitor: { id: 10, name: '', imageVersion: 1 } })]), TARGET), null)
  assert.equal(parseStandings(standingsRaw([standingRow({ competitor: { name: 'Sem id', imageVersion: 1 } })]), TARGET), null)
})

test('parseStandings: no máximo 40 linhas', () => {
  const rows = Array.from({ length: 45 }, (_, index) => standingRow({ position: index + 1, competitor: { id: index + 1, name: `Time ${index + 1}`, imageVersion: 1 } }))
  const table = parseStandings(standingsRaw(rows), TARGET)
  assert.equal(table?.rows.length, 40)
})

test('parseStandings: fase sem entrada própria não deve mostrar tabela de outra competição', () => {
  const raw = { standings: [{ competitionId: 99, stageNum: 1, rows: [standingRow({ competitor: { id: 10, name: 'Casa', imageVersion: 4 } })] }] }
  assert.equal(parseStandings(raw, TARGET), null)
})

test('parseTeamRefs: lista válida, versão 0 aceita e limite de 40 itens', () => {
  assert.deepEqual(parseTeamRefs([{ id: 5, imageVersion: 0 }, { id: 7, imageVersion: 12 }]), [
    { id: 5, imageVersion: 0 },
    { id: 7, imageVersion: 12 },
  ])
  assert.deepEqual(parseTeamRefs([]), [])
  const forty = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, imageVersion: 1 }))
  assert.equal(parseTeamRefs(forty)?.length, 40)
  const fortyOne = Array.from({ length: 41 }, (_, index) => ({ id: index + 1, imageVersion: 1 }))
  assert.equal(parseTeamRefs(fortyOne), null)
})

test('parseTeamRefs: rejeita formato errado, id inválido e versão negativa, fracionada ou ausente', () => {
  assert.equal(parseTeamRefs({ id: 1, imageVersion: 1 }), null)
  assert.equal(parseTeamRefs('7'), null)
  assert.equal(parseTeamRefs(undefined), null)
  assert.equal(parseTeamRefs([null]), null)
  assert.equal(parseTeamRefs(['7']), null)
  assert.equal(parseTeamRefs([{ id: 0, imageVersion: 1 }]), null)
  assert.equal(parseTeamRefs([{ id: -3, imageVersion: 1 }]), null)
  assert.equal(parseTeamRefs([{ id: 1.5, imageVersion: 1 }]), null)
  assert.equal(parseTeamRefs([{ id: '7', imageVersion: 1 }]), null)
  assert.equal(parseTeamRefs([{ id: 1, imageVersion: -1 }]), null)
  assert.equal(parseTeamRefs([{ id: 1, imageVersion: 1.5 }]), null)
  assert.equal(parseTeamRefs([{ id: 1 }]), null)
})

test('parseTeamRefs: versão null não deve virar 0', () => {
  assert.equal(parseTeamRefs([{ id: 1, imageVersion: null }]), null)
})

test('crestKeyOf é id:versão', () => {
  assert.equal(crestKeyOf({ id: 10, imageVersion: 4 }), '10:4')
  assert.equal(crestKeyOf({ id: 10, imageVersion: 0 }), '10:0')
})

// Forma real de `/web/game/stats/?games=<id>` (São Paulo x Corinthians, lida em 05/11/2026), reduzida.
const STATS_GAME = 4632614
function statRow(id: number, competitorId: number, name: string, value: string, valuePercentage: number, extra: Raw = {}): Raw {
  return { id, name, competitorId, value, valuePercentage, order: 0, ...extra }
}
function statsResponse(statistics: Raw[], statusGroup = 3): Raw {
  return {
    statisticsFilters: [{ filterId: -1, name: 'Partida' }],
    statistics,
    games: [{ id: STATS_GAME, statusGroup, homeCompetitor: { id: 1225, name: 'São Paulo' }, awayCompetitor: { id: 1267, name: 'Corinthians' } }],
  }
}
const REAL_STATS = statsResponse([
  statRow(10, 1225, 'Posse de Bola', '53%', 0.53, { order: 0, isTop: true, markedTeam: 1 }),
  statRow(76, 1225, 'Gols esperados (xG)', '1.72', 0.58, { order: 1, isTop: true, markedTeam: 1, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(8, 1225, 'Escanteios', '6', 0.43, { order: 5, isTop: true, markedTeam: 2 }),
  statRow(52, 1225, 'Cruzamentos completos', '10/29 (34%)', 0.6, { order: 32, markedTeam: 1, categoryId: 47, categoryName: 'Passes', categoryOrder: 2 }),
  statRow(5, 1225, 'Chutes para fora', '10', 0.62, { order: 11, markedTeam: 1, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(25, 1225, 'Trave', '0', 0, { order: 13, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(29, 1225, 'Substituição', '5', 0.5, { order: 99 }),
  statRow(12, 1225, 'Faltas', '13', 0.48, { order: 91, markedTeam: 1, categoryId: 50, categoryName: 'Disciplina', categoryOrder: 5 }),
  statRow(10, 1267, 'Posse de Bola', '47%', 0.47, { order: 0, isTop: true, markedTeam: 1 }),
  statRow(76, 1267, 'Gols esperados (xG)', '1.24', 0.42, { order: 1, isTop: true, markedTeam: 1, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(8, 1267, 'Escanteios', '8', 0.57, { order: 5, isTop: true, markedTeam: 2 }),
  statRow(52, 1267, 'Cruzamentos completos', '3/13 (23%)', 0.4, { order: 32, markedTeam: 1, categoryId: 47, categoryName: 'Passes', categoryOrder: 2 }),
  statRow(5, 1267, 'Chutes para fora', '6', 0.38, { order: 11, markedTeam: 1, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(25, 1267, 'Trave', '0', 0, { order: 13, categoryId: 46, categoryName: 'Chutes', categoryOrder: 1 }),
  statRow(29, 1267, 'Substituição', '5', 0.5, { order: 99 }),
  statRow(12, 1267, 'Faltas', '14', 0.52, { order: 91, markedTeam: 1, categoryId: 50, categoryName: 'Disciplina', categoryOrder: 5 }),
])

test('parseMatchStats: junta os dois times por estatística, Principais primeiro, categorias na ordem e Geral no fim', () => {
  const parsed = parseMatchStats(REAL_STATS, STATS_GAME)
  assert.ok(parsed)
  assert.deepEqual(parsed.teams, ['São Paulo', 'Corinthians'])
  assert.equal(parsed.live, true)
  assert.deepEqual(parsed.sections.map((section) => section.title), ['Principais', 'Chutes', 'Passes', 'Disciplina', 'Geral'])
  assert.deepEqual(parsed.sections[0].stats.map((stat) => stat.name), ['Posse de Bola', 'Gols esperados (xG)', 'Escanteios'])
  const possession = parsed.sections[0].stats[0]
  assert.deepEqual(possession.values, ['53%', '47%'])
  assert.equal(possession.better, 0)
  assert.ok(Math.abs(possession.shares[0] - 0.53) < 1e-9 && Math.abs(possession.shares[1] - 0.47) < 1e-9)
  assert.deepEqual(parsed.sections[0].stats[1].values, ['1,72', '1,24'])
  assert.equal(parsed.sections[0].stats[2].better, 1)
  assert.deepEqual(parsed.sections[1].stats.map((stat) => stat.name), ['Chutes para fora', 'Trave'])
  assert.deepEqual(parsed.sections[2].stats[0].values, ['10/29 (34%)', '3/13 (23%)'])
})

test('parseMatchStats: zero dos dois lados deixa a barra vazia e sem time melhor', () => {
  const trave = parseMatchStats(REAL_STATS, STATS_GAME)?.sections.flatMap((section) => section.stats).find((stat) => stat.name === 'Trave')
  assert.ok(trave)
  assert.deepEqual(trave.shares, [0, 0])
  assert.equal(trave.better, null)
})

test('parseMatchStats: as fatias da barra somam 1 mesmo quando o 365Scores não soma', () => {
  const parsed = parseMatchStats(statsResponse([
    statRow(3, 1225, 'Total de chutes', '8', 0.6),
    statRow(3, 1267, 'Total de chutes', '2', 0.2),
  ]), STATS_GAME)
  const [home, away] = parsed!.sections[0].stats[0].shares
  assert.ok(Math.abs(home - 0.75) < 1e-9 && Math.abs(away - 0.25) < 1e-9)
})

test('parseMatchStats: invertido segue a ordem do feed do painel (valores, barra, time melhor e nomes)', () => {
  const parsed = parseMatchStats(REAL_STATS, STATS_GAME, true)
  assert.ok(parsed)
  assert.deepEqual(parsed.teams, ['Corinthians', 'São Paulo'])
  const possession = parsed.sections[0].stats[0]
  assert.deepEqual(possession.values, ['47%', '53%'])
  assert.equal(possession.better, 1)
  assert.ok(possession.shares[1] > possession.shares[0])
})

test('parseMatchStats: estatística de um time só, de outro competidor ou de um tempo (filterId) fica de fora', () => {
  const parsed = parseMatchStats(statsResponse([
    statRow(10, 1225, 'Posse de Bola', '60%', 0.6),
    statRow(10, 1267, 'Posse de Bola', '40%', 0.4),
    statRow(10, 1225, 'Posse de Bola', '70%', 0.7, { filterId: 6 }),
    statRow(3, 1225, 'Total de chutes', '8', 0.8),
    statRow(4, 999, 'Chutes no gol', '1', 1),
    statRow(4, 1267, 'Chutes no gol', '2', 1),
  ], 4), STATS_GAME)
  assert.ok(parsed)
  assert.equal(parsed.live, false)
  assert.deepEqual(parsed.sections.flatMap((section) => section.stats.map((stat) => [stat.name, stat.values])), [['Posse de Bola', ['60%', '40%']]])
})

test('parseMatchStats: resposta de jogo sem estatísticas, de outro jogo ou sem formato', () => {
  // Jogo que ainda não começou: a API responde só `lastUpdateId`/`ttl`.
  assert.equal(parseMatchStats({ lastUpdateId: 1, requestedUpdateId: -1, ttl: 10 }, STATS_GAME), null)
  assert.deepEqual(parseMatchStats(statsResponse([]), STATS_GAME)?.sections, [])
  assert.equal(parseMatchStats(REAL_STATS, STATS_GAME + 1), null)
  assert.equal(parseMatchStats(null, STATS_GAME), null)
  assert.equal(parseMatchStats([], STATS_GAME), null)
})

test('formatStatValue: decimal com vírgula; porcentagem e frações como vêm', () => {
  assert.equal(formatStatValue('1.72'), '1,72')
  assert.equal(formatStatValue('0.8'), '0,8')
  assert.equal(formatStatValue('53%'), '53%')
  assert.equal(formatStatValue('10/29 (34%)'), '10/29 (34%)')
  assert.equal(formatStatValue(3), '3')
  assert.equal(formatStatValue(null), '')
})
