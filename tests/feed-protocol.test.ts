import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import test from 'node:test'
import {
  IncidentTracker,
  classifyIncident,
  collectFeedUpdates,
  decodeCbor,
  decodeFeedFrame,
  type FeedIncident,
} from '../electron/feed-protocol.ts'

function encodeCbor(value: unknown): Buffer {
  if (value === false) return Buffer.from([0xf4])
  if (value === true) return Buffer.from([0xf5])
  if (value === null) return Buffer.from([0xf6])
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24) {
    return Buffer.from([value])
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    if (value < 256) return Buffer.from([0x18, value])
    if (value < 65536) {
      const buf = Buffer.alloc(3)
      buf[0] = 0x19
      buf.writeUInt16BE(value, 1)
      return buf
    }
    const buf = Buffer.alloc(5)
    buf[0] = 0x1a
    buf.writeUInt32BE(value, 1)
    return buf
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    if (text.length < 24) return Buffer.concat([Buffer.from([0x60 | text.length]), text])
    if (text.length < 256) return Buffer.concat([Buffer.from([0x78, text.length]), text])
    const header = Buffer.alloc(3)
    header[0] = 0x79
    header.writeUInt16BE(text.length, 1)
    return Buffer.concat([header, text])
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => encodeCbor(item))
    if (value.length < 24) return Buffer.concat([Buffer.from([0x80 | value.length]), ...parts])
    return Buffer.concat([Buffer.from([0x98, value.length]), ...parts])
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const parts = entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)])
    if (entries.length < 24) return Buffer.concat([Buffer.from([0xa0 | entries.length]), ...parts])
    return Buffer.concat([Buffer.from([0xb8, entries.length]), ...parts])
  }
  throw new Error(`unsupported cbor value: ${String(value)}`)
}

function withDiffusionHeader(payload: Buffer, headerLen = 4) {
  return Buffer.concat([Buffer.alloc(headerLen, 0x04), payload])
}

function incident(partial: Partial<FeedIncident> & Pick<FeedIncident, 'id' | 'type'>): FeedIncident {
  return {
    eventId: 'OB_EV41574699',
    teamType: 'HOME',
    timestamp: new Date().toISOString(),
    data: null,
    time: null,
    ...partial,
  }
}

test('decodeCbor round-trips maps, arrays and text', () => {
  const payload = { id: 'OB_EV1', score: { home: 1, away: 0 }, items: ['a', 'b'] }
  const encoded = encodeCbor(payload)
  const decoded = decodeCbor(encoded, 0)
  assert.deepEqual(decoded.value, payload)
  assert.equal(decoded.offset, encoded.length)
})

test('decodeFeedFrame skips Diffusion header and reads CBOR', () => {
  const payload = encodeCbor({
    data: [
      {
        id: 'OB_EV41574699#goal-1',
        eventId: 'OB_EV41574699',
        type: 'GOAL',
        teamType: 'HOME',
        timestamp: '2026-10-20T20:04:44.092Z',
      },
    ],
  })
  const frame = withDiffusionHeader(payload, 6)
  const decoded = decodeFeedFrame(frame.toString('base64'))
  assert.ok(decoded)
  const updates = collectFeedUpdates(decoded, '41574699')
  assert.equal(updates.incidents.length, 1)
  assert.equal(updates.incidents[0]?.type, 'GOAL')
})

test('decodeFeedFrame inflates compressed CBOR payloads', () => {
  const payload = encodeCbor({
    id: 'OB_EV41574699',
    score: { home: 2, away: 1 },
  })
  const compressed = withDiffusionHeader(deflateSync(payload), 3)
  const decoded = decodeFeedFrame(compressed)
  assert.ok(decoded)
  const updates = collectFeedUpdates(decoded, '41574699')
  assert.deepEqual(updates.score, { home: 2, away: 1 })
})

