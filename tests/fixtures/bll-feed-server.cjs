const crypto = require('node:crypto')
const http = require('node:http')
const { createSportsPlayerFixture } = require('../sports-player-fixture.cjs')

const FEED_EVENT_ID = '41574699'

function encodeCbor(value) {
  if (value === false) return Buffer.from([0xf4])
  if (value === true) return Buffer.from([0xf5])
  if (value === null) return Buffer.from([0xf6])
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24) return Buffer.from([value])
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 256) return Buffer.from([0x18, value])
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    if (text.length < 24) return Buffer.concat([Buffer.from([0x60 | text.length]), text])
    return Buffer.concat([Buffer.from([0x78, text.length]), text])
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => encodeCbor(item))
    if (value.length < 24) return Buffer.concat([Buffer.from([0x80 | value.length]), ...parts])
    return Buffer.concat([Buffer.from([0x98, value.length]), ...parts])
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    const parts = entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)])
    if (entries.length < 24) return Buffer.concat([Buffer.from([0xa0 | entries.length]), ...parts])
    return Buffer.concat([Buffer.from([0xb8, entries.length]), ...parts])
  }
  throw new Error(`unsupported cbor value: ${String(value)}`)
}

function wsAcceptKey(key) {
  return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

function encodeWsBinaryFrame(payload) {
  const length = payload.length
  if (length < 126) return Buffer.concat([Buffer.from([0x82, length]), payload])
  const header = Buffer.alloc(4)
  header[0] = 0x82
  header[1] = 126
  header.writeUInt16BE(length, 2)
  return Buffer.concat([header, payload])
}

function feedFrame(eventId, incidents, score) {
  const body = encodeCbor({
    data: incidents,
    id: `OB_EV${eventId}`,
    score,
  })
  return Buffer.concat([Buffer.alloc(4, 0x04), body])
}

function createScoreboardFixture(requestUrl) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl, 'http://127.0.0.1')
  const eventId = url.searchParams.get('eventId') || FEED_EVENT_ID
  return `<!doctype html><title>Scoreboard fixture</title>
    <body data-event-id="${eventId}">
    <div id="score">0 - 0</div>
    <script>
      const eventId = new URLSearchParams(location.search).get('eventId') || ${JSON.stringify(FEED_EVENT_ID)};
      const scoreEl = document.getElementById('score');
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/diffusion?eventId=' + encodeURIComponent(eventId));
      ws.binaryType = 'arraybuffer';
      window.__quadraFeedReady = false;
      ws.addEventListener('open', () => { window.__quadraFeedReady = true; });
      ws.addEventListener('message', () => { window.__quadraFeedFrames = (window.__quadraFeedFrames || 0) + 1; });
      // Mirror score into DOM for the 1s poll path (tests / backup detection).
      window.__quadraSetScore = (home, away) => {
        if (scoreEl) scoreEl.textContent = home + ' - ' + away;
      };
    </script>
    </body>`
}

function createBllCatalogHtml(gamesButtons) {
  const buttons = gamesButtons.map((game) => {
    const id = String(game.id)
    const href = String(game.href)
    const label = String(game.label)
    return `<button id="${id}" onclick="window.open('${href}', '${id}')">${label}</button>`
  }).join('\n')
  return `<!doctype html><title>BLL Test Catalog</title>${buttons}`
}

function defaultEventConfig(eventId) {
  return {
    eventId,
    scoreOnlyGoals: false,
    stallOnce: false,
    stallMs: 2500,
    liveGoalDelayMs: 800,
    liveGoalIntervalMs: 3000,
    maxLiveGoals: 6,
  }
}

/**
 * Starts an HTTP server with BLL catalog, scoreboard fixture, sports player views,
 * and a Diffusion WebSocket that emits a baseline then live goals.
 *
 * @param {{
 *   handleExtraRequest?: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => boolean,
 *   events?: Record<string, Partial<ReturnType<typeof defaultEventConfig>>>,
 *   catalogGames?: Array<{ id: string, label: string, href: string }>,
 * }} [options]
 */
