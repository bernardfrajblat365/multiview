import assert from 'node:assert/strict'
import test from 'node:test'
import { LIVE_DELAY_OPTIONS } from '../src/alert-settings.ts'
import {
  clampPipBar,
  defaultPipBounds,
  isValidPipState,
  parsePipCommand,
  PIP_BAR_MAX,
  PIP_BAR_MIN,
  PIP_FRAME,
  PIP_MIN_WIDTH,
  pipViewBounds,
  pipWindowSize,
} from '../src/pip.ts'

// Mirrors PIP_MARGIN and PIP_GAP in src/pip.ts (not exported).
const PIP_MARGIN = 24
const PIP_GAP = 12

test('parsePipCommand accepts every simple command', () => {
  for (const type of ['mute', 'alerts', 'reload', 'bllsport', 'youtube', 'zapping', 'keep-open', 'return']) {
    assert.deepEqual(parsePipCommand({ type }), { type })
  }
})

test('parsePipCommand accepts delay default and every LIVE_DELAY_OPTIONS value', () => {
  assert.deepEqual(parsePipCommand({ type: 'delay', value: 'default' }), { type: 'delay', value: 'default' })
  for (const value of LIVE_DELAY_OPTIONS) {
    assert.deepEqual(parsePipCommand({ type: 'delay', value }), { type: 'delay', value })
  }
})

test('parsePipCommand rejects delay values outside the options', () => {
  assert.equal(parsePipCommand({ type: 'delay', value: 15 }), null)
  assert.equal(parsePipCommand({ type: 'delay', value: '30' }), null)
  assert.equal(parsePipCommand({ type: 'delay' }), null)
})

test('parsePipCommand accepts a url up to 4096 characters', () => {
  const url = 'https://a.example/' + 'x'.repeat(4096 - 'https://a.example/'.length)
  assert.equal(url.length, 4096)
  assert.deepEqual(parsePipCommand({ type: 'url', url }), { type: 'url', url })
})

test('parsePipCommand rejects a url over 4096 characters or not a string', () => {
  assert.equal(parsePipCommand({ type: 'url', url: 'x'.repeat(4097) }), null)
  assert.equal(parsePipCommand({ type: 'url', url: 123 }), null)
  assert.equal(parsePipCommand({ type: 'url' }), null)
})

test('parsePipCommand accepts choose-match with null or a positive safe integer', () => {
  assert.deepEqual(parsePipCommand({ type: 'choose-match', gameId: null }), { type: 'choose-match', gameId: null })
  assert.deepEqual(parsePipCommand({ type: 'choose-match', gameId: 5 }), { type: 'choose-match', gameId: 5 })
  assert.deepEqual(parsePipCommand({ type: 'choose-match', gameId: Number.MAX_SAFE_INTEGER }), {
    type: 'choose-match',
    gameId: Number.MAX_SAFE_INTEGER,
  })
})

test('parsePipCommand rejects choose-match with 0, negative, fractional, unsafe or string ids', () => {
  for (const gameId of [0, -1, 1.5, '3', 2 ** 53, undefined]) {
    assert.equal(parsePipCommand({ type: 'choose-match', gameId }), null, `gameId ${String(gameId)}`)
  }
})

test('parsePipCommand rejects unknown types, null and strings', () => {
  assert.equal(parsePipCommand({ type: 'unknown' }), null)
  assert.equal(parsePipCommand({ type: 42 }), null)
  assert.equal(parsePipCommand({}), null)
  assert.equal(parsePipCommand(null), null)
  assert.equal(parsePipCommand(undefined), null)
  assert.equal(parsePipCommand('mute'), null)
})

test('isValidPipState accepts a state for the matching panel', () => {
  assert.equal(isValidPipState({ panelId: 'p1', title: 'x' }, 'p1'), true)
})

test('isValidPipState rejects another panel, a null panel id and non-objects', () => {
  assert.equal(isValidPipState({ panelId: 'p2' }, 'p1'), false)
  assert.equal(isValidPipState({ panelId: 'p1' }, null), false)
  assert.equal(isValidPipState(null, 'p1'), false)
  assert.equal(isValidPipState('p1', 'p1'), false)
})

test('isValidPipState rejects a state over 64 KB and one that cannot be serialized', () => {
  assert.equal(isValidPipState({ panelId: 'p1', blob: 'x'.repeat(70 * 1024) }, 'p1'), false)
  const circular: Record<string, unknown> = { panelId: 'p1' }
  circular.self = circular
  assert.equal(isValidPipState(circular, 'p1'), false)
})

test('clampPipBar clamps to the min and max and rounds', () => {
  assert.equal(clampPipBar(10), PIP_BAR_MIN)
  assert.equal(clampPipBar(200), PIP_BAR_MAX)
  assert.equal(clampPipBar(50.4), 50)
  assert.equal(clampPipBar(50.5), 51)
})

test('pipViewBounds places the view under the bar inside the frame', () => {
  const size = pipWindowSize(480, 32)
  assert.deepEqual(size, { width: 486, height: 305 })
  assert.deepEqual(pipViewBounds(size, 32), { x: PIP_FRAME, y: 32, width: 480, height: 270 })
})

test('pipViewBounds uses the clamped bar height', () => {
  const size = { width: 486, height: 305 }
  assert.deepEqual(pipViewBounds(size, 5), { x: PIP_FRAME, y: PIP_BAR_MIN, width: 480, height: 305 - PIP_BAR_MIN - PIP_FRAME })
})

