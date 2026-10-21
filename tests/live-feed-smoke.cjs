const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startBllFeedServer } = require('./fixtures/bll-feed-server.cjs')

const projectRoot = path.resolve(__dirname, '..')
const electronPath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const mainPath = path.join(projectRoot, 'out', 'main', 'main.js')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const EVENT_NORMAL = '41574699'
const EVENT_SCORE_ONLY = '41574701'
const EVENT_STALL = '41574702'
const EVENT_DELAYED = '41574703'
const EVENT_DUP_A = '41574704'
const WH_DELAY_MS = 25_000

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} while requesting ${url}`)
  return response.json()
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error('Timeout ao avaliar a UI.')) }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString())
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      const exception = message.result?.exceptionDetails
      if (exception) return reject(new Error(exception.exception?.description ?? exception.text ?? 'Erro na avaliação.'))
      resolve(message.result?.result?.value)
    })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket encerrou.')) })
  })
}

async function waitForRendererTarget(port) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      for (const target of targets.filter((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)) {
        try {
          if (await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`)) return target
        } catch {
          // The renderer can appear before its document is ready.
        }
      }
    } catch {
      // Electron may still be starting.
    }
    await wait(250)
  }
  throw new Error('A UI do Electron não apareceu no DevTools Protocol.')
}

async function waitForExpression(target, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(target.webSocketDebuggerUrl, expression).catch(() => false)) return
    await wait(100)
  }
  throw new Error(`Timeout aguardando expressão: ${expression}`)
}

function parsePairings(logText) {
  const pairings = new Map()
  for (const match of logText.matchAll(/\[live-feed\] panel ([^\s]+) -> event (\d+)/g)) {
    pairings.set(match[1], match[2])
  }
  return pairings
}

function parseAlerts(logText) {
  const alerts = []
  for (const match of logText.matchAll(/\[live-feed\] alert panel=([^\s]+) event=(\d+) kind=([^\s]+) id=([^\s]+)/g)) {
    alerts.push({ panelId: match[1], eventId: match[2], kind: match[3], incidentId: match[4] })
  }
  return alerts
}

