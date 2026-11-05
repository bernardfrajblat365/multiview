// Scripts the William Hill scanner runs inside the scoreboard page. Kept apart from
// scoreboard-scanner.ts (which imports electron) so the Node tests can run them in a fake page.
import { ALERT_INCIDENT_TYPES, END_INCIDENT_TYPE } from '../src/match-events.ts'
import { HALF_TIME_INCIDENTS } from '../src/match-clock.ts'

/**
 * Runs in the scoreboard page. Only reads the feed; it never sends anything out.
 * Every update replays the whole match (oldest first, ~500 items by the second half),
 * so only alert types are queued, once per id, or the newest ones would be cut off.
 */
export const hookScript = `(() => {
  if (window.__quadraHooked) return true
  const S = window.WH && window.WH.scoreboard
  if (!S) return false
  const names = ['commentaries', 'animations', 'penalties', 'statistics']
  const types = new Set(${JSON.stringify(ALERT_INCIDENT_TYPES)})
  let wrapped = 0
  window.__quadraQueue = window.__quadraQueue || []
  window.__quadraSeen = window.__quadraSeen || new Set()
  window.__quadraShirts = window.__quadraShirts || {}
  const halfTime = new Set(${JSON.stringify(HALF_TIME_INCIDENTS)})
  for (const name of names) {
    const mod = S[name]
    if (!mod || typeof mod.acceptIncident !== 'function' || mod.__quadraWrapped) continue
    const original = mod.acceptIncident
    mod.acceptIncident = function (incidents) {
      try {
        window.__quadraUpdates = (window.__quadraUpdates || 0) + 1
        if (Array.isArray(incidents)) {
          for (const item of incidents) {
            if (item && item.type === ${JSON.stringify(END_INCIDENT_TYPE)} && !window.__quadraEndAt) window.__quadraEndAt = Date.parse(item.timestamp) || Date.now()
            // Match time of the newest item (the clock's fallback) and the half-time whistle (the break countdown).
            const at = item && Date.parse(item.timestamp)
            if (at && item.time && typeof item.time.duration === 'number' && (!window.__quadraLastTime || at >= window.__quadraLastTime.at)) window.__quadraLastTime = { duration: item.time.duration, at }
            if (at && (halfTime.has(item.type) || (item.time && item.time.period === 'HALF_TIME')) && (!window.__quadraBreakAt || at < window.__quadraBreakAt)) window.__quadraBreakAt = at
            // The shirt number may only show up on a later replay of the same goal.
            if (item && item.type === 'GOAL' && item.data && item.data.PLAYER) window.__quadraShirts[item.id] = item.data.PLAYER
            if (!item || !types.has(item.type) || window.__quadraSeen.has(item.id)) continue
            window.__quadraSeen.add(item.id)
            if (window.__quadraQueue.length < 400) {
              const named = (item.scorer && item.scorer.name) || (item.player && item.player.name) || ''
              window.__quadraQueue.push({ id: item.id, type: item.type, subType: item.subType, teamType: item.teamType, timestamp: item.timestamp, time: { duration: item.time && item.time.duration }, shirt: item.data && item.data.PLAYER, playerName: String(named).slice(0, 80) })
            }
          }
        }
      } catch (e) {}
      return original.apply(this, arguments)
    }
    mod.__quadraWrapped = true
    wrapped += 1
  }
  // The board's clock: set on every update and on every tick (each second) while the match time runs.
  const scores = S.scores
  if (scores && typeof scores.setClock === 'function' && !scores.__quadraWrapped) {
    const original = scores.setClock
    scores.setClock = function (data) {
      try {
        const time = data && data.currentTime
        if (time && typeof time.duration === 'number') window.__quadraClock = { duration: time.duration, at: Date.now() }
      } catch (e) {}
      return original.apply(this, arguments)
    }
    scores.__quadraWrapped = true
  }
  // Goal lists of the line-up carry the scorer's name, sometimes after the goal itself.
  const lineups = S.lineups
  if (lineups && typeof lineups.addEvents === 'function' && !lineups.__quadraWrapped) {
    const original = lineups.addEvents
    window.__quadraScorers = window.__quadraScorers || {}
    lineups.addEvents = function (type, events) {
      try {
        if (type === 'goals' && Array.isArray(events)) {
          for (const event of events) {
            const who = event && ((event.scorer && event.scorer.name) || (event.player && event.player.name))
            if (who && event.incidentId) window.__quadraScorers[event.incidentId] = String(who).slice(0, 80)
          }
        }
      } catch (e) {}
      return original.apply(this, arguments)
    }
    // The starting players of each team (shirt and name), kept as they arrive; the drain falls back to the page's own list.
    if (typeof lineups.diffusionHandler === 'function') {
      const handler = lineups.diffusionHandler
      window.__quadraLineups = window.__quadraLineups || {}
      lineups.diffusionHandler = function (team, players) {
        try {
          if (Array.isArray(players) && players.length) window.__quadraLineups[String(team).toUpperCase()] = players.map((p) => ({ number: p && p.number, name: p && p.name }))
        } catch (e) {}
        return handler.apply(this, arguments)
      }
    }
    lineups.__quadraWrapped = true
  }
  if (wrapped > 0) window.__quadraHooked = true
  return wrapped > 0
})()`

