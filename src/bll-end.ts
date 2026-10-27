/** BLL game states (`situacao`): 1 Previsto, 2 Invisível, 3 Ao Vivo, 4 Encerrado. */
export const BLL_LIVE_SITUATION = 3
export const BLL_ENDED_SITUATION = 4

const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The BLL event id of a player URL (`/view/<id>`) on the catalog's origin, or null. */
export function bllEventIdOf(url: string, homeUrl: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== new URL(homeUrl).origin) return null
    const match = /^\/view\/([^/]+)\/?$/i.exec(parsed.pathname)
    const id = match ? decodeURIComponent(match[1]) : ''
    return EVENT_ID.test(id) ? id : null
  } catch {
    return null
  }
}

/** Event id → `situacao`, from the raw rows read off the BLL home list. */
export function parseBllSituations(raw: unknown): Map<string, number> {
  const situations = new Map<string, number>()
  if (!Array.isArray(raw)) return situations
  for (const row of raw.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    const situation = Number(item.situation)
    if (EVENT_ID.test(id) && Number.isInteger(situation)) situations.set(id, situation)
  }
  return situations
}

export type BllPanelGame = { panelId: string; eventId: string }

/**
 * Tells which panels' games the BLL just moved from "Ao Vivo" to "Encerrado".
 * A panel only ends once, and only after its game was seen live, so a game opened already over stays open.
 */
export function createBllEndTracker() {
  const panels = new Map<string, { eventId: string; sawLive: boolean; ended: boolean }>()
  return {
    update(games: BllPanelGame[], situations: Map<string, number>): string[] {
      const open = new Set(games.map((game) => game.panelId))
      for (const id of [...panels.keys()]) if (!open.has(id)) panels.delete(id)
      const ended: string[] = []
      for (const { panelId, eventId } of games) {
        let entry = panels.get(panelId)
        if (!entry || entry.eventId !== eventId) {
          entry = { eventId, sawLive: false, ended: false }
          panels.set(panelId, entry)
        }
        const situation = situations.get(eventId)
        if (situation === BLL_LIVE_SITUATION) entry.sawLive = true
        else if (situation === BLL_ENDED_SITUATION && entry.sawLive && !entry.ended) {
          entry.ended = true
          ended.push(panelId)
        }
      }
      return ended
    },
  }
}
