import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { FIRST_STEPS, markFirstStepsSeen, readFirstStepsSeen, shouldShowFirstSteps } from '../src/first-steps.ts'

const STORAGE_KEY = 'quadra:first-steps-seen'

type FakeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  store: Map<string, string>
}

function makeFakeStorage(): FakeStorage {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
}

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function installLocalStorage(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
}

function restoreLocalStorage() {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
  } else {
    delete (globalThis as Record<string, unknown>).localStorage
  }
}

afterEach(() => {
  restoreLocalStorage()
})

test('shouldShowFirstSteps abre na primeira instalação (guia não visto e sem versão vista)', () => {
  assert.equal(shouldShowFirstSteps(false, null), true)
})

test('shouldShowFirstSteps não abre quando o guia já foi visto', () => {
  assert.equal(shouldShowFirstSteps(true, null), false)
})

test('shouldShowFirstSteps não abre para quem já usava uma versão (lastSeenVersion preenchido)', () => {
  assert.equal(shouldShowFirstSteps(false, '1.1.9'), false)
})

test('shouldShowFirstSteps não abre quando guia visto e versão já vista', () => {
  assert.equal(shouldShowFirstSteps(true, '1.1.9'), false)
})

test('FIRST_STEPS tem exatamente 3 passos', () => {
  assert.equal(FIRST_STEPS.length, 3)
})

test('FIRST_STEPS: cada passo tem título e corpo não vazios', () => {
  for (const step of FIRST_STEPS) {
    assert.ok(step.title.trim().length > 0, 'título vazio')
    assert.ok(step.body.trim().length > 0, `corpo vazio em "${step.title}"`)
  }
})

test('FIRST_STEPS: títulos são únicos', () => {
  const titles = FIRST_STEPS.map((step) => step.title)
  assert.equal(new Set(titles).size, titles.length)
})

test('readFirstStepsSeen é false quando nada foi salvo', () => {
  installLocalStorage(makeFakeStorage())
  assert.equal(readFirstStepsSeen(), false)
})

test('markFirstStepsSeen grava "1" na chave quadra:first-steps-seen e readFirstStepsSeen passa a ser true', () => {
  const storage = makeFakeStorage()
  installLocalStorage(storage)
  markFirstStepsSeen()
  assert.equal(storage.store.get(STORAGE_KEY), '1')
  assert.equal(readFirstStepsSeen(), true)
})

test('readFirstStepsSeen é false quando getItem lança exceção', () => {
  installLocalStorage({
    getItem: () => {
      throw new Error('storage bloqueado')
    },
    setItem: () => undefined,
  })
  assert.equal(readFirstStepsSeen(), false)
})

test('markFirstStepsSeen não lança quando setItem lança exceção', () => {
  installLocalStorage({
    getItem: () => null,
    setItem: () => {
      throw new Error('storage cheio')
    },
  })
  assert.doesNotThrow(() => markFirstStepsSeen())
})

test('readFirstStepsSeen é false e markFirstStepsSeen não lança quando localStorage não existe', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
  assert.equal(readFirstStepsSeen(), false)
  assert.doesNotThrow(() => markFirstStepsSeen())
})
