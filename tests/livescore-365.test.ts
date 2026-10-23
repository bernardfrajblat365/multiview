import assert from 'node:assert/strict'
import test from 'node:test'
import type { MatchIncident } from '../src/match-events.ts'
import {
  classifyEvent365,
  classifyPbp,
  createLiveState,
  diffDetail,
  diffPbp,
  dropRepeatedVar,
  matchGame,
  parseGameDetail,
  parseGameList,
  parsePbpFeed,
  pbpFeedUrl,
  teamQualifiers,
  teamSimilarity,
  teamsFromTitle,
  varDecisionNote,
  type Detail365,
  type Game365,
  type PbpMessage,
} from '../src/livescore-365.ts'

const NOW = Date.parse('2026-10-23T20:00:00.000Z')

/** Monta um jogo da API 365 já normalizado. */
function game(id: number, home: string, away: string, extra: Partial<Game365> = {}): Game365 {
  return {
    id,
    home,
    away,
    homeNames: [home],
    awayNames: [away],
    competition: 'Brasileirão',
    startTime: NOW,
    statusGroup: 2,
    statusText: '',
    ...extra,
  }
}

/** Monta um detalhe de jogo com o mandante = competidor 10 e o visitante = competidor 20. */
function detail(extra: Partial<Detail365> = {}): Detail365 {
  return {
    id: 777,
    statusGroup: 3,
    gameTime: 30,
    home: { id: 10, name: 'Santos', score: 0, redCards: 0 },
    away: { id: 20, name: 'Pumas', score: 0, redCards: 0 },
    events: [],
    ...extra,
  }
}

function event(order: number, typeId: number, subTypeId: number, competitorId = 10, gameTime = 12) {
  return { order, typeId, subTypeId, competitorId, gameTime }
}

// 1. teamsFromTitle, teamQualifiers ----------------------------------------

test('teamsFromTitle separa mandante e visitante e detecta a competição', () => {
  const found = teamsFromTitle('JUVENTUS X RENNES AO VIVO COM IMAGENS | EUROPA LEAGUE 2026')
  assert.ok(found)
  assert.equal(found.home, 'JUVENTUS')
  assert.equal(found.away, 'RENNES')
  assert.equal(found.competition, 'Europa League')
})

test('teamsFromTitle tira o rótulo "AO VIVO:" e o campeonato dos nomes', () => {
  const found = teamsFromTitle('AO VIVO: Pachuca x Cruz Azul - Liga MX')
  assert.ok(found)
  assert.equal(found.home, 'Pachuca')
  assert.equal(found.away, 'Cruz Azul')
})

test('teamsFromTitle devolve null quando o título não tem confronto', () => {
  assert.equal(teamsFromTitle('Futebol ao vivo hoje, assista agora'), null)
})

test('Brasileirão Série B no título não vira qualificador de reserva', () => {
  const found = teamsFromTitle('Santos x Pumas AO VIVO | Brasileirão Série B')
  assert.ok(found)
  assert.equal(found.qualifiers.has('reserve'), false)
  assert.equal(teamQualifiers('Brasileirão Série B', 'Santos Pumas').has('reserve'), false)
})

test('"Feminino" e "Sub-17" viram qualificadores women e u17', () => {
  const women = teamsFromTitle('Corinthians Feminino x Palmeiras Feminino AO VIVO')
  assert.ok(women)
  assert.equal(women.qualifiers.has('women'), true)
  assert.equal(women.qualifiers.has('u17'), false)

  const youth = teamsFromTitle('Flamengo Sub-17 x Vasco Sub-17 AO VIVO')
  assert.ok(youth)
  assert.equal(youth.qualifiers.has('u17'), true)
  assert.equal(youth.qualifiers.has('women'), false)
})

// 2. teamSimilarity --------------------------------------------------------

test('teamSimilarity: nomes idênticos dão 1', () => {
  assert.equal(teamSimilarity('Palmeiras', 'Palmeiras'), 1)
})

test('teamSimilarity ignora acento, caixa e "FC"', () => {
  assert.equal(teamSimilarity('Juventus', 'Juventus FC'), 1)
  assert.equal(teamSimilarity('SÃO PAULO', 'sao paulo'), 1)
})

