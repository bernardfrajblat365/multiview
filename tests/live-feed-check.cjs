// Manual live check against real BLL games.
// Usage:
//   node tests/live-feed-check.cjs [--minutes=10] <bll-view-url> [more-urls...]
// Copies persist:quadra into a temp profile and deletes it on exit.
const { spawn } = require('node:child_process')
const { cpSync, existsSync, mkdtempSync, rmSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')
const electronPath = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const mainPath = join(projectRoot, 'out', 'main', 'main.js')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv) {
  let minutes = 10
  const urls = []
  for (const arg of argv) {
    if (arg.startsWith('--minutes=')) {
      minutes = Math.max(1, Number(arg.slice('--minutes='.length)) || 10)
      continue
    }
    if (/^https?:\/\//i.test(arg) && /bllsport\.com\/view\//i.test(arg)) {
      urls.push(arg.includes('view=clean') ? arg : `${arg}${arg.includes('?') ? '&' : '?'}view=clean`)
      continue
    }
  }
  return { minutes, urls: urls.slice(0, 18) }
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error('evaluate timeout')) }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString())
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      const exception = message.result?.exceptionDetails
      if (exception) return reject(new Error(exception.exception?.description ?? exception.text ?? 'eval error'))
      resolve(message.result?.result?.value)
    })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')) })
  })
}

