import { inflateRawSync, inflateSync } from 'node:zlib'

export type AlertKind = 'goal' | 'penalty' | 'red' | 'var'
export type AlertTeam = 'home' | 'away' | null

export type FeedIncident = {
  id: string
  eventId: string
  type: string
  teamType?: string | null
  timestamp?: string | null
  data?: Record<string, unknown> | null
  time?: { period?: string; duration?: number } | null
}

export type FeedScore = {
  home: number
  away: number
}

export type FeedUpdates = {
  incidents: FeedIncident[]
  score: FeedScore | null
}

export type PanelAlert = {
  kind: AlertKind
  team: AlertTeam
  label: string
  incidentId: string
}

export type ClassifyResult = {
  kind: AlertKind
  label: string
}

const BREAK = Symbol('cbor-break')
const MAX_FRAME_SCAN = 24
const INCIDENT_MAX_AGE_MS = 3 * 60 * 1000

function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 31
  const f = h & 1023
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? Number.NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

export function decodeCbor(buf: Buffer, offset = 0): { value: unknown; offset: number } {
  if (offset >= buf.length) throw new Error('cbor eof')
  const ib = buf[offset++]!
  const major = ib >> 5
  const ai = ib & 31

  const readLen = (): number => {
    if (ai < 24) return ai
    if (ai === 24) return buf[offset++]!
    if (ai === 25) {
      const value = buf.readUInt16BE(offset)
      offset += 2
      return value
    }
    if (ai === 26) {
      const value = buf.readUInt32BE(offset)
      offset += 4
      return value
    }
    if (ai === 27) {
      const value = Number(buf.readBigUInt64BE(offset))
      offset += 8
      return value
    }
    if (ai === 31) return -1
    throw new Error('cbor bad additional info')
  }

  if (ib === 0xff) return { value: BREAK, offset }

  if (major === 7) {
    if (ai === 20) return { value: false, offset }
    if (ai === 21) return { value: true, offset }
    if (ai === 22) return { value: null, offset }
    if (ai === 23) return { value: undefined, offset }
    if (ai === 25) {
      const value = halfToFloat(buf.readUInt16BE(offset))
      return { value, offset: offset + 2 }
    }
    if (ai === 26) return { value: buf.readFloatBE(offset), offset: offset + 4 }
    if (ai === 27) return { value: buf.readDoubleBE(offset), offset: offset + 8 }
    if (ai < 24) return { value: ai, offset }
    throw new Error('cbor bad simple')
  }

  const len = readLen()
  if (major === 0) return { value: len, offset }
  if (major === 1) return { value: -1 - len, offset }

  if (major === 2 || major === 3) {
    if (len < 0) {
      let text = ''
      const chunks: Buffer[] = []
      for (;;) {
        const next = decodeCbor(buf, offset)
        offset = next.offset
        if (next.value === BREAK) break
        if (major === 3) text += String(next.value)
        else chunks.push(Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value)))
      }
      return { value: major === 3 ? text : Buffer.concat(chunks), offset }
    }
    if (offset + len > buf.length) throw new Error('cbor eof string')
    const slice = buf.subarray(offset, offset + len)
    return { value: major === 3 ? slice.toString('utf8') : slice, offset: offset + len }
  }

  if (major === 4) {
    const arr: unknown[] = []
    for (let i = 0; len < 0 || i < len; i++) {
      const next = decodeCbor(buf, offset)
      offset = next.offset
      if (next.value === BREAK) break
      arr.push(next.value)
    }
    return { value: arr, offset }
  }

  if (major === 5) {
    const obj: Record<string, unknown> = {}
    for (let i = 0; len < 0 || i < len; i++) {
      const key = decodeCbor(buf, offset)
      offset = key.offset
      if (key.value === BREAK) break
      const val = decodeCbor(buf, offset)
      offset = val.offset
      obj[String(key.value)] = val.value
    }
    return { value: obj, offset }
  }

  if (major === 6) {
    const tagged = decodeCbor(buf, offset)
    return { value: tagged.value, offset: tagged.offset }
  }

  throw new Error('cbor unsupported major')
}

function tryDecodeAt(buf: Buffer, start: number): unknown | null {
  try {
    const result = decodeCbor(buf, start)
    if (result.offset < buf.length - 2) return null
    if (result.value === null || typeof result.value !== 'object') return null
    return result.value
  } catch {
    return null
  }
}

function tryInflate(buf: Buffer): Buffer | null {
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(buf)
    } catch {
      // try next
    }
  }
  return null
}

