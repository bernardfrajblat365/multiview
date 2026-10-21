import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  IncidentTracker,
  collectFeedUpdates,
  decodeFeedFrame,
  type FeedIncident,
  type FeedScore,
  type FeedUpdates,
} from '../electron/feed-protocol.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feed-frames')

type SavedFrames = {
  capturedAt: string
  sourceUrl: string
  frames: Array<{ t: number; size: number; data: string }>
}

function loadFixture(eventId: string): SavedFrames | null {
  const path = join(fixturesDir, `${eventId}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as SavedFrames
}

function collectAllUpdates(fixture: SavedFrames, eventId: string): FeedUpdates[] {
  const updates: FeedUpdates[] = []
  for (const frame of fixture.frames) {
    const decoded = decodeFeedFrame(frame.data)
    if (!decoded) continue
    const next = collectFeedUpdates(decoded, eventId)
    if (!next.incidents.length && !next.score) continue
    updates.push(next)
  }
  return updates
}

function uniqueGoals(updates: FeedUpdates[]) {
  const goals: FeedIncident[] = []
  const seen = new Set<string>()
  for (const batch of updates) {
    for (const incident of batch.incidents) {
      if (incident.type.toUpperCase() !== 'GOAL') continue
      if (seen.has(incident.id)) continue
      seen.add(incident.id)
      goals.push(incident)
    }
  }
  return goals
}

function lastScore(updates: FeedUpdates[]): FeedScore | null {
  let score: FeedScore | null = null
  for (const batch of updates) {
    if (batch.score) score = batch.score
  }
  return score
}

function replayLiveGoals(eventId: string, goals: FeedIncident[], finalScore: FeedScore | null) {
  const tracker = new IncidentTracker()
  // Historical capture: treat empty as baseline, then replay goals + score progression as live.
  tracker.ingest({ incidents: [], score: { home: 0, away: 0 } })
  const alerts: Array<{ kind: string; team: string | null }> = []
  let home = 0
  let away = 0
  for (const goal of goals) {
    const team = (goal.teamType || '').toUpperCase() === 'AWAY' ? 'away' : 'home'
    if (team === 'home') home += 1
    else away += 1
    const fromIncident = tracker.ingest({
      incidents: [{ ...goal, timestamp: new Date().toISOString() }],
      score: null,
    })
    alerts.push(...fromIncident.map((alert) => ({ kind: alert.kind, team: alert.team })))
    const fromScore = tracker.ingest({
      incidents: [],
      score: { home, away },
    })
    alerts.push(...fromScore.map((alert) => ({ kind: alert.kind, team: alert.team })))
  }
  if (finalScore) {
    const trailing = tracker.ingest({ incidents: [], score: finalScore })
    alerts.push(...trailing.map((alert) => ({ kind: alert.kind, team: alert.team })))
  }
  return alerts.filter((alert) => alert.kind === 'goal')
}

function assertFixture(eventId: string, expectedGoals: number, expectedScore: FeedScore) {
  const fixture = loadFixture(eventId)
  assert.ok(fixture, `missing fixture tests/fixtures/feed-frames/${eventId}.json`)
  assert.ok(fixture.frames.length > 0, `${eventId}: expected captured frames`)

  const updates = collectAllUpdates(fixture, eventId)
  assert.ok(updates.length > 0, `${eventId}: decoder produced no updates`)

  const score = lastScore(updates)
  assert.deepEqual(score, expectedScore, `${eventId}: final score`)

  const goals = uniqueGoals(updates)
  assert.equal(goals.length, expectedGoals, `${eventId}: unique GOAL incidents`)

  const liveAlerts = replayLiveGoals(eventId, goals, score)
  assert.equal(liveAlerts.length, expectedGoals, `${eventId}: one GOL alert per goal`)
  for (let index = 0; index < goals.length; index += 1) {
    const expectedTeam =
      (goals[index]?.teamType || '').toUpperCase() === 'AWAY'
        ? 'away'
        : (goals[index]?.teamType || '').toUpperCase() === 'HOME'
          ? 'home'
          : null
    if (expectedTeam) assert.equal(liveAlerts[index]?.team, expectedTeam)
  }
}

test('feed replay 41540164 decodes score and goals', () => {
  assertFixture('41540164', 1, { home: 1, away: 0 })
})

test('feed replay 41540167 decodes score and goals', () => {
  assertFixture('41540167', 2, { home: 1, away: 1 })
})