test('pipViewBounds never returns a width or height below 1', () => {
  const bounds = pipViewBounds({ width: 2, height: 2 }, 28)
  assert.equal(bounds.width, 1)
  assert.equal(bounds.height, 1)
})

test('pipWindowSize gives a 16:9 video under the clamped bar', () => {
  assert.deepEqual(pipWindowSize(480, 32), { width: 486, height: 270 + 32 + PIP_FRAME })
  assert.deepEqual(pipWindowSize(480, 10), { width: 486, height: 270 + PIP_BAR_MIN + PIP_FRAME })
})

test('defaultPipBounds sits in the bottom-right of a 1920x1080 work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const bounds = defaultPipBounds(workArea)
  assert.deepEqual(bounds, { x: 1410, y: 751, width: 486, height: 305 })
  assert.equal(bounds.x + bounds.width, 1920 - PIP_MARGIN)
  assert.equal(bounds.y + bounds.height, 1080 - PIP_MARGIN)
})

test('defaultPipBounds fits a small 1024x768 work area with the same margin', () => {
  const workArea = { x: 0, y: 0, width: 1024, height: 768 }
  const bounds = defaultPipBounds(workArea)
  assert.deepEqual(bounds, { x: 514, y: 439, width: 486, height: 305 })
  assert.ok(bounds.width <= workArea.width / 2)
  assert.equal(bounds.x + bounds.width, 1024 - PIP_MARGIN)
  assert.equal(bounds.y + bounds.height, 768 - PIP_MARGIN)
})

test('defaultPipBounds stays inside work areas with an offset origin', () => {
  const workArea = { x: 1920, y: 40, width: 1366, height: 728 }
  const bounds = defaultPipBounds(workArea)
  assert.ok(bounds.x >= workArea.x)
  assert.ok(bounds.y >= workArea.y)
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width)
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height)
  assert.equal(bounds.x + bounds.width, workArea.x + workArea.width - PIP_MARGIN)
  assert.equal(bounds.y + bounds.height, workArea.y + workArea.height - PIP_MARGIN)
})

test('defaultPipBounds is never wider than half the work area unless at the minimum width', () => {
  const areas = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 1024, height: 768 },
    { x: 0, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: 400, height: 300 },
  ]
  for (const workArea of areas) {
    const bounds = defaultPipBounds(workArea)
    const atMinimum = bounds.width === pipWindowSize(PIP_MIN_WIDTH, PIP_BAR_MIN + 4).width
    assert.ok(
      bounds.width <= workArea.width / 2 || atMinimum,
      `width ${bounds.width} in ${workArea.width}x${workArea.height}`,
    )
  }
})

test('defaultPipBounds shrinks to the minimum width for a tiny work area', () => {
  const bounds = defaultPipBounds({ x: 0, y: 0, width: 400, height: 300 })
  assert.deepEqual(bounds, { x: 50, y: 61, width: 326, height: 215 })
})

test('defaultPipBounds slot 0 is the default position', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.deepEqual(defaultPipBounds(workArea, PIP_BAR_MIN + 4, 0), defaultPipBounds(workArea))
})

test('defaultPipBounds slot 1 keeps the x and sits above slot 0 by height plus the gap', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const first = defaultPipBounds(workArea, PIP_BAR_MIN + 4, 0)
  const second = defaultPipBounds(workArea, PIP_BAR_MIN + 4, 1)
  assert.equal(second.x, first.x)
  assert.equal(second.width, first.width)
  assert.equal(second.height, first.height)
  assert.equal(first.y - second.y, first.height + PIP_GAP)
})

test('defaultPipBounds slots 0 to 5 in a 1920x1080 work area never overlap and stay inside it', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const bounds = Array.from({ length: 6 }, (_, slot) => defaultPipBounds(workArea, PIP_BAR_MIN + 4, slot))
  for (const b of bounds) {
    assert.ok(b.x >= workArea.x && b.y >= workArea.y, JSON.stringify(b))
    assert.ok(b.x + b.width <= workArea.x + workArea.width, JSON.stringify(b))
    assert.ok(b.y + b.height <= workArea.y + workArea.height, JSON.stringify(b))
  }
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]
      const c = bounds[j]
      const overlap = a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height
      assert.equal(overlap, false, `slots ${i} and ${j} overlap`)
    }
  }
})

test('defaultPipBounds moves slots that do not fit a row to the left column in a 1024x400 work area', () => {
  const workArea = { x: 0, y: 0, width: 1024, height: 400 }
  const first = defaultPipBounds(workArea, PIP_BAR_MIN + 4, 0)
  const second = defaultPipBounds(workArea, PIP_BAR_MIN + 4, 1)
  const third = defaultPipBounds(workArea, PIP_BAR_MIN + 4, 2)
  assert.equal(second.y, first.y)
  assert.ok(second.x < first.x, `second.x ${second.x} vs first.x ${first.x}`)
  assert.ok(third.x < second.x, `third.x ${third.x} vs second.x ${second.x}`)
  // The third column does not fit to the left, so x is clamped to the work area's left edge.
  assert.equal(third.x, workArea.x)
  for (const b of [first, second, third]) assert.ok(b.x >= workArea.x)
})
