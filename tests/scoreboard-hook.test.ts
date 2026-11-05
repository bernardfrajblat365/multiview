import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { drainScript, hookScript, scorerScript } from '../electron/scoreboard-hook.ts'
import { ALERT_INCIDENT_TYPES } from '../src/match-events.ts'

// The William Hill scanner injects these scripts into the scoreboard page. Here they run in a
// fake page (node:vm) with a WH.scoreboard that only records what the hook passes through.

type FakeItem = {
  id: string
  type: string
  teamType?: string
  timestamp?: string
  time?: { duration?: number; period?: string }
  data?: { PLAYER?: number }
  scorer?: { name: string }
}

type Page = {
  context: vm.Context
  /** Every list each original acceptIncident got, by module name. */
  received: Record<string, unknown[]>
  clockCalls: unknown[]
  setNow(ms: number): void
  run<T = unknown>(code: string): T
  hook(): boolean
  drain(): DrainResult
  feed(items: FakeItem[], modules?: string[]): void
}

type DrainResult = {
  hooked: boolean
  connected: boolean
  updates: number
  period: string
  endAt: number
  clock: { duration: number; at: number } | null
  lastTime: { duration: number; at: number } | null
  breakAt: number
  now: number
  queue: Array<{ id: string; type: string; teamType?: string; shirt?: number; playerName: string; time: { duration?: number } }>
  lineups: { home: Array<{ number: unknown; name: string }>; away: Array<{ number: unknown; name: string }> }
  home: string
  away: string
  score: string
}

const MODULES = ['commentaries', 'animations', 'penalties', 'statistics']
const KICKOFF = Date.parse('2026-10-23T14:00:00Z')

function makePage(options: { withScoreboard?: boolean; period?: () => unknown; bodyText?: string } = {}): Page {
  const received: Record<string, unknown[]> = {}
  const clockCalls: unknown[] = []
  const context = vm.createContext({})
  const run = <T,>(code: string) => vm.runInContext(code, context) as T
  run('globalThis.window = globalThis; globalThis.__now = 0; Date.now = () => globalThis.__now')
  context.document = {
    body: { innerText: options.bodyText ?? '' },
    querySelectorAll: () => [],
  }
  const scoreboard: Record<string, unknown> = {
    diffusion: { isConnected: true },
    scores: { setClock: (data: unknown) => { clockCalls.push(data) } },
    lineups: {
      addEvents: () => {},
      diffusionHandler: () => {},
      getPlayerName: (team: string, shirt: number) => (team === 'HOME' && shirt === 9 ? 'Frandsen, M' : ''),
    },
  }
  for (const name of MODULES) {
    received[name] = []
    const mod: Record<string, unknown> = { acceptIncident: (list: unknown) => { received[name].push(list) } }
    if (name === 'statistics') mod.getPeriod = options.period ?? (() => 'SECOND_HALF')
    scoreboard[name] = mod
  }
  if (options.withScoreboard !== false) context.WH = { scoreboard }
  const page: Page = {
    context,
    received,
    clockCalls,
    setNow: (ms) => { context.__now = ms },
    run,
    hook: () => run<boolean>(hookScript),
    // JSON round trip: plain objects of this realm, so deepEqual compares values only.
    drain: () => JSON.parse(JSON.stringify(run(drainScript))) as DrainResult,
    feed: (items, modules = ['commentaries']) => {
      // The page hands the list to the module from its own realm, as the real feed does.
      const list = run<unknown[]>(`(${JSON.stringify(items)})`)
      const S = (context.WH as { scoreboard: Record<string, { acceptIncident: (l: unknown) => void }> }).scoreboard
      for (const name of modules) S[name].acceptIncident(list)
    },
  }
  return page
}

const at = (minute: number) => new Date(KICKOFF + minute * 60_000).toISOString()

