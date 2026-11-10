// Idle screen: with nobody touching the mouse, the screen stays clean (no toolbar, panel controls or cursor),
// even when a goal re-arranges the grid, and the hidden cursor also covers players in iframes and pages with
// their own `!important` cursor rules.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(50)
  }
  throw new Error(`Timeout: ${label}`)
}

async function worker() {
  const { app, BaseWindow, BrowserWindow, webContents } = require('electron')
  const fail = (error) => { console.error(error.stack || error); app.exit(1) }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND')
  await import(pathToFileURL(path.join(root, 'out/main/main.js')).href)
  let overlay
  await until(() => {
    overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/renderer/index.html'))
    return overlay
  }, 'overlay')
  const ui = (expression) => overlay.webContents.executeJavaScript(expression, true)
  await until(() => ui("Boolean(document.querySelector('.chooser'))"), 'chooser')
  const main = BaseWindow.getAllWindows().find((win) => win !== overlay)
  const base = process.env.QUADRA_IDLE_URL
  const urls = [`${base}/plain`, `${base}/important`, `${base}/frame-host`]
  const page = (url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)
  const screenState = () => ui(`({
    toolbar: document.querySelector('.grid-shell').classList.contains('is-toolbar-visible'),
    cursorHidden: document.body.classList.contains('is-cursor-hidden'),
    controls: [...document.querySelectorAll('.panel__controls')].filter((controls) => getComputedStyle(controls).opacity !== '0').length,
  })`)

  await ui(`document.querySelector('.chooser__card[data-count="3"]').click()`)
  await until(() => ui(`document.querySelectorAll('.panel').length === 3`), 'grid of 3')
  await ui(`(() => {
    document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => { input.value = ${JSON.stringify(urls)}[index] })
    document.querySelector('#btn-open-all').click()
  })()`)
  await until(() => urls.every((url) => page(url)), 'player pages')
  const frameHost = page(urls[2])
  await until(() => frameHost.mainFrame.frames.length === 1 && frameHost.mainFrame.frames[0].url.endsWith('/inner'), 'cross-origin iframe')
  assert.equal(await ui(`document.querySelector('.grid-shell').classList.contains('is-toolbar-visible')`), true, 'Entering the grid shows the toolbar')

  // A click on a Quadra button leaves the focus on the overlay: the idle screen must hand it back to the players.
  overlay.focus()
  await wait(200)
  const overlayHadFocus = overlay.isFocused()

  // No input at all: the toolbar, the panel controls and the cursor go away.
  await until(async () => !(await screenState()).toolbar, 'idle toolbar hide', 12000)
  // The controls fade out with a short CSS transition.
  await until(async () => (await screenState()).controls === 0, 'panel controls faded out', 3000).catch(() => {})
  assert.deepEqual(await screenState(), { toolbar: false, cursorHidden: true, controls: 0 }, 'Idle screen is clean')
  if (overlayHadFocus) {
    await until(() => !overlay.isFocused(), 'players get the focus back when idle')
    assert.equal(main.isFocused() || webContents.getAllWebContents().some((contents) => urls.includes(contents.getURL()) && contents.isFocused()), true,
      'The players window takes the focus, so Chromium can hide a still cursor')
  } else {
    console.log('SKIP focus hand-back: the test window is not in the foreground')
  }

  // The hidden cursor beats the page's own `!important` rule and reaches the player's iframe.
  const cursors = async () => ({
    plain: await page(urls[0]).executeJavaScript(`getComputedStyle(document.querySelector('canvas')).cursor`),
    important: await page(urls[1]).executeJavaScript(`getComputedStyle(document.querySelector('canvas')).cursor`),
    iframe: await frameHost.mainFrame.frames[0].executeJavaScript(`getComputedStyle(document.querySelector('canvas')).cursor`),
  })
  await until(async () => Object.values(await cursors()).every((cursor) => cursor === 'none'), 'hidden cursor in every frame', 5000)
    .catch(async (error) => { throw new Error(`${error.message}: ${JSON.stringify(await cursors())}`) })

  // A frame that loads while the cursor is hidden gets the rule too.
  await frameHost.executeJavaScript(`(() => { const frame = document.querySelector('iframe'); frame.src = frame.src.replace('/inner', '/inner?again=1') })()`)
  await until(() => frameHost.mainFrame.frames[0]?.url.includes('again=1'), 'reloaded iframe')
  await until(async () => (await frameHost.mainFrame.frames[0].executeJavaScript(`document.readyState === 'complete' && getComputedStyle(document.querySelector('canvas')).cursor`).catch(() => '')) === 'none',
    'hidden cursor in a newly loaded iframe', 5000)

  // A goal re-arranges the grid without bringing the controls back.
  const goalPanel = await ui(`document.querySelector('.panel[data-slot="1"]').dataset.panelId`)
  overlay.webContents.send('quadra:match-event', { panelId: goalPanel, kind: 'goal', teamName: 'Time A', minute: 12, score: '1 - 0', ownGoal: false, team: 'home', label: 'Time A x Time B', eventId: 'idle-goal-1' })
  await until(() => ui(`document.querySelector('.panel[data-slot="1"]').classList.contains('is-highlighted')`), 'goal highlight')
  await wait(300)
  assert.deepEqual(await screenState(), { toolbar: false, cursorHidden: true, controls: 0 }, 'A goal keeps the idle screen clean')
  assert.equal(await ui(`Boolean(document.querySelector('.panel[data-slot="1"] .panel__alert'))`), true, 'The goal alert still shows')
  assert.equal(await ui(`Boolean(document.querySelector('.panel[data-slot="1"] .panel__auto-controls'))`), true, 'The goal highlight keeps its own buttons')

  // Back to the layout before the goal, still clean.
  await ui(`document.querySelector('.panel[data-slot="1"] [data-auto-back]').click()`)
  await until(() => ui(`!document.querySelector('.panel__auto-controls')`), 'goal highlight released')
  await wait(300)
  assert.equal((await screenState()).toolbar, false, 'Leaving the goal highlight keeps the toolbar hidden')

  // Real input brings everything back.
  overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift' })
  overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' })
  await until(async () => (await screenState()).toolbar, 'toolbar back on input')
  const shown = await screenState()
  assert.equal(shown.cursorHidden, false, 'Input shows the cursor again')
  await until(async () => (await cursors()).iframe !== 'none', 'cursor rule removed from the iframe', 5000)
  await until(async () => (await cursors()).important !== 'none', 'cursor rule removed from the page', 5000)
  assert.equal((await cursors()).important, 'pointer', 'With the cursor shown the page keeps its own cursor rule')

  console.log('PASS idle screen: clean after idle and on a goal, hidden cursor in iframes and over !important rules')
  app.quit()
}