test('teamSimilarity: nome contido no outro (subconjunto) dá 0.9', () => {
  assert.equal(teamSimilarity('Kairat', 'Kairat Almaty'), 0.9)
})

test('teamSimilarity: times diferentes com palavra comum ficam abaixo de 0.85', () => {
  assert.ok(teamSimilarity('Manchester United', 'Manchester City') < 0.85)
})

test('teamSimilarity: apelido "Galo" bate com Atlético Mineiro', () => {
  assert.equal(teamSimilarity('Galo', 'Atlético Mineiro'), 1)
})

test('teamSimilarity: "Atlético-MG" bate com Atlético Mineiro', () => {
  assert.equal(teamSimilarity('Atlético-MG', 'Atlético Mineiro'), 1)
})

test('teamSimilarity: subconjunto só com palavra genérica ("Atlético") dá 0.7, nome específico continua 0.9', () => {
  assert.equal(teamSimilarity('Atlético', 'Atlético Paranaense'), 0.7)
  assert.equal(teamSimilarity('Kairat', 'Kairat Almaty'), 0.9)
})

// 3. parseGameList ---------------------------------------------------------

function row(id: unknown, extra: Record<string, unknown> = {}) {
  return {
    id,
    sportId: 1,
    homeCompetitor: { id: 1, name: 'Santos', longName: 'Santos FC', shortName: 'SAN' },
    awayCompetitor: { id: 2, name: 'Pumas', longName: 'Pumas UNAM' },
    competitionDisplayName: 'Liga MX',
    startTime: '2026-10-23T20:00:00Z',
    statusGroup: 3,
    statusText: 'Ao vivo',
    ...extra,
  }
}

test('parseGameList devolve Game365 com todos os nomes do competidor', () => {
  const [first] = parseGameList({ games: [row(501)] })
  assert.ok(first)
  assert.equal(first.id, 501)
  assert.equal(first.home, 'Santos')
  assert.deepEqual(first.homeNames, ['Santos', 'Santos FC', 'SAN'])
  assert.deepEqual(first.awayNames, ['Pumas', 'Pumas UNAM'])
  assert.equal(first.competition, 'Liga MX')
  assert.equal(first.statusGroup, 3)
  assert.equal(first.startTime, Date.parse('2026-10-23T20:00:00Z'))
})

test('parseGameList ignora linhas sem competidores, de outro esporte ou com id inválido', () => {
  const games = parseGameList({
    games: [
      row(1, { homeCompetitor: undefined }),
      row(2, { awayCompetitor: null }),
      row(3, { sportId: 2 }),
      row(0),
      row(-5),
      row('abc'),
      row(1.5),
      row(601),
    ],
  })
  assert.deepEqual(games.map((g) => g.id), [601])
})

test('parseGameList devolve lista vazia para entrada que não é lista de jogos', () => {
  assert.deepEqual(parseGameList(null), [])
  assert.deepEqual(parseGameList('games'), [])
  assert.deepEqual(parseGameList(42), [])
  assert.deepEqual(parseGameList({ games: 'x' }), [])
})

// 4. matchGame -------------------------------------------------------------

test('matchGame: um jogo claro vira matched', () => {
  const games = [game(1, 'Flamengo', 'Vasco'), game(2, 'Palmeiras', 'Bahia')]
  const result = matchGame('Flamengo x Vasco AO VIVO', games, NOW)
  assert.equal(result.status, 'matched')
  assert.equal(result.status === 'matched' && result.game.id, 1)
})

test('matchGame: dois jogos que cabem devolvem ambiguous com candidatos', () => {
  const games = [game(1, 'Santos', 'Pumas UNAM'), game(2, 'Santos Laguna', 'Pumas UNAM')]
  const result = matchGame('Santos x Pumas AO VIVO', games, NOW)
  assert.equal(result.status, 'ambiguous')
  assert.ok(result.status === 'ambiguous')
  assert.deepEqual(result.candidates.map((g) => g.id).sort(), [1, 2])
})

