import assert from 'node:assert/strict'
import test from 'node:test'
import {
  batchCapacity,
  groupByCompetition,
  groupByLeague,
  leagueOf,
  stageOf,
  parseBllEvents,
  planBatchOpen,
  type BllEvent,
} from '../src/bll-batch.ts'

const toUrl = (id: string) => `https://bll.example/evento/${id}`

test('parseBllEvents ignora entradas que não são array', () => {
  assert.deepEqual(parseBllEvents(null, toUrl), [])
  assert.deepEqual(parseBllEvents({ id: 'abc' }, toUrl), [])
  assert.deepEqual(parseBllEvents('abc', toUrl), [])
})

test('parseBllEvents descarta ids inválidos', () => {
  const raw = [
    { id: '', name: 'vazio' },
    { id: 'a/b', name: 'barra' },
    { id: 'x'.repeat(65), name: 'longo' },
    { id: 42, name: 'numero' },
    { name: 'sem id' },
    null,
    'texto',
    { id: 'ok-1_2', name: 'valido' },
  ]
  const events = parseBllEvents(raw, toUrl)
  assert.deepEqual(events.map((event) => event.id), ['ok-1_2'])
})

test('parseBllEvents aceita id com exatamente 64 caracteres', () => {
  const id = 'x'.repeat(64)
  assert.equal(parseBllEvents([{ id, name: 'Jogo' }], toUrl).length, 1)
})

test('parseBllEvents mantém apenas a primeira ocorrência de um id duplicado', () => {
  const raw = [
    { id: 'dup', name: 'Primeiro', competition: 'Liga A' },
    { id: 'dup', name: 'Segundo', competition: 'Liga B' },
  ]
  const events = parseBllEvents(raw, toUrl)
  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'Primeiro')
  assert.equal(events[0].competition, 'Liga A')
})

test('parseBllEvents descarta linha quando toUrl devolve null', () => {
  const rejectOdd = (id: string) => (id === 'odd' ? null : toUrl(id))
  const raw = [
    { id: 'odd', name: 'Rejeitado' },
    { id: 'even', name: 'Aceito' },
  ]
  const events = parseBllEvents(raw, rejectOdd)
  assert.deepEqual(events.map((event) => event.id), ['even'])
  assert.equal(events[0].url, toUrl('even'))
})

test('parseBllEvents limpa caracteres de controle e espaços repetidos', () => {
  const raw = [
    {
      id: 'c1',
      name: 'Time\u0000 A \u001f  x\u007f  vs Time   B',
      competition: '  Liga\u0007   Nacional  ',
      time: '  20:00  ',
    },
  ]
  const [event] = parseBllEvents(raw, toUrl)
  assert.equal(event.name, 'Time A x vs Time B')
  assert.equal(event.competition, 'Liga Nacional')
  assert.equal(event.time, '20:00')
})

test('parseBllEvents remove emojis de som do nome', () => {
  const raw = [{ id: 's1', name: '🔊 Flamengo x Vasco 🔇' }]
  const [event] = parseBllEvents(raw, toUrl)
  assert.equal(event.name, 'Flamengo x Vasco')
})

test('parseBllEvents marca basquete pelo emoji 🏀 e o tira do nome', () => {
  const events = parseBllEvents([
    { id: 'b1', name: '🏀 Boston Celtics x Brooklyn Nets 🔊' },
    { id: 'b2', name: 'Sassuolo x Lazio' },
    { id: 'b3', name: '🎾 ATP Vienna' },
  ], toUrl)
  assert.equal(events[0].name, 'Boston Celtics x Brooklyn Nets')
  assert.deepEqual(events.map((event) => event.basketball ?? false), [true, false, false])
})

test('parseBllEvents usa "Jogo sem nome" quando o nome fica vazio', () => {
  const raw = [
    { id: 'e1', name: '' },
    { id: 'e2' },
    { id: 'e3', name: '🔊' },
    { id: 'e4', name: '   \u0001  ' },
  ]
  const events = parseBllEvents(raw, toUrl)
  assert.equal(events.length, 4)
  for (const event of events) assert.equal(event.name, 'Jogo sem nome')
})

test('parseBllEvents usa "Outros" quando a competição fica vazia', () => {
  const raw = [{ id: 'k1', name: 'Jogo', competition: '   ' }, { id: 'k2', name: 'Jogo' }]
  const events = parseBllEvents(raw, toUrl)
  assert.deepEqual(events.map((event) => event.competition), ['Outros', 'Outros'])
})

