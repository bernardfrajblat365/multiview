import assert from 'node:assert/strict'
import test from 'node:test'

type FakeNode = { kind: string; connectedTo: unknown[]; started: boolean; stopped: boolean; offset: { value: number } }

const created: FakeNode[] = []
class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = { kind: 'destination' }
  private node(kind: string): FakeNode & Record<string, unknown> {
    const node = {
      kind,
      connectedTo: [] as unknown[],
      started: false,
      stopped: false,
      offset: { value: 1 },
      type: 'sine',
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect(target: unknown) { node.connectedTo.push(target); return target },
      disconnect() { node.connectedTo = [] },
      start() { node.started = true },
      stop() { node.stopped = true },
    }
    created.push(node)
    return node
  }
  createConstantSource() { return this.node('constant') }
  createOscillator() { return this.node('oscillator') }
  createGain() { return this.node('gain') }
  resume() { return Promise.resolve() }
}
;(globalThis as unknown as { window: unknown }).window = { AudioContext: FakeAudioContext }

const { KEEP_AWAKE_LEVEL, playAlertSound, setAlertAudioAwake } = await import('../src/alert-sounds.ts')
const constants = () => created.filter((node) => node.kind === 'constant')

test('keep-alive opens one quiet, non-silent stream to the output', () => {
  setAlertAudioAwake(true)
  setAlertAudioAwake(true)
  assert.equal(constants().length, 1)
  const [source] = constants()
  assert.ok(source.started)
  assert.ok(source.offset.value > 0 && source.offset.value <= KEEP_AWAKE_LEVEL)
  assert.deepEqual(source.connectedTo, [{ kind: 'destination' }])
})

test('keep-alive stops when no game can alert, and restarts later', () => {
  setAlertAudioAwake(false)
  assert.ok(constants()[0].stopped)
  assert.deepEqual(constants()[0].connectedTo, [])
  setAlertAudioAwake(false)
  setAlertAudioAwake(true)
  assert.equal(constants().length, 2)
  assert.ok(constants()[1].started && !constants()[1].stopped)
  setAlertAudioAwake(false)
})

test('alerts still play on the shared context', () => {
  assert.equal(playAlertSound('apito-arbitro', { force: true }), true)
  assert.ok(created.some((node) => node.kind === 'oscillator' && node.started))
})