/** Names for pending goals: the line-up goal list first, then the shirt number looked up in the line-up. */
export const scorerScript = (items: Array<{ id: string; team: string; shirt: number }>) => `((items) => {
  const out = {}
  const lineups = window.WH && window.WH.scoreboard && window.WH.scoreboard.lineups
  const listed = window.__quadraScorers || {}
  const shirts = window.__quadraShirts || {}
  for (const item of items) {
    let name = listed[item.id] || ''
    const shirt = Number(item.shirt || shirts[item.id]) || 0
    if (!name && shirt && lineups && typeof lineups.getPlayerName === 'function') {
      try { name = lineups.getPlayerName(item.team, shirt) || '' } catch (e) {}
    }
    if (name) out[item.id] = String(name).slice(0, 80)
  }
  return out
})(${JSON.stringify(items)})`

export const drainScript = `(() => {
  const lineupOf = (side) => {
    const kept = window.__quadraLineups && window.__quadraLineups[side]
    if (kept && kept.length) return kept.map((p) => ({ number: p.number, name: String(p.name || '').slice(0, 80) }))
    const rows = document.querySelectorAll('.players_' + side.toLowerCase() + ' li .box-col1')
    return Array.from(rows).slice(0, 20).map((row) => {
      const cells = row.querySelectorAll('span')
      return { number: cells[0] ? cells[0].textContent.trim() : '', name: cells[1] ? cells[1].textContent.trim().slice(0, 80) : '' }
    })
  }
  const queue = window.__quadraQueue || []
  window.__quadraQueue = []
  const lines = (document.body ? document.body.innerText : '').split('\\n').map((line) => line.trim()).filter(Boolean)
  const scoreIndex = lines.findIndex((line) => /^\\d+\\s*-\\s*\\d+$/.test(line))
  const D = window.WH && window.WH.scoreboard && window.WH.scoreboard.diffusion
  const stats = window.WH && window.WH.scoreboard && window.WH.scoreboard.statistics
  let period = ''
  try { period = stats && typeof stats.getPeriod === 'function' ? String(stats.getPeriod() || '') : '' } catch (e) {}
  return {
    hooked: Boolean(window.__quadraHooked),
    connected: Boolean(D && D.isConnected),
    updates: window.__quadraUpdates || 0,
    period: /^[A-Z_]{1,40}$/.test(period) ? period : '',
    endAt: Number(window.__quadraEndAt) || 0,
    clock: window.__quadraClock || null,
    lastTime: window.__quadraLastTime || null,
    breakAt: Number(window.__quadraBreakAt) || 0,
    now: Date.now(),
    queue,
    lineups: { home: lineupOf('HOME'), away: lineupOf('AWAY') },
    home: scoreIndex > 0 ? lines[scoreIndex - 1].slice(0, 80) : '',
    away: scoreIndex >= 0 && lines[scoreIndex + 1] ? lines[scoreIndex + 1].slice(0, 80) : '',
    score: scoreIndex >= 0 ? lines[scoreIndex].replace(/\\s+/g, ' ') : '',
  }
})()`