test('matchGame: sem jogo compatível devolve none', () => {
  const result = matchGame('Flamengo x Vasco AO VIVO', [game(1, 'Palmeiras', 'Bahia')], NOW)
  assert.deepEqual(result, { status: 'none' })
})

test('matchGame: título com os times invertidos ainda encontra o jogo', () => {
  const result = matchGame('Vasco x Flamengo AO VIVO', [game(7, 'Flamengo', 'Vasco')], NOW)
  assert.equal(result.status, 'matched')
  assert.equal(result.status === 'matched' && result.game.id, 7)
})

test('matchGame: jogo feminino nunca vira matched a partir de título sem marcador feminino', () => {
  const womenGame = game(9, 'Corinthians (F)', 'Palmas (F)', { homeNames: ['Corinthians (F)'], awayNames: ['Palmas (F)'] })
  const result = matchGame('Corinthians x Palmas AO VIVO', [womenGame], NOW)
  assert.notEqual(result.status, 'matched')
  assert.equal(result.status, 'ambiguous')
})

test('matchGame: título feminino encontra o jogo feminino', () => {
  const womenGame = game(9, 'Corinthians (F)', 'Palmas (F)', { homeNames: ['Corinthians (F)'], awayNames: ['Palmas (F)'] })
  const result = matchGame('Corinthians Feminino x Palmas Feminino AO VIVO', [womenGame], NOW)
  assert.equal(result.status, 'matched')
})

test('matchGame: jogo ao vivo tem preferência sobre um jogo encerrado com os mesmos times', () => {
  const finished = game(10, 'Santos', 'Pumas UNAM', { statusGroup: 4, statusText: 'Final' })
  const live = game(11, 'Santos', 'Pumas UNAM', { statusGroup: 3, statusText: 'Ao vivo' })
  const result = matchGame('Santos x Pumas AO VIVO', [finished, live], NOW)
  assert.equal(result.status, 'matched')
  assert.equal(result.status === 'matched' && result.game.id, 11)
})

test('matchGame: "Atlético" no título não liga sozinho a "Atlético Paranaense" (ambiguous com candidato)', () => {
  const paranaense = game(12, 'Atlético Paranaense', 'Flamengo')
  const result = matchGame('Atlético x Flamengo AO VIVO', [paranaense], NOW)
  assert.equal(result.status, 'ambiguous')
  assert.ok(result.status === 'ambiguous')
  assert.deepEqual(result.candidates.map((g) => g.id), [12])
})

test('matchGame: "Real" no título não liga sozinho a "Real Madrid" (ambiguous)', () => {
  const madrid = game(13, 'Real Madrid', 'Barcelona')
  const result = matchGame('Real x Barcelona', [madrid], NOW)
  assert.equal(result.status, 'ambiguous')
})

test('matchGame: título com o nome completo "Real Madrid" liga ao jogo', () => {
  const madrid = game(13, 'Real Madrid', 'Barcelona')
  const result = matchGame('Real Madrid x Barcelona', [madrid], NOW)
  assert.equal(result.status, 'matched')
  assert.equal(result.status === 'matched' && result.game.id, 13)
})

// 5. parseGameDetail -------------------------------------------------------

test('parseGameDetail lê placar, cartões e eventos na ordem recebida', () => {
  const parsed = parseGameDetail({
    game: {
      id: 42,
      statusGroup: 3,
      gameTime: 37.6,
      homeCompetitor: { id: 10, name: 'Santos', score: 1, redCards: 0 },
      awayCompetitor: { id: 20, name: 'Pumas UNAM', score: 0, redCards: 1 },
      events: [
        { order: 2, competitorId: 20, gameTime: 30, eventType: { id: 3, subTypeId: 21 } },
        { order: 1, competitorId: 10, gameTime: 12, eventType: { id: 1, subTypeId: 1 } },
        { order: 3, competitorId: 10, gameTime: 33 },
      ],
    },
  })
  assert.ok(parsed)
  assert.equal(parsed.id, 42)
  assert.equal(parsed.gameTime, 37)
  assert.equal(parsed.home.score, 1)
  assert.equal(parsed.away.redCards, 1)
  assert.deepEqual(parsed.events, [
    { order: 2, typeId: 3, subTypeId: 21, competitorId: 20, gameTime: 30 },
    { order: 1, typeId: 1, subTypeId: 1, competitorId: 10, gameTime: 12 },
  ])
})