async function parent() {
  const http = require('node:http')
  const { spawn } = require('node:child_process')
  const canvas = `<canvas width="320" height="180" style="display:block;width:100vw;height:100vh"></canvas>
    <script>const c = document.querySelector('canvas').getContext('2d'); setInterval(() => { c.fillStyle = '#103cb0'; c.fillRect(0, 0, 320, 180) }, 100)</script>`
  const server = http.createServer((request, res) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (url.pathname === '/important') return res.end(`<!doctype html><style>body{margin:0} html body canvas{cursor:pointer!important}</style>${canvas}`)
    if (url.pathname === '/frame-host') {
      // localhost vs 127.0.0.1: a cross-origin (out-of-process) iframe, as many embedded players are.
      return res.end(`<!doctype html><style>body{margin:0}iframe{display:block;border:0;width:100vw;height:100vh}</style><iframe src="http://localhost:${server.address().port}/inner"></iframe>`)
    }
    return res.end(`<!doctype html><style>body{margin:0}</style>${canvas}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-idle-'))
  const env = { ...process.env, QUADRA_TEST_USER_DATA: userData, QUADRA_IDLE_URL: `http://127.0.0.1:${server.address().port}` }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--worker'], { env, windowsHide: true, stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 120000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    assert.equal(code, 0, 'Idle screen smoke failed')
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
    await new Promise((resolve) => server.close(resolve))
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt++) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await wait(250) }
    }
  }
}

if (process.argv.includes('--worker')) worker().catch((error) => { console.error(error); require('electron').app.exit(1) })
else parent().catch((error) => { console.error(error); process.exitCode = 1 })