function startBllFeedServer(options = {}) {
  const feedSockets = new Set()
  const eventConfigs = new Map()
  const stalledOnceEvents = new Set()
  const registerEvent = (partial = {}) => {
    const eventId = String(partial.eventId || FEED_EVENT_ID)
    const config = { ...defaultEventConfig(eventId), ...partial, eventId }
    eventConfigs.set(eventId, config)
    return config
  }
  registerEvent(options.events?.[FEED_EVENT_ID] || { eventId: FEED_EVENT_ID })
  for (const [eventId, partial] of Object.entries(options.events || {})) {
    registerEvent({ ...partial, eventId })
  }

  const catalogGames = options.catalogGames || [
    {
      id: 'game-a',
      label: 'Jogo A',
      href: `/view/game-a?canal=2&whId=${FEED_EVENT_ID}&title=${encodeURIComponent('Time A x Time B')}`,
    },
    {
      id: 'game-b',
      label: 'Jogo B',
      href: `/view/game-b?whId=41574700&title=${encodeURIComponent('Time C x Time D')}`,
    },
  ]

  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/bll/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(createBllCatalogHtml(catalogGames))
      return
    }
    if (request.url?.startsWith('/scoreboard')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(createScoreboardFixture(new URL(request.url, `http://${request.headers.host}`)))
      return
    }
    if (request.url?.startsWith('/view/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(createSportsPlayerFixture(new URL(request.url, `http://${request.headers.host}`)))
      return
    }
    if (options.handleExtraRequest?.(request, response)) return
    response.writeHead(404)
    response.end('not found')
  })

  server.on('upgrade', (request, socket) => {
    if (!request.url?.startsWith('/diffusion')) {
      socket.destroy()
      return
    }
    const key = request.headers['sec-websocket-key']
    if (!key) {
      socket.destroy()
      return
    }
    const upgradeUrl = new URL(request.url, 'http://127.0.0.1')
    const eventId = upgradeUrl.searchParams.get('eventId') || FEED_EVENT_ID
    const config = eventConfigs.get(eventId) || registerEvent({ eventId })

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`,
    )
    feedSockets.add(socket)
    const baseline = feedFrame(eventId, [
      {
        id: `OB_EV${eventId}#baseline-goal`,
        eventId: `OB_EV${eventId}`,
        type: 'GOAL',
        teamType: 'HOME',
        timestamp: new Date().toISOString(),
      },
    ], { home: 1, away: 0 })
    socket.write(encodeWsBinaryFrame(baseline))

    const timers = []
    let awayScore = 0
    let silent = false

    const sendLiveGoal = (suffix, { scoreOnly = config.scoreOnlyGoals } = {}) => {
      if (socket.destroyed || silent) return
      awayScore += 1
      const score = { home: 1, away: awayScore }
      const incidents = scoreOnly
        ? []
        : [{
            id: `OB_EV${eventId}#${suffix}`,
            eventId: `OB_EV${eventId}`,
            type: 'GOAL',
            teamType: 'AWAY',
            timestamp: new Date().toISOString(),
          }]
      socket.write(encodeWsBinaryFrame(feedFrame(eventId, incidents, score)))
    }

    const startLiveGoals = () => {
      timers.push(setTimeout(() => sendLiveGoal('live-goal-1'), config.liveGoalDelayMs))
      let liveIndex = 1
      const interval = setInterval(() => {
        liveIndex += 1
        if (liveIndex > config.maxLiveGoals || socket.destroyed) {
          clearInterval(interval)
          return
        }
        sendLiveGoal(`live-goal-${liveIndex}`)
      }, config.liveGoalIntervalMs)
      timers.push(interval)
    }

    if (config.stallOnce && !stalledOnceEvents.has(eventId)) {
      stalledOnceEvents.add(eventId)
      // Baseline only, then silence until FeedManager reloads after QUADRA_FEED_STALL_MS.
      silent = true
    } else {
      startLiveGoals()
    }

    const clearTimers = () => {
      for (const timer of timers) {
        clearTimeout(timer)
        clearInterval(timer)
      }
      feedSockets.delete(socket)
    }
    socket.on('close', clearTimers)
    socket.on('error', clearTimers)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        feedSockets,
        baseUrl: `http://127.0.0.1:${address.port}`,
        feedEventId: FEED_EVENT_ID,
        eventConfigs,
        async close() {
          for (const socket of feedSockets) {
            try { socket.destroy() } catch { /* ignore */ }
          }
          await new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}

module.exports = {
  FEED_EVENT_ID,
  startBllFeedServer,
}