test('decodeFeedFrame returns null for garbage', () => {
  assert.equal(decodeFeedFrame(Buffer.from('not-cbor')), null)
  assert.equal(decodeFeedFrame(''), null)
})

test('collectFeedUpdates filters other games and extracts score', () => {
  const value = {
    batch: [
      {
        id: 'OB_EV41574699#1',
        eventId: 'OB_EV41574699',
        type: 'GOAL',
        teamType: 'AWAY',
      },
      {
        id: 'OB_EV111#1',
        eventId: 'OB_EV111',
        type: 'GOAL',
        teamType: 'HOME',
      },
      {
        id: 'OB_EV41574699',
        score: { home: 0, away: 1 },
        name: 'Wolves x Portsmouth',
      },
    ],
  }
  const updates = collectFeedUpdates(value, '41574699')
  assert.equal(updates.incidents.length, 1)
  assert.equal(updates.incidents[0]?.id, 'OB_EV41574699#1')
  assert.deepEqual(updates.score, { home: 0, away: 1 })
})

test('classifyIncident maps known types and VAR-like names', () => {
  assert.deepEqual(classifyIncident('GOAL'), { kind: 'goal', label: 'GOL' })
  assert.deepEqual(classifyIncident('PENALTY'), { kind: 'penalty', label: 'PÊNALTI' })
  assert.deepEqual(classifyIncident('PENALTY_MISSED'), { kind: 'penalty', label: 'PÊNALTI PERDIDO' })
  assert.deepEqual(classifyIncident('RED_CARD'), { kind: 'red', label: 'VERMELHO' })
  assert.deepEqual(classifyIncident('POSSIBLE_RED_CARD'), { kind: 'red', label: 'Possível vermelho' })
  assert.deepEqual(classifyIncident('VAR_CHECK'), { kind: 'var', label: 'VAR' })
  assert.deepEqual(classifyIncident('GOAL_DISALLOWED'), { kind: 'var', label: 'VAR' })
  assert.equal(classifyIncident('YELLOW_CARD'), null)
  assert.equal(classifyIncident('ATTACK'), null)
})

test('IncidentTracker baselines first batch without alerting', () => {
  const tracker = new IncidentTracker()
  const first = tracker.ingest({
    incidents: [incident({ id: 'a', type: 'GOAL' }), incident({ id: 'b', type: 'RED_CARD' })],
    score: { home: 1, away: 0 },
  })
  assert.deepEqual(first, [])
})

test('IncidentTracker alerts new incidents and deduplicates', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({
    incidents: [incident({ id: 'a', type: 'GOAL' })],
    score: { home: 1, away: 0 },
  })
  const alerts = tracker.ingest({
    incidents: [
      incident({ id: 'a', type: 'GOAL' }),
      incident({ id: 'b', type: 'PENALTY', teamType: 'AWAY' }),
      incident({ id: 'c', type: 'YELLOW_CARD' }),
    ],
    score: { home: 1, away: 0 },
  })
  assert.equal(alerts.length, 1)
  assert.deepEqual(alerts[0], {
    kind: 'penalty',
    team: 'away',
    label: 'PÊNALTI',
    incidentId: 'b',
  })
})

test('IncidentTracker ignores stale incidents', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: null })
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const alerts = tracker.ingest({
    incidents: [incident({ id: 'stale', type: 'GOAL', timestamp: old })],
    score: null,
  })
  assert.deepEqual(alerts, [])
})

test('IncidentTracker emits var alert when score drops', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 2, away: 1 } })
  const alerts = tracker.ingest({ incidents: [], score: { home: 1, away: 1 } })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]?.kind, 'var')
  assert.equal(alerts[0]?.label, 'Gol anulado')
})

test('IncidentTracker emits goal when score rises without incident', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } })
  const alerts = tracker.ingest({ incidents: [], score: { home: 1, away: 0 } })
  assert.equal(alerts.length, 1)
  assert.deepEqual(alerts[0], {
    kind: 'goal',
    team: 'home',
    label: 'GOL',
    incidentId: 'score-goal:home:1',
  })
})

