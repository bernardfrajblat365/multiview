import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareProtectedPlayback } from '../electron/protected-playback.ts'

test('falha do CDM avisa e permite continuar a inicialização', async () => {
  const errors: unknown[] = []
  const ready = await prepareProtectedPlayback(
    async () => { throw new Error('offline') },
    (error) => errors.push(error),
  )

  assert.equal(ready, false)
  assert.equal(errors.length, 1)
  assert.equal((errors[0] as Error).message, 'offline')
})

test('CDM pronto não emite aviso', async () => {
  const errors: unknown[] = []
  const ready = await prepareProtectedPlayback(async () => {}, (error) => errors.push(error))

  assert.equal(ready, true)
  assert.deepEqual(errors, [])
})

test('CDM que não fica pronto a tempo não segura a inicialização', async () => {
  const errors: unknown[] = []
  let timedOut = 0
  const ready = await prepareProtectedPlayback(
    () => new Promise(() => {}),
    (error) => errors.push(error),
    20,
    () => { timedOut += 1 },
  )

  assert.equal(ready, false)
  assert.equal(timedOut, 1)
  assert.deepEqual(errors, [])
})

test('CDM pronto antes do tempo limite não avisa', async () => {
  let timedOut = 0
  const ready = await prepareProtectedPlayback(async () => {}, () => {}, 1000, () => { timedOut += 1 })

  assert.equal(ready, true)
  assert.equal(timedOut, 0)
})
