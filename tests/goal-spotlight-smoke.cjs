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

async function waitForPageTarget(port, predicate) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json`).catch(() => [])
    const target = targets.find((candidate) => candidate.type === 'page' && predicate(candidate))
    if (target) return target
    await wait(250)
  }
  return null
}

async function waitForExpression(target, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(target.webSocketDebuggerUrl, expression).catch(() => false)) return
    await wait(50)
  }
  throw new Error(`Timeout aguardando expressão: ${expression}`)
}

async function openBllGameOnSixPanels(target, port) {
  await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-count="6"]').click()`)
  await waitForExpression(target, `Boolean(document.querySelector('.panel[data-slot="0"] [data-bllsport]'))`)
  await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] [data-bllsport]').click()`)
  const bllCatalog = await waitForPageTarget(port, (candidate) => candidate.url.includes('/bll/'))
  assert.ok(bllCatalog, 'O catálogo BLL não abriu.')
  await waitForExpression(bllCatalog, `Boolean(document.querySelector('#game-a'))`)
  await evaluate(bllCatalog.webSocketDebuggerUrl, `document.querySelector('#game-a').click()`)
  const player = await waitForPageTarget(port, (candidate) => candidate.url.includes('/view/game-a'))
  assert.ok(player, 'O player BLL não foi direcionado ao painel.')
  await waitForExpression(target, `document.querySelector('.panel[data-slot="0"]').classList.contains('panel--loaded')`)
  return player
}

async function waitForSpotlight(target) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const state = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      const stage = document.querySelector('#layout-stage')
      return {
        highlighted: Boolean(panel?.classList.contains('is-highlighted')),
        mode: stage?.dataset.layoutMode ?? null,
        hasBadge: Boolean(panel?.querySelector('.panel__spotlight')),
        badgeText: panel?.querySelector('.panel__spotlight-title')?.textContent ?? null,
        highlightedCount: document.querySelectorAll('.panel.is-highlighted').length,
      }
    })()`).catch(() => null)
    if (state?.highlighted && state.hasBadge) return state
    await wait(250)
  }
  throw new Error('Timeout aguardando destaque automático no gol.')
}

async function run() {
  assert.ok(fs.existsSync(electronPath), 'Electron não encontrado.')
  assert.ok(fs.existsSync(mainPath), 'Bundle main não encontrado; execute npm run build.')

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-spotlight-smoke-'))
  const port = 48000 + Math.floor(Math.random() * 1000)
  const feed = await startBllFeedServer()
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...childEnv,
      QUADRA_TEST_USER_DATA: userData,
      QUADRA_BLLSPORT_URL: `${feed.baseUrl}/bll/`,
      QUADRA_FEED_SCOREBOARD_URL: `${feed.baseUrl}/scoreboard/?eventId={eventId}&sport=football&locale=pt-pt`,
    },
  })

  try {
    const target = await waitForRendererTarget(port)
    const player = await openBllGameOnSixPanels(target, port)
    const playerId = player.id

    // Promote on first goal, then revert.
    const spotlight = await waitForSpotlight(target)
    assert.equal(spotlight.highlighted, true)
    assert.equal(spotlight.mode, 'highlights')
    assert.equal(spotlight.hasBadge, true)
    assert.match(spotlight.badgeText ?? '', /Destaque automático/)
    assert.equal(spotlight.highlightedCount, 1)

    const pagesAfterSpotlight = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.type === 'page' && candidate.url.includes('/view/game-a'))
    assert.equal(pagesAfterSpotlight.length, 1)
    assert.equal(pagesAfterSpotlight[0].id, playerId, 'O destaque automático não pode recriar o WebContents.')

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-spotlight-revert]').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel.is-highlighted').length === 0 && !document.querySelector('.panel__spotlight')`)
    const afterRevert = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      highlighted: document.querySelectorAll('.panel.is-highlighted').length,
      mode: document.querySelector('#layout-stage')?.dataset.layoutMode ?? null,
      badge: Boolean(document.querySelector('.panel__spotlight')),
    }))()`)
    assert.equal(afterRevert.highlighted, 0)
    assert.ok(afterRevert.mode === 'equal' || afterRevert.mode === 'auto', `mode after revert: ${afterRevert.mode}`)
    assert.equal(afterRevert.badge, false)

    // Second goal from the fixture → spotlight again → Fixar → Desfazer.
    const spotlight2 = await waitForSpotlight(target)
    assert.equal(spotlight2.highlighted, true)
    assert.equal(spotlight2.hasBadge, true)

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-spotlight-pin]').click()`)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="0"]').classList.contains('is-highlighted') && !document.querySelector('.panel__spotlight')`)
    const afterPin = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      highlighted: document.querySelector('.panel[data-slot="0"]').classList.contains('is-highlighted'),
      badge: Boolean(document.querySelector('.panel__spotlight')),
      mode: document.querySelector('#layout-stage')?.dataset.layoutMode ?? null,
    }))()`)
    assert.equal(afterPin.highlighted, true)
    assert.equal(afterPin.badge, false)
    assert.equal(afterPin.mode, 'highlights')

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-more').click()`)
    await waitForExpression(target, `!document.querySelector('#toolbar-more-menu')?.hidden`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-undo').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel.is-highlighted').length === 0`)
    const afterUndo = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      highlighted: document.querySelectorAll('.panel.is-highlighted').length,
      mode: document.querySelector('#layout-stage')?.dataset.layoutMode ?? null,
    }))()`)
    assert.equal(afterUndo.highlighted, 0)
    assert.ok(afterUndo.mode === 'equal' || afterUndo.mode === 'auto', `mode after undo: ${afterUndo.mode}`)

    const pagesAfterPin = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.type === 'page' && candidate.url.includes('/view/game-a'))
    assert.equal(pagesAfterPin.some((page) => page.id === playerId), true, 'Fixar/Desfazer não pode recriar o WebContents.')

    process.stdout.write(JSON.stringify({
      spotlightPromote: true,
      spotlightRevert: true,
      spotlightPin: true,
      spotlightUndo: true,
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