test('parseBllEvents corta o horário em 5 caracteres', () => {
  const [event] = parseBllEvents([{ id: 't1', name: 'Jogo', time: '19:30:00' }], toUrl)
  assert.equal(event.time, '19:30')
})

test('parseBllEvents marca live apenas quando situation é 3', () => {
  const raw = [
    { id: 'l1', name: 'A', situation: 3 },
    { id: 'l2', name: 'B', situation: 1 },
    { id: 'l3', name: 'C', situation: '3' },
    { id: 'l4', name: 'D' },
  ]
  const events = parseBllEvents(raw, toUrl)
  assert.deepEqual(events.map((event) => event.live), [true, false, false, false])
})

test('parseBllEvents monta o url a partir do id', () => {
  const [event] = parseBllEvents([{ id: 'abc123', name: 'Jogo' }], toUrl)
  assert.equal(event.url, 'https://bll.example/evento/abc123')
  assert.equal(event.id, 'abc123')
})

test('groupByCompetition mantém a ordem de primeira aparição das competições', () => {
  const events: BllEvent[] = [
    { id: '1', name: 'A', competition: 'Liga B', time: '', live: false, url: 'u1' },
    { id: '2', name: 'B', competition: 'Liga A', time: '', live: false, url: 'u2' },
    { id: '3', name: 'C', competition: 'Liga B', time: '', live: false, url: 'u3' },
    { id: '4', name: 'D', competition: 'Liga C', time: '', live: false, url: 'u4' },
    { id: '5', name: 'E', competition: 'Liga A', time: '', live: false, url: 'u5' },
  ]
  const groups = groupByCompetition(events)
  assert.deepEqual(groups.map((group) => group.competition), ['Liga B', 'Liga A', 'Liga C'])
  assert.deepEqual(groups[0].events.map((event) => event.id), ['1', '3'])
  assert.deepEqual(groups[1].events.map((event) => event.id), ['2', '5'])
  assert.deepEqual(groups[2].events.map((event) => event.id), ['4'])
})

test('groupByCompetition retorna lista vazia para entrada vazia', () => {
  assert.deepEqual(groupByCompetition([]), [])
})

test('planBatchOpen preenche painéis vazios primeiro, em ordem', () => {
  const panels = [
    { id: 'a', url: '' },
    { id: 'b', url: 'https://x/1' },
    { id: 'c', url: '' },
  ]
  const plan = planBatchOpen(panels, ['u1', 'u2', 'u3'], 5)
  assert.deepEqual(plan.fill, [
    { panelId: 'a', url: 'u1' },
    { panelId: 'c', url: 'u2' },
  ])
  assert.deepEqual(plan.extra, ['u3'])
  assert.equal(plan.dropped, 0)
  assert.equal(plan.alreadyOpen, 0)
})

test('planBatchOpen envia o excedente para extra até o limite de painéis', () => {
  const panels = [
    { id: 'a', url: '' },
    { id: 'b', url: 'https://x/1' },
  ]
  // maxPanels 3: 1 vazio preenchido com u1; room = 3 - 2 = 1 novo painel
  const plan = planBatchOpen(panels, ['u1', 'u2', 'u3', 'u4', 'u5'], 3)
  assert.deepEqual(plan.fill, [{ panelId: 'a', url: 'u1' }])
  assert.deepEqual(plan.extra, ['u2'])
  assert.equal(plan.dropped, 3)
})

test('planBatchOpen conta como dropped o restante que não cabe', () => {
  const panels = [{ id: 'a', url: 'https://x/1' }]
  // room = 3 - 1 = 2
  const plan = planBatchOpen(panels, ['u1', 'u2', 'u3'], 3)
  assert.deepEqual(plan.fill, [])
  assert.deepEqual(plan.extra, ['u1', 'u2'])
  assert.equal(plan.dropped, 1)
})

test('planBatchOpen conta URLs já abertas em alreadyOpen sem reatribuí-las', () => {
  const panels = [
    { id: 'a', url: 'https://x/open' },
    { id: 'b', url: '' },
  ]
  const plan = planBatchOpen(panels, ['https://x/open', 'u-new'], 4)
  assert.equal(plan.alreadyOpen, 1)
  assert.deepEqual(plan.fill, [{ panelId: 'b', url: 'u-new' }])
  assert.deepEqual(plan.extra, [])
  assert.equal(plan.dropped, 0)
  // a URL já aberta não aparece em nenhum lugar do plano
  assert.equal(plan.fill.some((item) => item.url === 'https://x/open'), false)
})

