import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_BLL_PROFILES = 8
export const DEFAULT_BLL_PROFILE_NAME = 'Principal'
export const BLL_PROFILES_FILE = 'bll-profiles.json'

export type BllProfile = { id: string; name: string }
export type BllProfilesState = { activeId: string; profiles: BllProfile[] }

export function partitionOf(id: string): string {
  return `persist:quadra-bll-${id}`
}

export function newProfileId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

/** Trim, collapse spaces, max 40 chars. Empty / control-only → null. */
export function sanitizeProfileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return name || null
}

export function createDefaultState(name = DEFAULT_BLL_PROFILE_NAME): BllProfilesState {
  const id = newProfileId()
  return { activeId: id, profiles: [{ id, name }] }
}

export function parseBllProfilesState(raw: unknown): BllProfilesState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { activeId?: unknown; profiles?: unknown }
  if (!Array.isArray(value.profiles) || typeof value.activeId !== 'string') return null
  const profiles: BllProfile[] = []
  const seen = new Set<string>()
  for (const entry of value.profiles) {
    if (!entry || typeof entry !== 'object') continue
    const id = typeof (entry as BllProfile).id === 'string' ? (entry as BllProfile).id.trim() : ''
    const name = sanitizeProfileName((entry as BllProfile).name)
    if (!id || !/^[a-zA-Z0-9_-]{4,64}$/.test(id) || !name || seen.has(id)) continue
    seen.add(id)
    profiles.push({ id, name })
    if (profiles.length >= MAX_BLL_PROFILES) break
  }
  if (!profiles.length) return null
  const activeId = profiles.some((profile) => profile.id === value.activeId) ? value.activeId : profiles[0].id
  return { activeId, profiles }
}

export type ProfileMutation =
  | { ok: true; state: BllProfilesState; id: string }
  | { ok: false; reason: 'limit' | 'name' | 'missing' | 'active' }

export function addBllProfile(state: BllProfilesState, rawName: unknown): ProfileMutation {
  if (state.profiles.length >= MAX_BLL_PROFILES) return { ok: false, reason: 'limit' }
  const name = sanitizeProfileName(rawName)
  if (!name) return { ok: false, reason: 'name' }
  let id = newProfileId()
  while (state.profiles.some((profile) => profile.id === id)) id = newProfileId()
  const profiles = [...state.profiles, { id, name }]
  return { ok: true, state: { activeId: id, profiles }, id }
}

export function deleteBllProfile(state: BllProfilesState, id: unknown): ProfileMutation {
  if (typeof id !== 'string' || !state.profiles.some((profile) => profile.id === id)) {
    return { ok: false, reason: 'missing' }
  }
  if (state.profiles.length === 1) {
    // Last profile: replace with a fresh Principal so there is always one account.
    const next = createDefaultState()
    return { ok: true, state: next, id: next.activeId }
  }
  const profiles = state.profiles.filter((profile) => profile.id !== id)
  const activeId = state.activeId === id ? profiles[0].id : state.activeId
  return { ok: true, state: { activeId, profiles }, id }
}

export function switchBllProfile(state: BllProfilesState, id: unknown): ProfileMutation {
  if (typeof id !== 'string' || !state.profiles.some((profile) => profile.id === id)) {
    return { ok: false, reason: 'missing' }
  }
  if (state.activeId === id) return { ok: true, state, id }
  return { ok: true, state: { ...state, activeId: id }, id }
}

export function bllProfilesPath(userData: string): string {
  return join(userData, BLL_PROFILES_FILE)
}

/** Load from disk, or null if missing/corrupt (caller creates default + migrates). */
export function readBllProfilesFile(userData: string): BllProfilesState | null {
  const path = bllProfilesPath(userData)
  if (!existsSync(path)) return null
  try {
    return parseBllProfilesState(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export function writeBllProfilesFile(userData: string, state: BllProfilesState): void {
  const path = bllProfilesPath(userData)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}