export function decodeFeedFrame(base64OrBuffer: string | Buffer): unknown | null {
  const buf = typeof base64OrBuffer === 'string' ? Buffer.from(base64OrBuffer, 'base64') : base64OrBuffer
  if (!buf.length) return null

  for (let off = 0; off < MAX_FRAME_SCAN && off < buf.length; off++) {
    const value = tryDecodeAt(buf, off)
    if (value) return value
  }

  // Diffusion frames may wrap a compressed CBOR payload after a short header.
  for (let off = 0; off < MAX_FRAME_SCAN && off < buf.length; off++) {
    const inflated = tryInflate(buf.subarray(off))
    if (!inflated) continue
    for (let inner = 0; inner < 8 && inner < inflated.length; inner++) {
      const value = tryDecodeAt(inflated, inner)
      if (value) return value
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)
}

function asIncident(value: unknown): FeedIncident | null {
  if (!isRecord(value)) return null
  const id = value.id
  const eventId = value.eventId
  const type = value.type
  if (typeof id !== 'string' || !id) return null
  if (typeof eventId !== 'string' || !eventId) return null
  if (typeof type !== 'string' || !type) return null
  return {
    id,
    eventId,
    type,
    teamType: typeof value.teamType === 'string' ? value.teamType : null,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : null,
    data: isRecord(value.data) ? value.data : null,
    time: isRecord(value.time)
      ? {
          period: typeof value.time.period === 'string' ? value.time.period : undefined,
          duration: typeof value.time.duration === 'number' ? value.time.duration : undefined,
        }
      : null,
  }
}

function asScore(value: unknown): FeedScore | null {
  if (!isRecord(value)) return null
  const score = value.score
  if (!isRecord(score)) return null
  const home = score.home
  const away = score.away
  if (typeof home !== 'number' || typeof away !== 'number') return null
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

function eventTopicId(eventId: string) {
  return eventId.startsWith('OB_EV') ? eventId : `OB_EV${eventId}`
}

export function collectFeedUpdates(value: unknown, eventId: string): FeedUpdates {
  const topic = eventTopicId(eventId)
  const incidents: FeedIncident[] = []
  const seen = new Set<string>()
  let score: FeedScore | null = null

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node)) return

    const incident = asIncident(node)
    if (incident && incident.eventId === topic && !seen.has(incident.id)) {
      seen.add(incident.id)
      incidents.push(incident)
    }

    if (typeof node.id === 'string' && node.id === topic) {
      const nextScore = asScore(node)
      if (nextScore) score = nextScore
    }

    for (const child of Object.values(node)) walk(child)
  }

  walk(value)
  return { incidents, score }
}

export function classifyIncident(type: string): ClassifyResult | null {
  const normalized = type.trim().toUpperCase()
  if (!normalized) return null
  if (normalized === 'GOAL') return { kind: 'goal', label: 'GOL' }
  if (normalized === 'PENALTY') return { kind: 'penalty', label: 'PÊNALTI' }
  if (normalized === 'PENALTY_MISSED') return { kind: 'penalty', label: 'PÊNALTI PERDIDO' }
  if (normalized === 'RED_CARD') return { kind: 'red', label: 'VERMELHO' }
  if (normalized === 'POSSIBLE_RED_CARD') return { kind: 'red', label: 'Possível vermelho' }
  if (/VAR|VIDEO|CANCEL|DISALLOW|ANNUL/.test(normalized)) return { kind: 'var', label: 'VAR' }
  return null
}

function teamFromIncident(teamType: string | null | undefined): AlertTeam {
  if (!teamType) return null
  const normalized = teamType.toUpperCase()
  if (normalized === 'HOME') return 'home'
  if (normalized === 'AWAY') return 'away'
  return null
}

function isRecent(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return true
  const ms = Date.parse(timestamp)
  if (!Number.isFinite(ms)) return true
  return now - ms <= INCIDENT_MAX_AGE_MS
}

export class IncidentTracker {
  private primed = false
  private seenIds = new Set<string>()
  private lastScore: FeedScore | null = null

  ingest(updates: FeedUpdates, now = Date.now()): PanelAlert[] {
    const alerts: PanelAlert[] = []

    if (!this.primed) {
      for (const incident of updates.incidents) this.seenIds.add(incident.id)
      if (updates.score) this.lastScore = updates.score
      this.primed = true
      return alerts
    }

    for (const incident of updates.incidents) {
      if (this.seenIds.has(incident.id)) continue
      this.seenIds.add(incident.id)
      if (!isRecent(incident.timestamp, now)) continue
      const classified = classifyIncident(incident.type)
      if (!classified) continue
      alerts.push({
        kind: classified.kind,
        team: teamFromIncident(incident.teamType),
        label: classified.label,
        incidentId: incident.id,
      })
    }

    if (updates.score) {
      if (this.lastScore) {
        const dropped =
          updates.score.home < this.lastScore.home || updates.score.away < this.lastScore.away
        if (dropped) {
          const incidentId = `score-drop:${this.lastScore.home}-${this.lastScore.away}->${updates.score.home}-${updates.score.away}:${now}`
          alerts.push({
            kind: 'var',
            team: null,
            label: 'Gol anulado',
            incidentId,
          })
        }
      }
      this.lastScore = updates.score
    }

    return alerts
  }
}