async function waitForRenderer(port) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      for (const target of targets.filter((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)) {
        try {
          if (await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`)) return target
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    await wait(300)
  }
  throw new Error('renderer not ready')
}

function copyProfile(dest) {
  const sourceProfile = join(process.env.APPDATA ?? '', 'quadra-multiview')
  mkdirSync(dest, { recursive: true })
  if (existsSync(join(sourceProfile, 'Local State'))) {
    try { cpSync(join(sourceProfile, 'Local State'), join(dest, 'Local State')) } catch { /* locked */ }
  }
  const partitionSrc = join(sourceProfile, 'Partitions', 'quadra')
  if (!existsSync(partitionSrc)) return
  const cacheRe = /[\\/](Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache)([\\/]|$)/
  try {
    cpSync(partitionSrc, join(dest, 'Partitions', 'quadra'), {
      recursive: true,
      filter: (src) => !cacheRe.test(src),
    })
  } catch (error) {
    console.warn('[live-feed-check] full profile copy failed, retrying without locked cookie files:', error.message)
    try {
      cpSync(partitionSrc, join(dest, 'Partitions', 'quadra'), {
        recursive: true,
        filter: (src) => !cacheRe.test(src) && !/[\\/](Cookies|Cookies-journal|Network Persistent State)([\\/]|$)/.test(src),
      })
    } catch (retryError) {
      console.warn('[live-feed-check] profile copy partial:', retryError.message)
    }
  }
}

function createPanelState(urls) {
  return urls.map((url, index) => ({
    slot: index,
    url,
    panelId: null,
    eventId: null,
    pairedAt: null,
    baselineAt: null,
    score: null,
    scoreHistory: [],
    alerts: [],
    reloads: 0,
    framesHint: 0,
  }))
}

function printTable(panels, startedAt) {
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(`\n--- live-feed-check @ ${elapsed}s ---`)
  console.log(
    'slot'.padEnd(5) +
    'eventId'.padEnd(12) +
    'pair(s)'.padEnd(9) +
    'score'.padEnd(8) +
    'alerts'.padEnd(8) +
    'reloads'.padEnd(9) +
    'baseline',
  )
  for (const panel of panels) {
    const pairSec = panel.pairedAt == null ? '-' : String(Math.round((panel.pairedAt - startedAt) / 1000))
    console.log(
      String(panel.slot).padEnd(5) +
      String(panel.eventId || 'sem ID').padEnd(12) +
      pairSec.padEnd(9) +
      String(panel.score || '-').padEnd(8) +
      String(panel.alerts.length).padEnd(8) +
      String(panel.reloads).padEnd(9) +
      (panel.baselineAt ? 'yes' : 'no'),
    )
  }
}

async function runElectron(urls, minutes, profile) {
  const port = 49000 + Math.floor(Math.random() * 1000)
  const panels = createPanelState(urls)
  let log = ''
  const childEnv = { ...process.env, QUADRA_TEST_USER_DATA: profile }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  })
  child.stdout.on('data', (chunk) => { log += chunk.toString() })
  child.stderr.on('data', (chunk) => { log += chunk.toString() })

  const startedAt = Date.now()
  const failures = []
  try {
    const target = await waitForRenderer(port)
    const count = Math.min(18, Math.max(1, urls.length))
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-count="${count}"]')?.click()`)
    await wait(800)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const urls = ${JSON.stringify(urls)}
      document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => {
        input.value = urls[index] || ''
      })
      document.querySelector('#btn-open-all')?.click()
    })()`)

    // Resolve panelIds from DOM after open.
    await wait(2000)
    const panelIds = await evaluate(target.webSocketDebuggerUrl, `([...document.querySelectorAll('.panel')].map((el) => el.dataset.panelId || el.getAttribute('data-panel-id')))`)
    if (Array.isArray(panelIds)) {
      for (let i = 0; i < panels.length; i += 1) panels[i].panelId = panelIds[i] || null
    }

    const deadline = startedAt + minutes * 60_000
    let lastTable = 0
    while (Date.now() < deadline) {
      for (const match of log.matchAll(/\[live-feed\] panel ([^\s]+) -> event (\d+)/g)) {
        const panel = panels.find((item) => item.panelId === match[1])
        if (!panel) continue
        if (!panel.eventId) {
          panel.eventId = match[2]
          panel.pairedAt = Date.now()
        }
      }
      for (const match of log.matchAll(/\[live-feed\] baseline event=(\d+) incidents=(\d+) score=([^\s]+)/g)) {
        const panel = panels.find((item) => item.eventId === match[1])
        if (!panel) continue
        panel.baselineAt = panel.baselineAt || Date.now()
        panel.framesHint += 1
        if (match[3] !== 'none') {
          panel.score = match[3]
          if (!panel.scoreHistory.includes(match[3])) panel.scoreHistory.push(match[3])
        }
      }
      for (const match of log.matchAll(/\[live-feed\] score event=(\d+) ([^\s]+)/g)) {
        const panel = panels.find((item) => item.eventId === match[1])
        if (!panel) continue
        panel.score = match[2]
        panel.framesHint += 1
        if (!panel.scoreHistory.includes(match[2])) panel.scoreHistory.push(match[2])
      }
      for (const match of log.matchAll(/\[live-feed\] alert panel=([^\s]+) event=(\d+) kind=([^\s]+) id=([^\s]+)/g)) {
        const panel = panels.find((item) => item.panelId === match[1] || item.eventId === match[2])
        if (!panel) continue
        const key = `${match[3]}:${match[4]}`
        if (!panel.alerts.some((alert) => alert.key === key)) {
          panel.alerts.push({ key, kind: match[3], incidentId: match[4], at: Date.now() })
        }
      }
      for (const match of log.matchAll(/\[live-feed\] reload (\d+) after/g)) {
        const panel = panels.find((item) => item.eventId === match[1])
        if (panel) panel.reloads += 1
      }
      // Reset reload counter inflation by recounting uniquely from log each loop — fix by using Set
      // Recompute reloads from scratch to avoid double-count.
      const reloadCounts = new Map()
      for (const match of log.matchAll(/\[live-feed\] reload (\d+) after/g)) {
        reloadCounts.set(match[1], (reloadCounts.get(match[1]) || 0) + 1)
      }
      for (const panel of panels) {
        panel.reloads = panel.eventId ? (reloadCounts.get(panel.eventId) || 0) : 0
      }

      if (Date.now() - lastTable > 30_000) {
        printTable(panels, startedAt)
        lastTable = Date.now()
      }
      await wait(1000)
    }

    printTable(panels, startedAt)

    // Failures
    for (const panel of panels) {
      if (!panel.eventId) {
        // May be a game without feed — warn but only fail if still probing past 60s with sports URL.
        console.warn(`[live-feed-check] slot ${panel.slot} sem eventId (jogo sem feed ou probe falhou)`)
        continue
      }
      if (!panel.pairedAt || panel.pairedAt - startedAt > 60_000) {
        failures.push(`slot ${panel.slot} paired too late or never (${panel.eventId})`)
      }
      if (!panel.baselineAt) {
        failures.push(`slot ${panel.slot} event ${panel.eventId} sem frames/baseline`)
      }
      // Score rose without goal alert: compare consecutive scores.
      for (let i = 1; i < panel.scoreHistory.length; i += 1) {
        const [prevHome, prevAway] = panel.scoreHistory[i - 1].split('-').map(Number)
        const [home, away] = panel.scoreHistory[i].split('-').map(Number)
        const rose = home > prevHome || away > prevAway
        if (!rose) continue
        const hasGoal = panel.alerts.some((alert) => alert.kind === 'goal')
        if (!hasGoal) {
          failures.push(`slot ${panel.slot} score ${panel.scoreHistory[i - 1]}→${panel.scoreHistory[i]} sem alerta GOL`)
        }
      }
    }

    return { failures, panels }
  } finally {
    if (child.exitCode === null) child.kill()
    await wait(500)
  }
}

async function main() {
  const { minutes, urls } = parseArgs(process.argv.slice(2))
  if (!urls.length) {
    console.error('Usage: node tests/live-feed-check.cjs [--minutes=10] <bll-view-url> [more...]')
    process.exit(2)
  }
  if (!existsSync(electronPath) || !existsSync(mainPath)) {
    console.error('Build the app first (npm run build).')
    process.exit(2)
  }

  const profile = mkdtempSync(join(tmpdir(), 'quadra-live-feed-check-'))
  copyProfile(profile)
  try {
    const { failures, panels } = await runElectron(urls, minutes, profile)
    const paired = panels.filter((panel) => panel.eventId).length
    console.log(`\npaired ${paired}/${panels.length}; failures=${failures.length}`)
    if (failures.length) {
      for (const failure of failures) console.error('FAIL:', failure)
      process.exitCode = 1
    } else {
      console.log('live-feed-check OK')
    }
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
