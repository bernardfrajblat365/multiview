import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWheelZoomGate,
  nextZoomLevel,
  WHEEL_ZOOM_GAP_MS,
  ZOOM_LIMIT,
  ZOOM_STEP,
  zoomCommandOf,
} from '../electron/ui-zoom.ts'

type ZoomInput = Parameters<typeof zoomCommandOf>[0]

function keyDown(key: string, code: string, modifiers: Partial<Pick<ZoomInput, 'control' | 'alt' | 'meta'>> = {}): ZoomInput {
  return {
    type: 'keyDown',
    key,
    code,
    control: true,
    alt: false,
    meta: false,
    ...modifiers,
  } as ZoomInput
}

test('Ctrl + plus, equals and NumpadAdd zoom in', () => {
  assert.equal(zoomCommandOf(keyDown('+', 'Equal')), 'in')
  assert.equal(zoomCommandOf(keyDown('=', 'Equal')), 'in')
  assert.equal(zoomCommandOf(keyDown('+', 'NumpadAdd')), 'in')
  assert.equal(zoomCommandOf(keyDown('Add', 'NumpadAdd')), 'in')
})

test('Ctrl + minus, underscore and NumpadSubtract zoom out', () => {
  assert.equal(zoomCommandOf(keyDown('-', 'Minus')), 'out')
  assert.equal(zoomCommandOf(keyDown('_', 'Minus')), 'out')
  assert.equal(zoomCommandOf(keyDown('-', 'NumpadSubtract')), 'out')
})

test('Ctrl + 0 and Numpad0 reset the zoom', () => {
  assert.equal(zoomCommandOf(keyDown('0', 'Digit0')), 'reset')
  assert.equal(zoomCommandOf(keyDown('0', 'Numpad0')), 'reset')
})

test('no zoom command without Ctrl', () => {
  const noCtrl = (key: string, code: string) => ({ ...keyDown(key, code), control: false }) as ZoomInput
  assert.equal(zoomCommandOf(noCtrl('+', 'Equal')), null)
  assert.equal(zoomCommandOf(noCtrl('-', 'Minus')), null)
  assert.equal(zoomCommandOf(noCtrl('0', 'Digit0')), null)
})

test('no zoom command with Alt or Meta held', () => {
  assert.equal(zoomCommandOf(keyDown('+', 'Equal', { alt: true })), null)
  assert.equal(zoomCommandOf(keyDown('-', 'Minus', { alt: true })), null)
  assert.equal(zoomCommandOf(keyDown('0', 'Digit0', { meta: true })), null)
  assert.equal(zoomCommandOf(keyDown('+', 'NumpadAdd', { meta: true })), null)
})

test('no zoom command for keyUp or char events', () => {
  const withType = (type: string) => ({ ...keyDown('+', 'Equal'), type }) as ZoomInput
  assert.equal(zoomCommandOf(withType('keyUp')), null)
  assert.equal(zoomCommandOf(withType('char')), null)
})

test('no zoom command for other keys', () => {
  assert.equal(zoomCommandOf(keyDown('a', 'KeyA')), null)
  assert.equal(zoomCommandOf(keyDown('F5', 'F5')), null)
  assert.equal(zoomCommandOf(keyDown('1', 'Digit1')), null)
  assert.equal(zoomCommandOf(keyDown('Numpad1', 'Numpad1')), null)
})

test('nextZoomLevel steps by ZOOM_STEP', () => {
  assert.equal(nextZoomLevel(0, 'in'), ZOOM_STEP)
  assert.equal(nextZoomLevel(0, 'out'), -ZOOM_STEP)
  assert.equal(nextZoomLevel(ZOOM_STEP, 'in'), ZOOM_STEP * 2)
  assert.equal(nextZoomLevel(ZOOM_STEP * 2, 'out'), ZOOM_STEP)
})

test('nextZoomLevel clamps at +ZOOM_LIMIT and -ZOOM_LIMIT', () => {
  assert.equal(nextZoomLevel(ZOOM_LIMIT, 'in'), ZOOM_LIMIT)
  assert.equal(nextZoomLevel(ZOOM_LIMIT - ZOOM_STEP / 2, 'in'), ZOOM_LIMIT)
  assert.equal(nextZoomLevel(-ZOOM_LIMIT, 'out'), -ZOOM_LIMIT)
  assert.equal(nextZoomLevel(-ZOOM_LIMIT + ZOOM_STEP / 2, 'out'), -ZOOM_LIMIT)
})

test('nextZoomLevel reset returns 0 from any level', () => {
  assert.equal(nextZoomLevel(ZOOM_LIMIT, 'reset'), 0)
  assert.equal(nextZoomLevel(-ZOOM_LIMIT, 'reset'), 0)
  assert.equal(nextZoomLevel(ZOOM_STEP, 'reset'), 0)
})

test('nextZoomLevel treats a non-finite current level as 0', () => {
  assert.equal(nextZoomLevel(Number.NaN, 'in'), ZOOM_STEP)
  assert.equal(nextZoomLevel(Number.NaN, 'out'), -ZOOM_STEP)
  assert.equal(nextZoomLevel(Number.POSITIVE_INFINITY, 'in'), ZOOM_STEP)
  assert.equal(nextZoomLevel(Number.NEGATIVE_INFINITY, 'out'), -ZOOM_STEP)
})

function fakeClock(start = 0) {
  const clock = { t: start }
  return { clock, now: () => clock.t }
}

test('wheel zoom gate accepts the first call', () => {
  const { now } = fakeClock(0)
  const gate = createWheelZoomGate(30, now)
  assert.equal(gate(), true)
})

test('wheel zoom gate rejects a duplicate at the same time and at gap - 1', () => {
  const { clock, now } = fakeClock(0)
  const gate = createWheelZoomGate(30, now)
  assert.equal(gate(), true)
  assert.equal(gate(), false)
  clock.t = 29
  assert.equal(gate(), false)
})

test('wheel zoom gate accepts a call at exactly the gap', () => {
  const { clock, now } = fakeClock(0)
  const gate = createWheelZoomGate(30, now)
  assert.equal(gate(), true)
  clock.t = 30
  assert.equal(gate(), true)
})

test('wheel zoom gate rejected calls do not extend the window', () => {
  const { clock, now } = fakeClock(0)
  const gate = createWheelZoomGate(30, now)
  assert.equal(gate(), true)
  clock.t = 20
  assert.equal(gate(), false)
  clock.t = 30
  assert.equal(gate(), true)
})

test('wheel zoom gate honours a custom gap', () => {
  const { clock, now } = fakeClock(0)
  const gate = createWheelZoomGate(100, now)
  assert.equal(gate(), true)
  clock.t = 99
  assert.equal(gate(), false)
  clock.t = 100
  assert.equal(gate(), true)
})

test('wheel zoom gate default gap equals WHEEL_ZOOM_GAP_MS', () => {
  const { clock, now } = fakeClock(0)
  const gate = createWheelZoomGate(undefined, now)
  assert.equal(gate(), true)
  clock.t = WHEEL_ZOOM_GAP_MS - 1
  assert.equal(gate(), false)
  clock.t = WHEEL_ZOOM_GAP_MS
  assert.equal(gate(), true)
})