test('parseGameDetail: sem chave events o resultado tem events null', () => {
  const parsed = parseGameDetail({
    game: {
      id: 43,
      statusGroup: 3,
      gameTime: 5,
      homeCompetitor: { id: 10, name: 'Santos', score: 0, redCards: 0 },
      awayCompetitor: { id: 20, name: 'Pumas', score: 0, redCards: 0 },
    },
  })
  assert.ok(parsed)
  assert.equal(parsed.events, null)
})

test('parseGameDetail devolve null para entrada inválida', () => {
  assert.equal(parseGameDetail(null), null)
  assert.equal(parseGameDetail({}), null)
  assert.equal(parseGameDetail({ game: { id: 1 } }), null)
  assert.equal(parseGameDetail({ game: { id: 1, homeCompetitor: { id: 10, name: 'A' } } }), null)
})

// 6. classifyEvent365 ------------------------------------------------------

test('classifyEvent365: gol comum, gol contra e pênalti', () => {
  const d = detail()
  const goal = classifyEvent365(event(1, 1, 1), d)
  assert.equal(goal?.kind, 'goal')
  assert.equal(goal?.ownGoal, false)
  assert.equal(goal?.note, '')

  const own = classifyEvent365(event(2, 1, 2), d)
  assert.equal(own?.kind, 'goal')
  assert.equal(own?.ownGoal, true)

  const penalty = classifyEvent365(event(3, 1, 3), d)
  assert.equal(penalty?.kind, 'goal')
  assert.equal(penalty?.note, 'pênalti')
})

test('classifyEvent365: amarelo, vermelho e segundo amarelo', () => {
  const d = detail()
  assert.equal(classifyEvent365(event(4, 2, 0), d)?.kind, 'yellow')

  const red = classifyEvent365(event(5, 3, 0), d)
  assert.equal(red?.kind, 'red')
  assert.equal(red?.note, '')

  const secondYellow = classifyEvent365(event(6, 3, 21), d)
  assert.equal(secondYellow?.kind, 'red')
  assert.equal(secondYellow?.note, '2º amarelo')
})

test('classifyEvent365: pênalti perdido e gol anulado (VAR)', () => {
  const d = detail()
  const missed = classifyEvent365(event(7, 6, 0), d)
  assert.equal(missed?.kind, 'penalty')
  assert.equal(missed?.note, 'perdido')

  const disallowed = classifyEvent365(event(8, 11, 25), d)
  assert.equal(disallowed?.kind, 'var')
  assert.equal(disallowed?.note, 'gol anulado')
})

test('classifyEvent365: substituição e tipos desconhecidos não alertam', () => {
  assert.equal(classifyEvent365(event(9, 1000, 0), detail()), null)
})

test('classifyEvent365: lado do evento vem do competidor', () => {
  const d = detail()
  assert.equal(classifyEvent365(event(10, 1, 1, 10), d)?.team, 'home')
  assert.equal(classifyEvent365(event(11, 1, 1, 20), d)?.team, 'away')
  assert.equal(classifyEvent365(event(12, 1, 1, 99), d)?.team, 'match')
})

// 7. diffDetail -----------------------------------------------------------

test('diffDetail: a primeira leitura só registra o estado e não alerta', () => {
  const state = createLiveState()
  const d = detail({ events: [event(1, 1, 1)] })
  assert.deepEqual(diffDetail(state, d), [])
})

test('diffDetail: evento novo sai uma vez e não se repete', () => {
  const state = createLiveState()
  assert.deepEqual(diffDetail(state, detail({ events: [event(1, 1, 1)] })), [])

  const second = diffDetail(state, detail({ events: [event(1, 1, 1), event(2, 2, 0, 20)] }))
  assert.equal(second.length, 1)
  assert.equal(second[0].kind, 'yellow')
  assert.equal(second[0].team, 'away')
  assert.equal(second[0].id, '365:777:2:2')

  assert.deepEqual(diffDetail(state, detail({ events: [event(1, 1, 1), event(2, 2, 0, 20)] })), [])
})

