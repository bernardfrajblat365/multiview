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