test('IncidentTracker does not alert baseline score', () => {
  const tracker = new IncidentTracker()
  const first = tracker.ingest({ incidents: [], score: { home: 2, away: 1 } })
  assert.deepEqual(first, [])
  const second = tracker.ingest({ incidents: [], score: { home: 2, away: 1 } })
  assert.deepEqual(second, [])
})

test('IncidentTracker dedupes score rise followed by GOAL incident', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } })
  const fromScore = tracker.ingest({ incidents: [], score: { home: 0, away: 1 } })
  assert.equal(fromScore.length, 1)
  assert.equal(fromScore[0]?.kind, 'goal')
  const fromIncident = tracker.ingest({
    incidents: [incident({ id: 'goal-1', type: 'GOAL', teamType: 'AWAY' })],
    score: { home: 0, away: 1 },
  })
  assert.deepEqual(fromIncident, [])
})

test('IncidentTracker dedupes GOAL incident followed by score rise', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } })
  const fromIncident = tracker.ingest({
    incidents: [incident({ id: 'goal-1', type: 'GOAL', teamType: 'HOME' })],
    score: null,
  })
  assert.equal(fromIncident.length, 1)
  assert.equal(fromIncident[0]?.kind, 'goal')
  const fromScore = tracker.ingest({ incidents: [], score: { home: 1, away: 0 } })
  assert.deepEqual(fromScore, [])
})

test('IncidentTracker alerts two consecutive goals for the same team', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } })
  const first = tracker.ingest({ incidents: [], score: { home: 1, away: 0 } })
  const second = tracker.ingest({ incidents: [], score: { home: 2, away: 0 } })
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.equal(first[0]?.incidentId, 'score-goal:home:1')
  assert.equal(second[0]?.incidentId, 'score-goal:home:2')
})

test('IncidentTracker clamps counters after score drop VAR', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 1, away: 0 } })
  tracker.ingest({ incidents: [], score: { home: 2, away: 0 } })
  const varAlerts = tracker.ingest({ incidents: [], score: { home: 1, away: 0 } })
  assert.equal(varAlerts[0]?.kind, 'var')
  const again = tracker.ingest({ incidents: [], score: { home: 2, away: 0 } })
  assert.equal(again.length, 1)
  assert.equal(again[0]?.kind, 'goal')
  assert.equal(again[0]?.team, 'home')
})

test('IncidentTracker suppresses teamless GOAL after recent score goal', () => {
  const now = Date.now()
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } }, now)
  const fromScore = tracker.ingest({ incidents: [], score: { home: 1, away: 0 } }, now + 1000)
  assert.equal(fromScore.length, 1)
  const teamless = tracker.ingest({
    incidents: [incident({ id: 'goal-x', type: 'GOAL', teamType: null })],
    score: { home: 1, away: 0 },
  }, now + 2000)
  assert.deepEqual(teamless, [])
})

test('IncidentTracker ignores historical GOAL dump after score-only baseline', () => {
  const tracker = new IncidentTracker()
  tracker.ingest({ incidents: [], score: { home: 1, away: 1 } })
  const historical = tracker.ingest({
    incidents: [
      incident({ id: 'h1', type: 'GOAL', teamType: 'HOME' }),
      incident({ id: 'a1', type: 'GOAL', teamType: 'AWAY' }),
    ],
    score: { home: 1, away: 1 },
  })
  assert.deepEqual(historical, [])
  const live = tracker.ingest({
    incidents: [incident({ id: 'h2', type: 'GOAL', teamType: 'HOME' })],
    score: { home: 1, away: 1 },
  })
  assert.equal(live.length, 1)
  assert.equal(live[0]?.kind, 'goal')
  assert.equal(live[0]?.team, 'home')
})