test('diffDetail sem events: gol pelo placar, cartão vermelho e placar que volta', () => {
  const state = createLiveState()
  assert.deepEqual(diffDetail(state, detail({ events: null })), [])

  const goal = diffDetail(state, detail({ events: null, home: { id: 10, name: 'Santos', score: 1, redCards: 0 } }))
  assert.equal(goal.length, 1)
  assert.equal(goal[0].kind, 'goal')
  assert.equal(goal[0].team, 'home')

  const red = diffDetail(state, detail({ events: null, home: { id: 10, name: 'Santos', score: 1, redCards: 1 } }))
  assert.equal(red.length, 1)
  assert.equal(red[0].kind, 'red')
  assert.equal(red[0].team, 'home')

  const undo = diffDetail(state, detail({ events: null, home: { id: 10, name: 'Santos', score: 0, redCards: 1 } }))
  assert.equal(undo.length, 1)
  assert.equal(undo[0].kind, 'var')
  assert.equal(undo[0].team, 'home')
})

// 8. Subtipo re-rotulado não alerta de novo ----------------------------------

test('classifyEvent365: o id não muda quando o gol de pênalti vira gol comum', () => {
  const d = detail()
  assert.equal(classifyEvent365(event(5, 1, 3), d)?.id, classifyEvent365(event(5, 1, 1), d)?.id)
})

test('diffDetail: gol de pênalti re-rotulado como gol comum não alerta de novo', () => {
  const state = createLiveState()
  assert.deepEqual(diffDetail(state, detail({ events: [] })), [])

  const first = diffDetail(state, detail({ events: [event(4, 1, 3, 10, 20)] }))
  assert.equal(first.length, 1)
  assert.equal(first[0].kind, 'goal')
  assert.equal(first[0].note, 'pênalti')

  assert.deepEqual(diffDetail(state, detail({ events: [event(4, 1, 1, 10, 20)] })), [])
})

// 9. pbpFeedUrl e pbpUrl do parseGameDetail ----------------------------------

function rawGame(extra: Record<string, unknown> = {}) {
  return {
    game: {
      id: 42,
      statusGroup: 3,
      gameTime: 5,
      homeCompetitor: { id: 10, name: 'Santos', score: 0, redCards: 0 },
      awayCompetitor: { id: 20, name: 'Pumas', score: 0, redCards: 0 },
      ...extra,
    },
  }
}

test('pbpFeedUrl força https e aceita só o host do 365Scores', () => {
  assert.equal(pbpFeedUrl('http://pbpgenerator.365scores.com/feed/42'), 'https://pbpgenerator.365scores.com/feed/42')
  assert.equal(pbpFeedUrl('https://pbpgenerator.365scores.com/feed/42'), 'https://pbpgenerator.365scores.com/feed/42')
  assert.equal(pbpFeedUrl('https://pbpgenerator.365scores.com.evil.net/feed'), null)
  assert.equal(pbpFeedUrl('https://evil.example.com/feed'), null)
  assert.equal(pbpFeedUrl('ftp://pbpgenerator.365scores.com/feed'), null)
  assert.equal(pbpFeedUrl('não é url'), null)
  assert.equal(pbpFeedUrl(42), null)
  assert.equal(pbpFeedUrl(null), null)
})

test('parseGameDetail devolve pbpUrl em https quando o feed é do 365Scores', () => {
  const parsed = parseGameDetail(rawGame({ playByPlay: { feedURL: 'http://pbpgenerator.365scores.com/feed/42' } }))
  assert.ok(parsed)
  assert.equal(parsed.pbpUrl, 'https://pbpgenerator.365scores.com/feed/42')
})

test('parseGameDetail: sem playByPlay ou com outro host, pbpUrl é null', () => {
  const none = parseGameDetail(rawGame())
  assert.ok(none)
  assert.equal(none.pbpUrl, null)

  const other = parseGameDetail(rawGame({ playByPlay: { feedURL: 'https://example.com/feed' } }))
  assert.ok(other)
  assert.equal(other.pbpUrl, null)
})

