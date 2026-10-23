import { stripSoundMarkers } from './match-label.ts'

export type BllEvent ={ id: string; name: string; competition: string; time: string; live: boolean; url: string }
export type BllEventGroup<T extends BllEvent = BllEvent> = { competition: string; events: T[] }
export type BllEventsResult =
  | { status: 'ok'; events: BllEvent[] }
  | { status: 'unavailable' }

type PanelSlot = { id: string; url: string }
export type BatchPlan = {
  fill: Array<{ panelId: string; url: string }>
  extra: string[]
  alreadyOpen: number
  dropped: number
}

const MAX_TEXT = 200
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/
/** BLL only lets regular accounts open events in this state (`abrirEvento`). */
const LIVE_SITUATION = 3

function cleanText(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
    : ''
}

/** Validates the raw rows read from the BLL home page; `toUrl` builds the player URL or rejects the id. */
export function parseBllEvents(raw: unknown, toUrl: (id: string) => string | null): BllEvent[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const events: BllEvent[] = []
  for (const row of raw.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    if (!EVENT_ID.test(id) || seen.has(id)) continue
    const url = toUrl(id)
    if (!url) continue
    seen.add(id)
    events.push({
      id,
      name: stripSoundMarkers(cleanText(item.name)) || 'Jogo sem nome',
      competition: cleanText(item.competition) || 'Outros',
      time: cleanText(item.time).slice(0, 5),
      live: item.situation === LIVE_SITUATION,
      url,
    })
  }
  return events
}

/** Groups events by competition, keeping the order the catalog lists them in. */
export function groupByCompetition<T extends BllEvent>(events: T[]): BllEventGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const group = groups.get(event.competition)
    if (group) group.push(event)
    else groups.set(event.competition, [event])
  }
  return [...groups].map(([competition, items]) => ({ competition, events: items }))
}

/** Fills empty panels first, then asks for new panels up to `maxPanels`; games already open are skipped. */
export function planBatchOpen(panels: PanelSlot[], urls: string[], maxPanels: number): BatchPlan {
  const open = new Set(panels.map((panel) => panel.url).filter(Boolean))
  const pending: string[] = []
  let alreadyOpen = 0
  for (const url of urls) {
    if (open.has(url)) {
      alreadyOpen += 1
      continue
    }
    open.add(url)
    pending.push(url)
  }
  const empties = panels.filter((panel) => !panel.url)
  const fill = empties.slice(0, pending.length).map((panel, index) => ({ panelId: panel.id, url: pending[index] }))
  const rest = pending.slice(fill.length)
  const room = Math.max(0, maxPanels - panels.length)
  return { fill, extra: rest.slice(0, room), alreadyOpen, dropped: Math.max(0, rest.length - room) }
}

/** How many new games still fit: empty panels plus panels that can still be added. */
export function batchCapacity(panels: PanelSlot[], maxPanels: number) {
  return panels.filter((panel) => !panel.url).length + Math.max(0, maxPanels - panels.length)
}