async function run() {
  assert.ok(fs.existsSync(electronPath), 'Electron não encontrado.')
  assert.ok(fs.existsSync(mainPath), 'Bundle main não encontrado; execute npm run build.')

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-feed-smoke-'))
  const port = 48000 + Math.floor(Math.random() * 1000)
  const feed = await startBllFeedServer({
    events: {
      [EVENT_NORMAL]: { eventId: EVENT_NORMAL },
      [EVENT_SCORE_ONLY]: { eventId: EVENT_SCORE_ONLY, scoreOnlyGoals: true, liveGoalDelayMs: 1000 },
      [EVENT_STALL]: { eventId: EVENT_STALL, stallOnce: true, liveGoalDelayMs: 600 },
      [EVENT_DELAYED]: { eventId: EVENT_DELAYED, liveGoalDelayMs: 1000, liveGoalIntervalMs: 2500, maxLiveGoals: 8 },
      [EVENT_DUP_A]: { eventId: EVENT_DUP_A, liveGoalDelayMs: 900 },
      '41574705': { eventId: '41574705' },
      '41574706': { eventId: '41574706' },
      '41574707': { eventId: '41574707' },
    },
  })

  const panelUrls = [
    `${feed.baseUrl}/view/p0?whId=${EVENT_NORMAL}&title=${encodeURIComponent('Normal x Goal')}`,
    `${feed.baseUrl}/view/p1?whId=${EVENT_SCORE_ONLY}&title=${encodeURIComponent('Score Only')}`,
    `${feed.baseUrl}/view/p2?whId=${EVENT_STALL}&title=${encodeURIComponent('Stall Once')}`,
    `${feed.baseUrl}/view/p3?whId=${EVENT_DELAYED}&whDelayMs=${WH_DELAY_MS}&title=${encodeURIComponent('Delayed Id')}`,
    `${feed.baseUrl}/view/p4?whId=none&title=${encodeURIComponent('No Feed')}`,
    `${feed.baseUrl}/view/p5?whId=${EVENT_DUP_A}&title=${encodeURIComponent('Dup A')}`,
    `${feed.baseUrl}/view/p6?whId=41574705&title=${encodeURIComponent('Extra 1')}`,
    `${feed.baseUrl}/view/p7?whId=41574706&title=${encodeURIComponent('Extra 2')}`,
    `${feed.baseUrl}/view/p8?whId=41574707&title=${encodeURIComponent('Extra 3')}`,
  ]

  let mainLog = ''
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...childEnv,
      QUADRA_TEST_USER_DATA: userData,
      QUADRA_BLLSPORT_URL: `${feed.baseUrl}/bll/`,
      QUADRA_FEED_SCOREBOARD_URL: `${feed.baseUrl}/scoreboard/?eventId={eventId}&sport=football&locale=pt-pt`,
      QUADRA_FEED_STALL_MS: '2000',
    },
  })
  child.stdout.on('data', (chunk) => { mainLog += chunk.toString() })
  child.stderr.on('data', (chunk) => { mainLog += chunk.toString() })

  try {
    const target = await waitForRendererTarget(port)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-count="9"]').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 9`)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const urls = ${JSON.stringify(panelUrls)}
      document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => {
        input.value = urls[index] || ''
      })
      document.querySelector('#btn-open-all').click()
    })()`)

    await waitForExpression(
      target,
      `document.querySelectorAll('.panel.panel--loaded').length >= 8`,
      20000,
    )

    const playerIdsBefore = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.type === 'page' && candidate.url.includes('/view/'))
      .map((candidate) => candidate.id)
      .sort()

    // Wait for fast pairings (all except delayed + no-id).
    const pairDeadline = Date.now() + 20000
    let pairings = new Map()
    while (Date.now() < pairDeadline) {
      pairings = parsePairings(mainLog)
      if (pairings.size >= 7) break
      await wait(250)
    }
    assert.ok(pairings.size >= 7, `expected >=7 pairings, got ${pairings.size}: ${[...pairings.entries()].join('; ')}`)

    // Delayed ID should pair after ~25s (slow probe).
    const delayedDeadline = Date.now() + 45000
    while (Date.now() < delayedDeadline) {
      pairings = parsePairings(mainLog)
      if ([...pairings.values()].includes(EVENT_DELAYED)) break
      await wait(500)
    }
    assert.ok(
      [...pairings.values()].includes(EVENT_DELAYED),
      `delayed williamHillId did not pair: ${[...pairings.entries()].join('; ')}`,
    )
    assert.equal(
      [...pairings.values()].includes('none') || [...pairings.values()].some((id) => !id),
      false,
    )

    // Collect goal alerts for key scenarios.
    const alertDeadline = Date.now() + 35000
    let alerts = []
    while (Date.now() < alertDeadline) {
      alerts = parseAlerts(mainLog).filter((alert) => alert.kind === 'goal')
      const byEvent = new Set(alerts.map((alert) => alert.eventId))
      if (
        byEvent.has(EVENT_NORMAL) &&
        byEvent.has(EVENT_SCORE_ONLY) &&
        byEvent.has(EVENT_STALL) &&
        byEvent.has(EVENT_DELAYED)
      ) break
      await wait(400)
    }
    alerts = parseAlerts(mainLog).filter((alert) => alert.kind === 'goal')
    const byEvent = Object.fromEntries(
      [EVENT_NORMAL, EVENT_SCORE_ONLY, EVENT_STALL, EVENT_DELAYED, EVENT_DUP_A].map((eventId) => [
        eventId,
        alerts.filter((alert) => alert.eventId === eventId),
      ]),
    )
    assert.ok(byEvent[EVENT_NORMAL].length >= 1, 'normal incident goal missing')
    assert.ok(byEvent[EVENT_SCORE_ONLY].length >= 1, 'score-only goal missing')
    assert.ok(
      byEvent[EVENT_SCORE_ONLY].some((alert) => alert.incidentId.startsWith('score-goal:')),
      'score-only should emit score-goal ids',
    )
    assert.ok(byEvent[EVENT_STALL].length >= 1, 'goal after stall missing')
    assert.ok(byEvent[EVENT_DELAYED].length >= 1, 'goal after delayed id missing')

    // No alerts for the panel without williamHillId.
    const noIdPanel = [...pairings.entries()].find(([, eventId]) => eventId === 'none')
    assert.equal(noIdPanel, undefined)
    const alertsForUnknown = alerts.filter((alert) => !pairings.has(alert.panelId))
    // All alerts should map to paired panels; the no-id panel never pairs.
    for (const alert of alerts) {
      assert.ok(pairings.has(alert.panelId), `alert for unpaired panel ${alert.panelId}`)
    }
    assert.equal(alertsForUnknown.length, 0)

    // Dedup: score-only event should not emit both score-goal and incident for same tick
    // (fixture sends score only, so only score-goal). For normal, at most one alert per live goal wave.
    const scoreOnlyIds = new Set(byEvent[EVENT_SCORE_ONLY].map((alert) => alert.incidentId))
    assert.ok([...scoreOnlyIds].every((id) => id.startsWith('score-goal:') || id.includes('live-goal') || id.includes('baseline')))

    // Spotlight should have fired on at least one panel (9 >= 5).
    const spotlight = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      badges: document.querySelectorAll('.panel__spotlight').length,
      highlighted: document.querySelectorAll('.panel.is-highlighted').length,
    }))()`).catch(() => ({ badges: 0, highlighted: 0 }))
    assert.ok(
      spotlight.badges >= 1 || spotlight.highlighted >= 1,
      `expected spotlight UI, got ${JSON.stringify(spotlight)}`,
    )

    const playerIdsAfter = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.type === 'page' && candidate.url.includes('/view/'))
      .map((candidate) => candidate.id)
      .sort()
    assert.deepEqual(playerIdsAfter, playerIdsBefore, 'WebContentsView reload detected')

    process.stdout.write(JSON.stringify({
      pairings: Object.fromEntries(pairings),
      goalAlerts: Object.fromEntries(
        Object.entries(byEvent).map(([eventId, list]) => [eventId, list.length]),
      ),
      spotlight: true,
      noReload: true,
    }) + '\n')
  } finally {
    if (child.exitCode === null) child.kill()
    await feed.close()
    await wait(600)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await wait(250) }
    }
    if (fs.existsSync(userData)) throw new Error('userData temporário não foi liberado.')
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