/** A full match replay: filler items (attacks, throw-ins…) with the given incidents placed at their positions. */
function matchFeed(length: number, placed: Record<number, FakeItem>): FakeItem[] {
  const fillers = ['ATTACK', 'DANGEROUS_ATTACK', 'THROW_IN', 'CORNER', 'FREE_KICK', 'GOAL_KICK', 'SHOT_OFF_TARGET']
  const items: FakeItem[] = []
  for (let i = 0; i < length; i += 1) {
    const minute = Math.floor((i / length) * 95)
    items.push(placed[i] ?? { id: `f-${i}`, type: fillers[i % fillers.length], teamType: i % 2 ? 'AWAY' : 'HOME', timestamp: at(minute), time: { duration: minute * 60 } })
  }
  return items
}

const lateGoal: FakeItem = { id: 'goal-450', type: 'GOAL', teamType: 'HOME', timestamp: at(81), time: { duration: 81 * 60 }, data: { PLAYER: 9 } }
const lateCard: FakeItem = { id: 'yellow-480', type: 'YELLOW_CARD', teamType: 'AWAY', timestamp: at(86), time: { duration: 86 * 60 } }
const earlyGoal: FakeItem = { id: 'goal-20', type: 'GOAL', teamType: 'AWAY', timestamp: at(4), time: { duration: 4 * 60 } }

test('fake feed uses only real alert types for the alerts and none for the fillers', () => {
  for (const item of [lateGoal, lateCard, earlyGoal]) assert.ok(ALERT_INCIDENT_TYPES.includes(item.type))
  for (const item of matchFeed(520, {})) assert.ok(!ALERT_INCIDENT_TYPES.includes(item.type), item.type)
})

test('hook waits for WH.scoreboard and then wraps the feed modules once', () => {
  const page = makePage({ withScoreboard: false })
  assert.equal(page.hook(), false)
  assert.equal(page.drain().hooked, false)
  const ready = makePage()
  assert.equal(ready.hook(), true)
  assert.equal(ready.hook(), true, 'a second injection is a no-op')
  ready.feed([{ id: 'x', type: 'ATTACK' }])
  assert.equal(ready.drain().updates, 1, 'a double injection would count each update twice')
})

test('incidents past position 400 of a 500+ item replay are queued, once', () => {
  const page = makePage()
  page.hook()
  // First half: the replay is still short and has one goal.
  page.feed(matchFeed(200, { 20: earlyGoal }))
  assert.deepEqual(page.drain().queue.map((item) => item.id), ['goal-20'])
  // Second half: every update resends the whole match, now 520 items, with the new goal and card after 400.
  const full = matchFeed(520, { 20: earlyGoal, 450: lateGoal, 480: lateCard })
  page.feed(full)
  const drained = page.drain()
  assert.deepEqual(drained.queue.map((item) => item.id), ['goal-450', 'yellow-480'])
  assert.equal(drained.queue[0].type, 'GOAL')
  assert.equal(drained.queue[0].teamType, 'HOME')
  assert.equal(drained.queue[0].shirt, 9)
  assert.equal(drained.queue[0].time.duration, 81 * 60)
  assert.equal(drained.queue[1].type, 'YELLOW_CARD')
  // Several more full replays (each module gets the list too) add nothing.
  for (let i = 0; i < 5; i += 1) page.feed(full, MODULES)
  assert.deepEqual(page.drain().queue, [])
})

test('replays of the whole list without a drain in between do not duplicate alerts', () => {
  const page = makePage()
  page.hook()
  const full = matchFeed(520, { 20: earlyGoal, 450: lateGoal, 480: lateCard })
  for (let i = 0; i < 10; i += 1) page.feed(full, MODULES)
  assert.deepEqual(page.drain().queue.map((item) => item.id), ['goal-20', 'goal-450', 'yellow-480'])
  assert.equal(page.run<number>('window.__quadraSeen.size'), 3, 'only alert ids are remembered')
  // A later replay with one more goal queues just that one.
  page.feed([...full, { id: 'goal-530', type: 'GOAL', teamType: 'AWAY', timestamp: at(90), time: { duration: 5400 } }])
  assert.deepEqual(page.drain().queue.map((item) => item.id), ['goal-530'])
})

