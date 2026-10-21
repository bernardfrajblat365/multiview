import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  ALERT_SOUNDS,
  DEFAULT_ALERT_SOUND_ID,
  alertSoundGroups,
  getAlertSoundId,
  getAlertSoundOption,
  normalizeAlertSoundId,
  setAlertSoundId,
} from '../src/alert-sounds.ts'

const memory = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.has(key) ? memory.get(key)! : null
    },
    setItem(key: string, value: string) {
      memory.set(key, String(value))
    },
    removeItem(key: string) {
      memory.delete(key)
    },
  },
})

afterEach(() => {
  memory.clear()
  setAlertSoundId(DEFAULT_ALERT_SOUND_ID)
})

describe('alert-sounds catalog', () => {
  it('exposes 30 unique sound ids from 1 to 30', () => {
    assert.equal(ALERT_SOUNDS.length, 30)
    const ids = ALERT_SOUNDS.map((sound) => sound.id)
    assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => index + 1))
  })

  it('groups sounds into classic, modern and siren', () => {
    const groups = alertSoundGroups()
    assert.deepEqual(
      groups.map((group) => group.group),
      ['classic', 'modern', 'siren'],
    )
    assert.equal(groups[0]?.options.length, 10)
    assert.equal(groups[1]?.options.length, 10)
    assert.equal(groups[2]?.options.length, 10)
  })

  it('normalizes invalid ids to the default sound', () => {
    assert.equal(normalizeAlertSoundId(null), DEFAULT_ALERT_SOUND_ID)
    assert.equal(normalizeAlertSoundId('nope'), DEFAULT_ALERT_SOUND_ID)
    assert.equal(normalizeAlertSoundId(0), DEFAULT_ALERT_SOUND_ID)
    assert.equal(normalizeAlertSoundId(31), DEFAULT_ALERT_SOUND_ID)
    assert.equal(normalizeAlertSoundId(14), 14)
  })

  it('persists the selected sound id', () => {
    assert.equal(setAlertSoundId(23), 23)
    assert.equal(getAlertSoundId(), 23)
    assert.equal(getAlertSoundOption().name, 'Dois tons (Europa)')
    assert.equal(memory.get('quadra.alertSoundId'), '23')
  })
})
