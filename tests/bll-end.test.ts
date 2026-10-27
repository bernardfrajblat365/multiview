import assert from 'node:assert/strict'
import test from 'node:test'
import { bllEventIdOf, createBllEndTracker, parseBllSituations } from '../src/bll-end.ts'

const HOME = 'https://www.bllsport.com/'

test('bllEventIdOf lê o id do player da BLL e recusa outras origens e caminhos', () => {
  assert.equal(bllEventIdOf('https://www.bllsport.com/view/abc_123?view=clean', HOME), 'abc_123')
  assert.equal(bllEventIdOf('https://www.bllsport.com/view/abc/', HOME), 'abc')
  assert.equal(bllEventIdOf('https://outro.com/view/abc', HOME), null)
  assert.equal(bllEventIdOf('https://www.bllsport.com/evento/abc', HOME), null)
  assert.equal(bllEventIdOf('https://www.bllsport.com/view/a%20b', HOME), null)
  assert.equal(bllEventIdOf('não é url', HOME), null)
})

test('parseBllSituations guarda a situação de cada jogo válido', () => {
  const situations = parseBllSituations([
    { id: 'a', situation: 3 },
    { id: 'b', situation: 4 },
    { id: 'c', situation: 'x' },
    { id: 'd e', situation: 4 },
    null,
  ])
  assert.deepEqual([...situations], [['a', 3], ['b', 4]])
  assert.equal(parseBllSituations('nada').size, 0)
})

test('o painel fecha quando o jogo passa de ao vivo para encerrado, uma vez só', () => {
  const tracker = createBllEndTracker()
  const games = [{ panelId: 'p1', eventId: 'a' }, { panelId: 'p2', eventId: 'b' }]
  assert.deepEqual(tracker.update(games, new Map([['a', 3], ['b', 3]])), [])
  assert.deepEqual(tracker.update(games, new Map([['a', 4], ['b', 3]])), ['p1'])
  assert.deepEqual(tracker.update(games, new Map([['a', 4], ['b', 4]])), ['p2'])
  assert.deepEqual(tracker.update(games, new Map([['a', 4], ['b', 4]])), [])
})

test('jogo aberto já encerrado (nunca visto ao vivo) não fecha', () => {
  const tracker = createBllEndTracker()
  const games = [{ panelId: 'p1', eventId: 'a' }]
  assert.deepEqual(tracker.update(games, new Map([['a', 4]])), [])
  assert.deepEqual(tracker.update(games, new Map()), [])
  assert.deepEqual(tracker.update(games, new Map([['a', 4]])), [])
})

test('trocar o jogo do painel recomeça a contagem', () => {
  const tracker = createBllEndTracker()
  tracker.update([{ panelId: 'p1', eventId: 'a' }], new Map([['a', 3]]))
  assert.deepEqual(tracker.update([{ panelId: 'p1', eventId: 'b' }], new Map([['a', 4], ['b', 4]])), [])
  tracker.update([{ panelId: 'p1', eventId: 'b' }], new Map([['b', 3]]))
  assert.deepEqual(tracker.update([{ panelId: 'p1', eventId: 'b' }], new Map([['b', 4]])), ['p1'])
})

test('painel fechado e reaberto com o mesmo jogo precisa ver o jogo ao vivo de novo', () => {
  const tracker = createBllEndTracker()
  tracker.update([{ panelId: 'p1', eventId: 'a' }], new Map([['a', 3]]))
  tracker.update([], new Map([['a', 3]]))
  assert.deepEqual(tracker.update([{ panelId: 'p1', eventId: 'a' }], new Map([['a', 4]])), [])
})