test('non-alert items never reach the queue but count as feed updates for the watchdog', () => {
  const page = makePage()
  page.hook()
  page.feed(matchFeed(520, {}))
  page.feed(matchFeed(530, {}), ['commentaries', 'statistics'])
  page.feed([])
  const drained = page.drain()
  assert.deepEqual(drained.queue, [])
  assert.equal(drained.updates, 4)
  assert.equal(page.run<number>('window.__quadraSeen.size'), 0)
  // The count keeps going across drains (the scanner compares it with the last one it saw).
  page.feed(matchFeed(10, {}))
  assert.equal(page.drain().updates, 5)
})

test('the page still gets every update, unchanged, even when the hook cannot read it', () => {
  const page = makePage()
  page.hook()
  const full = matchFeed(520, { 450: lateGoal })
  page.feed(full, MODULES)
  for (const name of MODULES) {
    assert.equal(page.received[name].length, 1)
    assert.equal((page.received[name][0] as unknown[]).length, 520)
  }
  const S = (page.context.WH as { scoreboard: { commentaries: { acceptIncident: (l: unknown) => void } } }).scoreboard
  S.commentaries.acceptIncident('not a list')
  S.commentaries.acceptIncident(page.run('[null, 7, { id: "g", type: "GOAL", get data() { throw new Error("bad") } }]'))
  assert.equal(page.received.commentaries.length, 3)
  assert.equal(page.received.commentaries[1], 'not a list')
  assert.equal(page.drain().updates, MODULES.length + 2)
})

test('clock: setClock readings keep their time; without ticks the reading goes stale', () => {
  const page = makePage()
  page.hook()
  const S = (page.context.WH as { scoreboard: { scores: { setClock: (d: unknown) => void } } }).scoreboard
  page.setNow(KICKOFF + 1000)
  S.scores.setClock({ currentTime: { period: 'SECOND_HALF', duration: 3000 } })
  page.setNow(KICKOFF + 2000)
  S.scores.setClock({ currentTime: { period: 'SECOND_HALF', duration: 3001 } })
  assert.deepEqual(page.drain().clock, { duration: 3001, at: KICKOFF + 2000 })
  // Bad readings are passed on to the page but don't replace the last good one.
  S.scores.setClock({ currentTime: { duration: 'x' } })
  S.scores.setClock(null)
  assert.equal(page.clockCalls.length, 4)
  // No tick for 3.5 s: the drain still reports the old reading and its time, so the scanner sees it stopped.
  page.setNow(KICKOFF + 5500)
  const stale = page.drain()
  assert.deepEqual(stale.clock, { duration: 3001, at: KICKOFF + 2000 })
  assert.ok(stale.now - (stale.clock?.at ?? 0) > 3000)
})

test('match time of the newest item and the half-time whistle', () => {
  const page = makePage()
  page.hook()
  page.feed([
    { id: 'a', type: 'ATTACK', timestamp: at(40), time: { duration: 2400 } },
    { id: 'ht', type: 'HALF_TIME', timestamp: at(47), time: { duration: 2700 } },
    { id: 'b', type: 'ATTACK', timestamp: at(30), time: { duration: 1800 } },
    { id: 'st', type: 'STOP_1_ST_HALF', timestamp: at(46), time: { duration: 2700 } },
    { id: 'c', type: 'ATTACK', timestamp: 'not a date', time: { duration: 9999 } },
  ])
  const drained = page.drain()
  assert.deepEqual(drained.lastTime, { duration: 2700, at: Date.parse(at(47)) }, 'newest by timestamp, not by position')
  assert.equal(drained.breakAt, Date.parse(at(46)), 'earliest whistle wins')
  // A later replay with an item marked as half-time period doesn't move the whistle forward.
  page.feed([{ id: 'd', type: 'ATTACK', timestamp: at(50), time: { duration: 2700, period: 'HALF_TIME' } }])
  assert.equal(page.drain().breakAt, Date.parse(at(46)))
})

