import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BLL_PROFILE_NAME,
  MAX_BLL_PROFILES,
  addBllProfile,
  createDefaultState,
  deleteBllProfile,
  parseBllProfilesState,
  partitionOf,
  sanitizeProfileName,
  switchBllProfile,
} from '../electron/bll-profiles.ts'

test('sanitizeProfileName limpa espaços e limita tamanho', () => {
  assert.equal(sanitizeProfileName('  Casa  '), 'Casa')
  assert.equal(sanitizeProfileName('a'.repeat(50))?.length, 40)
  assert.equal(sanitizeProfileName('   '), null)
  assert.equal(sanitizeProfileName(1), null)
})

test('createDefaultState cria Principal com id e partição estável', () => {
  const state = createDefaultState()
  assert.equal(state.profiles.length, 1)
  assert.equal(state.profiles[0].name, DEFAULT_BLL_PROFILE_NAME)
  assert.equal(state.activeId, state.profiles[0].id)
  assert.match(partitionOf(state.activeId), /^persist:quadra-bll-[a-z0-9]+$/)
})

test('parseBllProfilesState rejeita lixo e aceita lista válida', () => {
  assert.equal(parseBllProfilesState(null), null)
  assert.equal(parseBllProfilesState({ activeId: 'x', profiles: [] }), null)
  const parsed = parseBllProfilesState({
    activeId: 'abcd1234',
    profiles: [
      { id: 'abcd1234', name: 'João' },
      { id: 'efgh5678', name: 'Maria' },
      { id: 'bad', name: 'curto' },
      { id: 'abcd1234', name: 'dup' },
    ],
  })
  assert.ok(parsed)
  assert.equal(parsed.profiles.length, 2)
  assert.equal(parsed.activeId, 'abcd1234')
})

test('parseBllProfilesState cai no primeiro perfil se activeId sumiu', () => {
  const parsed = parseBllProfilesState({
    activeId: 'missing',
    profiles: [{ id: 'abcd1234', name: 'Só' }],
  })
  assert.equal(parsed?.activeId, 'abcd1234')
})

test('addBllProfile adiciona, ativa a nova e respeita o teto', () => {
  let state = createDefaultState()
  const first = addBllProfile(state, 'Trabalho')
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.state.profiles.length, 2)
  assert.equal(first.state.activeId, first.id)
  state = first.state
  for (let index = state.profiles.length; index < MAX_BLL_PROFILES; index += 1) {
    const next = addBllProfile(state, `Conta ${index}`)
    assert.equal(next.ok, true)
    if (!next.ok) return
    state = next.state
  }
  assert.equal(addBllProfile(state, 'Extra').ok, false)
  assert.equal(addBllProfile(state, '  ').ok, false)
})

test('switchBllProfile troca a ativa e rejeita id inexistente', () => {
  let state = createDefaultState()
  const added = addBllProfile(state, 'B')
  assert.ok(added.ok)
  if (!added.ok) return
  state = added.state
  const other = state.profiles.find((profile) => profile.id !== state.activeId)!
  const switched = switchBllProfile(state, other.id)
  assert.equal(switched.ok, true)
  if (!switched.ok) return
  assert.equal(switched.state.activeId, other.id)
  assert.equal(switchBllProfile(state, 'nope').ok, false)
})

test('deleteBllProfile remove e, na última, recria Principal', () => {
  let state = createDefaultState()
  const added = addBllProfile(state, 'Temp')
  assert.ok(added.ok)
  if (!added.ok) return
  state = added.state
  const keep = state.profiles.find((profile) => profile.id !== added.id)!
  const removed = deleteBllProfile(state, added.id)
  assert.equal(removed.ok, true)
  if (!removed.ok) return
  assert.equal(removed.state.profiles.length, 1)
  assert.equal(removed.state.profiles[0].id, keep.id)

  const last = deleteBllProfile(removed.state, keep.id)
  assert.equal(last.ok, true)
  if (!last.ok) return
  assert.equal(last.state.profiles.length, 1)
  assert.equal(last.state.profiles[0].name, DEFAULT_BLL_PROFILE_NAME)
  assert.notEqual(last.state.activeId, keep.id)
})