test('planBatchOpen usa cada URL duplicada da entrada apenas uma vez', () => {
  const panels = [
    { id: 'a', url: '' },
    { id: 'b', url: '' },
  ]
  const plan = planBatchOpen(panels, ['u1', 'u1', 'u2'], 4)
  assert.deepEqual(plan.fill, [
    { panelId: 'a', url: 'u1' },
    { panelId: 'b', url: 'u2' },
  ])
  assert.deepEqual(plan.extra, [])
  assert.equal(plan.dropped, 0)
})

test('planBatchOpen não cria extra quando já há maxPanels painéis', () => {
  const panels = [
    { id: 'a', url: 'https://x/1' },
    { id: 'b', url: 'https://x/2' },
  ]
  const plan = planBatchOpen(panels, ['u1', 'u2'], 2)
  assert.deepEqual(plan.fill, [])
  assert.deepEqual(plan.extra, [])
  assert.equal(plan.dropped, 2)
})

test('planBatchOpen ainda preenche vazios quando panels.length >= maxPanels', () => {
  const panels = [
    { id: 'a', url: '' },
    { id: 'b', url: 'https://x/1' },
    { id: 'c', url: 'https://x/2' },
  ]
  const plan = planBatchOpen(panels, ['u1', 'u2'], 2)
  assert.deepEqual(plan.fill, [{ panelId: 'a', url: 'u1' }])
  assert.deepEqual(plan.extra, [])
  assert.equal(plan.dropped, 1)
})

test('batchCapacity soma painéis vazios e espaço restante', () => {
  const panels = [
    { id: 'a', url: '' },
    { id: 'b', url: 'https://x/1' },
    { id: 'c', url: '' },
  ]
  // 2 vazios + (6 - 3) de espaço
  assert.equal(batchCapacity(panels, 6), 5)
})

test('batchCapacity nunca fica negativo quando panels.length > maxPanels', () => {
  const panels = [
    { id: 'a', url: 'https://x/1' },
    { id: 'b', url: 'https://x/2' },
    { id: 'c', url: 'https://x/3' },
  ]
  assert.equal(batchCapacity(panels, 1), 0)
  assert.equal(batchCapacity([], 0), 0)
})

test('leagueOf e stageOf separam país e liga da fase', () => {
  assert.equal(leagueOf('Italy, Serie C, Group C'), 'Italy, Serie C')
  assert.equal(stageOf('Italy, Serie C, Group C'), 'Group C')
  assert.equal(leagueOf('Austria, ATP, Vienna, Qualifying'), 'Austria, ATP')
  assert.equal(stageOf('Austria, ATP, Vienna, Qualifying'), 'Vienna, Qualifying')
  assert.equal(leagueOf('France, Ligue 1'), 'France, Ligue 1')
  assert.equal(stageOf('France, Ligue 1'), '')
  assert.equal(leagueOf("Ballon D'Or"), "Ballon D'Or")
})

test('groupByLeague junta as fases da mesma liga, ordena ligas por nome e jogos por horário', () => {
  const event = (id: string, competition: string, time: string): BllEvent => ({ id, name: id, competition, time, live: true, url: id })
  const groups = groupByLeague([
    event('1', 'Brazil, Brasileirão Série B', '18:00'),
    event('2', 'Asia, AFC Champions League Elite, East Region', '15:00'),
    event('3', 'Outros', '10:00'),
    event('4', 'Asia, AFC Champions League Elite, West Region', '12:00'),
    event('5', 'Brazil, Brasileirão Série B', '16:00'),
    event('6', 'Asia, AFC Champions League Elite, West Region', ''),
    event('7', 'Brazil, Campeonato Brasileiro Série A', '20:00'),
  ])
  assert.deepEqual(groups.map((group) => group.competition), ['Asia, AFC Champions League Elite', 'Brazil, Brasileirão Série B', 'Brazil, Campeonato Brasileiro Série A', 'Outros'])
  assert.deepEqual(groups[0].events.map((item) => item.id), ['4', '2', '6'])
  assert.deepEqual(groups[1].events.map((item) => item.id), ['5', '1'])
})