test('period from the page and end of match', () => {
  let period: unknown = 'GAME_FINISHED'
  const page = makePage({ period: () => period })
  page.hook()
  assert.equal(page.drain().period, 'GAME_FINISHED')
  period = 'game finished'
  assert.equal(page.drain().period, '', 'only the feed\'s own constant names pass')
  period = 'X'.repeat(41)
  assert.equal(page.drain().period, '')
  period = undefined
  assert.equal(page.drain().period, '')
  const throwing = makePage({ period: () => { throw new Error('not ready') } })
  throwing.hook()
  assert.equal(throwing.drain().period, '')

  assert.equal(page.drain().endAt, 0)
  page.feed([{ id: 'end', type: 'END_OF_MATCH', timestamp: at(95) }])
  assert.equal(page.drain().endAt, Date.parse(at(95)))
  // The first END_OF_MATCH stays (a later one may come after extra time is announced).
  page.feed([{ id: 'end2', type: 'END_OF_MATCH', timestamp: at(125) }])
  assert.equal(page.drain().endAt, Date.parse(at(95)))
  const noDate = makePage()
  noDate.hook()
  noDate.setNow(KICKOFF + 99_000)
  noDate.feed([{ id: 'end', type: 'END_OF_MATCH' }])
  assert.equal(noDate.drain().endAt, KICKOFF + 99_000, 'without a timestamp the time it arrived is used')
})

test('scorer: name in the item, shirt from a later replay, and the line-up goal list', () => {
  const page = makePage()
  page.hook()
  page.feed([
    { id: 'g1', type: 'GOAL', teamType: 'HOME', timestamp: at(10), scorer: { name: 'Fulano de Tal' } },
    { id: 'g2', type: 'GOAL', teamType: 'HOME', timestamp: at(20) },
    { id: 'g3', type: 'GOAL', teamType: 'AWAY', timestamp: at(30) },
  ])
  const queue = page.drain().queue
  assert.equal(queue[0].playerName, 'Fulano de Tal')
  assert.equal(queue[1].playerName, '')
  assert.equal(queue[1].shirt, undefined)
  // The shirt number only arrives on a later replay of the same goal; the goal isn't queued again.
  page.feed([{ id: 'g2', type: 'GOAL', teamType: 'HOME', timestamp: at(20), data: { PLAYER: 9 } }])
  assert.deepEqual(page.drain().queue, [])
  // The line-up goal list names g3.
  const S = (page.context.WH as { scoreboard: { lineups: { addEvents: (t: string, e: unknown) => void } } }).scoreboard
  S.lineups.addEvents('goals', page.run('[{ incidentId: "g3", scorer: { name: "Ciclano" } }, { incidentId: "g9" }]'))
  S.lineups.addEvents('cards', page.run('[{ incidentId: "g1", player: { name: "Cartão" } }]'))
  const names = JSON.parse(JSON.stringify(page.run(scorerScript([
    { id: 'g2', team: 'HOME', shirt: 0 },
    { id: 'g3', team: 'AWAY', shirt: 0 },
    { id: 'g1', team: 'HOME', shirt: 0 },
    { id: 'g4', team: 'HOME', shirt: 7 },
  ]))))
  assert.deepEqual(names, { g2: 'Frandsen, M', g3: 'Ciclano' })
})

test('line-up from the page handler and score from the board text', () => {
  const page = makePage({ bodyText: 'Hobro\n  2 - 1  \nVendsyssel\n' })
  page.hook()
  const S = (page.context.WH as { scoreboard: { lineups: { diffusionHandler: (t: string, p: unknown) => void } } }).scoreboard
  S.lineups.diffusionHandler('home', page.run('[{ number: 1, name: "Goleiro" }, { number: 9, name: "Frandsen, M" }]'))
  S.lineups.diffusionHandler('AWAY', page.run('[]'))
  const drained = page.drain()
  assert.deepEqual(drained.lineups.home, [{ number: 1, name: 'Goleiro' }, { number: 9, name: 'Frandsen, M' }])
  assert.deepEqual(drained.lineups.away, [])
  assert.equal(drained.home, 'Hobro')
  assert.equal(drained.away, 'Vendsyssel')
  assert.equal(drained.score, '2 - 1')
  assert.equal(drained.connected, true)
})