// 10. parsePbpFeed -----------------------------------------------------------

test('parsePbpFeed lê Messages, tira "90+3" para 90 e descarta entrada inválida', () => {
  const parsed = parsePbpFeed({
    Messages: [
      { Id: 5, Type: 28, Timeline: '90+3', CompetitorNum: 1, Comment: 'Pênalti Al Ittihad.' },
      { Id: 'x', Type: 1, Timeline: '10', CompetitorNum: 1, Comment: 'Gol' },
      { Id: 6, Type: 8, Timeline: '12', CompetitorNum: 2, Comment: '  Decisão do VAR:   Gol X ' },
      null,
    ],
  })
  assert.deepEqual(parsed, [
    { id: 5, type: 28, minute: 90, competitorNum: 1, comment: 'Pênalti Al Ittihad.' },
    { id: 6, type: 8, minute: 12, competitorNum: 2, comment: 'Decisão do VAR: Gol X' },
  ])
})

test('parsePbpFeed devolve lista vazia para entrada que não é feed', () => {
  assert.deepEqual(parsePbpFeed(null), [])
  assert.deepEqual(parsePbpFeed({}), [])
  assert.deepEqual(parsePbpFeed({ Messages: 'x' }), [])
})

// 11. varDecisionNote --------------------------------------------------------

test('varDecisionNote traduz a decisão do VAR do comentário', () => {
  assert.equal(varDecisionNote('Decisão do VAR: Não Há Gol Al Ittihad 1-0 Al Nassr'), 'gol anulado')
  assert.equal(varDecisionNote('Decisão do VAR: Gol X'), 'gol confirmado')
  assert.equal(varDecisionNote('Decisão do VAR: Pênalti X'), 'pênalti')
  assert.equal(varDecisionNote('Decisão do VAR: Não há pênalti'), 'pênalti cancelado')
  assert.equal(varDecisionNote('Decisão do VAR: Cartão vermelho'), 'cartão vermelho')
  assert.equal(varDecisionNote('Outra coisa qualquer'), 'revisão')
})

// 12. classifyPbp ------------------------------------------------------------

function pbp(id: number, type: number, minute: number, competitorNum: number, comment = ''): PbpMessage {
  return { id, type, minute, competitorNum, comment }
}

test('classifyPbp: pênalti concedido (tipo 28) vira penalty sem nota', () => {
  const incident = classifyPbp(pbp(5, 28, 40, 1), detail())
  assert.equal(incident?.kind, 'penalty')
  assert.equal(incident?.note, '')
  assert.equal(incident?.minute, 40)
})

test('classifyPbp: decisão do VAR (tipo 8) e gol anulado pelo VAR (tipo 48) viram var', () => {
  const decision = classifyPbp(pbp(6, 8, 58, 1, 'Decisão do VAR: Não Há Gol'), detail())
  assert.equal(decision?.kind, 'var')
  assert.equal(decision?.note, 'gol anulado')

  const cancelled = classifyPbp(pbp(7, 48, 56, 1), detail())
  assert.equal(cancelled?.kind, 'var')
  assert.equal(cancelled?.note, 'gol anulado')
})

test('classifyPbp: outros tipos (substituição, gol, amarelo) não alertam', () => {
  for (const type of [37, 14, 44]) assert.equal(classifyPbp(pbp(8, type, 10, 1), detail()), null)
})

test('classifyPbp: lado vem do competidor; sem ele, do time citado na primeira frase', () => {
  assert.equal(classifyPbp(pbp(9, 28, 10, 2), detail())?.team, 'away')

  const named = detail({
    home: { id: 10, name: 'Al-Ittihad', score: 0, redCards: 0 },
    away: { id: 20, name: 'Al Nassr', score: 0, redCards: 0 },
  })
  assert.equal(classifyPbp(pbp(10, 28, 30, 0, 'Pênalti Al Ittihad. Youssef sofreu falta'), named)?.team, 'home')
  assert.equal(classifyPbp(pbp(11, 28, 30, 0, 'Pênalti para os visitantes.'), detail())?.team, 'match')
  assert.equal(classifyPbp(pbp(12, 28, 30, 0, 'Santos x Pumas. Lance'), detail())?.team, 'match')
})

// 13. diffPbp ---------------------------------------------------------------

test('diffPbp: a primeira leitura só registra; depois sai só o que é novo, uma vez', () => {
  const state = createLiveState()
  const d = detail()
  assert.deepEqual(diffPbp(state, [pbp(1, 37, 10, 1), pbp(2, 8, 20, 1, 'Decisão do VAR: Gol X')], d), [])

  const messages = [pbp(1, 37, 10, 1), pbp(2, 8, 20, 1, 'Decisão do VAR: Gol X'), pbp(3, 28, 30, 2)]
  const fresh = diffPbp(state, messages, d)
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].kind, 'penalty')
  assert.equal(fresh[0].team, 'away')
  assert.equal(fresh[0].id, '365pbp:777:3')

  assert.deepEqual(diffPbp(state, messages, d), [])
})

// 14. dropRepeatedVar and the full flow --------------------------------------

function varIncident(team: MatchIncident['team'], minute: number, id: string): MatchIncident {
  return { id, kind: 'var', team, minute, ownGoal: false, timestamp: 0, note: 'gol anulado' }
}

test('dropRepeatedVar: VAR do mesmo time em até 3 minutos do já enviado é descartado, também no mesmo lote', () => {
  const state = createLiveState()
  const kept = dropRepeatedVar(state, [varIncident('home', 58, 'a'), varIncident('home', 60, 'b')])
  assert.deepEqual(kept.map((incident) => incident.id), ['a'])

  assert.deepEqual(dropRepeatedVar(state, [varIncident('home', 61, 'c')]), [])
})

test('dropRepeatedVar: VAR do outro time, ou 10 minutos depois, passa', () => {
  const state = createLiveState()
  assert.equal(dropRepeatedVar(state, [varIncident('home', 58, 'a')]).length, 1)
  assert.equal(dropRepeatedVar(state, [varIncident('away', 58, 'b')]).length, 1)
  assert.equal(dropRepeatedVar(state, [varIncident('home', 68, 'c')]).length, 1)
})

test('dropRepeatedVar: incidentes que não são VAR sempre passam', () => {
  const state = createLiveState()
  dropRepeatedVar(state, [varIncident('home', 58, 'a')])
  const goal: MatchIncident = { id: 'g', kind: 'goal', team: 'home', minute: 58, ownGoal: false, timestamp: 0, note: '' }
  const red: MatchIncident = { ...goal, id: 'r', kind: 'red' }
  assert.deepEqual(dropRepeatedVar(state, [goal, red]).map((incident) => incident.id), ['g', 'r'])
})

test('fluxo completo: o mesmo VAR vindo do evento, do comentário (tipo 48) e da decisão (tipo 8) alerta uma vez', () => {
  const state = createLiveState()
  const seedMessage = pbp(1, 37, 10, 1, 'Substituição')
  // Primeira leitura: detalhe sem eventos e feed com a substituição.
  assert.deepEqual(diffDetail(state, detail({ events: [] })), [])
  assert.deepEqual(diffPbp(state, [seedMessage], detail()), [])

  // Próxima leitura: evento VAR (tipo 11) aos 58' + comentário 48 aos 56' + decisão (tipo 8) aos 58'.
  const now = detail({ gameTime: 58, events: [event(9, 11, 25, 10, 58)] })
  const messages = [seedMessage, pbp(2, 48, 56, 1, 'Gol anulado pelo VAR'), pbp(3, 8, 58, 1, 'Decisão do VAR: Não Há Gol')]
  const batch = [...diffDetail(state, now), ...diffPbp(state, messages, now)]
  assert.equal(batch.length, 3)

  const alerts = dropRepeatedVar(state, batch)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, 'var')
  assert.equal(alerts[0].team, 'home')
  assert.equal(alerts[0].minute, 58)
})
