// Run: node tests/fullscreen-diagnostic.cjs
// --auto runs assertions; --scoped-topmost verifies the production priority policy.
// --overlay-fullscreen tests the rejected fullscreen-only alternative.
// Isolated manual Windows diagnostic. Close the test window to finish.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const automatic = process.argv.includes('--auto')
const prototype = process.argv.includes('--overlay-fullscreen')
const topmost = process.argv.includes('--scoped-topmost')
const output = path.join(root, 'artifacts/toolbar-checks', topmost ? 'fullscreen-topmost' : prototype ? 'fullscreen-prototype' : automatic ? 'fullscreen-automatic' : 'fullscreen-diagnostic')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(50)
  }
  throw new Error(`Timeout: ${label}`)
}

async function worker() {
  const { app, BaseWindow, BrowserWindow, desktopCapturer, screen, webContents } = require('electron')
  const { pathToFileURL } = require('node:url')
  fs.mkdirSync(output, { recursive: true })
  await import(pathToFileURL(path.join(root, 'out/main/main.js')).href)
  let overlay
  for (let attempt = 0; attempt < 200; attempt++) {
    overlay = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/renderer/index.html'))
    if (overlay && await overlay.webContents.executeJavaScript("Boolean(document.querySelector('.chooser'))").catch(() => false)) break
    await wait(100)
  }
  if (!overlay) throw new Error('Overlay did not load')
  const main = BaseWindow.getAllWindows().find((win) => win !== overlay)
  const pages = () => webContents.getAllWebContents().filter((page) => page.getURL().startsWith(process.env.QUADRA_DIAGNOSTIC_URL))
  if (prototype) {
    const setFullscreen = main.setFullScreen.bind(main)
    main.setFullScreen = (on) => {
      if (!on) overlay.setFullScreen(false)
      setFullscreen(on)
      if (on) overlay.setFullScreen(true)
    }
  }
  const logPath = path.join(output, 'events.jsonl')
  fs.writeFileSync(logPath, '')
  let sequence = 0
  let timer
  function state(event) {
    return { time: new Date().toISOString(), event,
      windows: [main, overlay].filter((win) => !win.isDestroyed()).map((win) => ({
        role: win === main ? 'main' : 'overlay', focused: win.isFocused(),
        fullscreen: win.isFullScreen(), topmost: win.isAlwaysOnTop(), bounds: win.getBounds(),
      })) }
  }
  async function capture(event) {
    if (overlay.isDestroyed()) return
    const snapshot = state(event)
    const name = `${String(++sequence).padStart(3, '0')}-${event.replace(/[^a-z0-9-]/gi, '-')}`
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    const display = screen.getDisplayMatching(main.getBounds())
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
    if (source) fs.writeFileSync(path.join(output, `${name}.png`), source.thumbnail.toPNG())
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(snapshot, null, 2))
    console.log(JSON.stringify({ capture: name, ...snapshot }))
  }
  function assertFullscreenPriority(label, expected) {
    if (!topmost) return
    assert.equal(main.isAlwaysOnTop(), expected, `${label}: main priority`)
    assert.equal(overlay.isAlwaysOnTop(), expected, `${label}: overlay priority`)
  }
  async function pressEscape(label, contents) {
    contents.focus()
    await wait(150)
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(() => !main.isFullScreen() && (!topmost || (!main.isAlwaysOnTop() && !overlay.isAlwaysOnTop())), `${label}: Escape leaves fullscreen`)
    assertFullscreenPriority(`${label} after Escape`, false)
    await capture(`escape-${label}`)
  }
  for (const [role, win] of [['main', main], ['overlay', overlay]]) {
    for (const event of ['focus', 'blur', 'enter-full-screen', 'leave-full-screen']) {
      win.on(event, () => {
        fs.appendFileSync(logPath, JSON.stringify(state(`${role}:${event}`)) + '\n')
        clearTimeout(timer)
        timer = setTimeout(() => capture(`${role}-${event}`).catch(console.error), 500)
      })
    }
  }
  overlay.webContents.on('console-message', ({ message }) => {
    if (!message?.startsWith('DIAGNOSTIC:')) return
    const label = message.slice(11)
    fs.appendFileSync(logPath, JSON.stringify(state(label)) + '\n')
    setTimeout(() => capture(label).catch(console.error), 700)
  })
  await overlay.webContents.executeJavaScript(`document.querySelector('[data-count="5"]').click()`)
  await overlay.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('input[name="url"]').forEach((input, i) => input.value = ${JSON.stringify(process.env.QUADRA_DIAGNOSTIC_URL)} + '?slot=' + i)
    document.querySelector('#btn-open-all').click()
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (button) console.log('DIAGNOSTIC:click-' + (button.id || button.textContent.trim()))
    }, true)
  })()`)
  await wait(1500)
  await capture('ready-five-videos')
  console.log('READY: use the window normally; screenshots and focus events are saved in ' + output)
  if (automatic) {
    const ui = (code) => overlay.webContents.executeJavaScript(code, true)
    const click = async (selector) => {
      overlay.focus()
      await ui(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await wait(900)
    }
    for (let round = 1; round <= 3; round++) {
      await click('#btn-fullscreen')
      assert.equal(main.isFullScreen(), true)
      main.focus()
      await wait(800)
      assertFullscreenPriority(`round ${round} video focus`, true)
      await capture(`round-${round}-video-focus`)
      await click('#btn-organize')
      assert.equal(await ui("Boolean(document.querySelector('.organize-panel'))"), true)
      assert.equal(main.isFullScreen(), true)
      assertFullscreenPriority(`round ${round} organizer`, true)
      await capture(`round-${round}-organizer`)
      await click('[data-organize-cancel]')
      await click('#btn-mute-all')
      assertFullscreenPriority(`round ${round} mute`, true)
      await capture(`round-${round}-mute`)
      await click('#btn-fullscreen')
      assert.equal(main.isFullScreen(), false)
      assertFullscreenPriority(`round ${round} windowed`, false)
      await capture(`round-${round}-windowed`)
    }
    await click('#btn-fullscreen')
    await click('#btn-add-panel')
    assert.equal(await ui("document.querySelectorAll('.panel').length"), 6)
    await ui("document.querySelectorAll('input[name=url]')[5].focus()")
    overlay.webContents.insertText(process.env.QUADRA_DIAGNOSTIC_URL)
    await wait(300)
    assert.equal(await ui("document.querySelectorAll('input[name=url]')[5].value"), process.env.QUADRA_DIAGNOSTIC_URL)
    await capture('sixth-panel-url-typed')
    await until(() => main.isFullScreen(), 're-enter fullscreen for toolbar Escape')
    await ui("document.querySelector('#btn-organize').focus()")
    await pressEscape('overlay-toolbar', overlay.webContents)
    await click('#btn-fullscreen')
    await until(() => main.isFullScreen(), 're-enter fullscreen for main Escape')
    main.focus()
    await wait(150)
    const focusedMainContents = webContents.getFocusedWebContents()
    assert.ok(focusedMainContents, 'main focus must resolve to a focused WebContents')
    await pressEscape('main', focusedMainContents)
    await click('#btn-fullscreen')
    await until(() => main.isFullScreen(), 're-enter fullscreen for panel Escape')
    const focusedPanel = pages()[0]
    assert.ok(focusedPanel, 'panel WebContents must be available for Escape')
    await pressEscape('panel', focusedPanel)
    await click('#btn-fullscreen')
    await until(() => main.isFullScreen(), 're-enter fullscreen after Escape checks')
    await ui("document.querySelectorAll('input[name=url]')[5].blur(); document.dispatchEvent(new MouseEvent('mousemove', {clientX:400,clientY:300,bubbles:true}))")
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 400, y: 300 })
    main.focus()
    await wait(11500)
    const idle = await ui(`({ hidden: !document.querySelector('.grid-shell').classList.contains('is-toolbar-visible'),
      protectedUi: document.querySelector('.toolbar:hover, .toolbar__menu:not([hidden]), .organize-panel, .confirm')?.className ?? null })`)
    console.log('IDLE ' + JSON.stringify(idle))
    assert.equal(idle.hidden, true, JSON.stringify(idle))
    assertFullscreenPriority('toolbar idle hidden', true)
    await capture('toolbar-idle-hidden')
    await ui("document.dispatchEvent(new MouseEvent('mousemove', {clientX:500,clientY:300,bubbles:true}))")
    await click('#btn-organize')
    assert.equal(main.isFullScreen(), true)
    assertFullscreenPriority('organizer after idle', true)
    await capture('organizer-after-idle')
    if (topmost) {
      const other = new BrowserWindow({ width: 640, height: 400, title: 'Quadra diagnostic - other window' })
      await other.loadURL('data:text/html,<h1>Other window focus test</h1>')
      other.focus()
      await wait(900)
      assert.equal(other.isFocused(), true)
      assertFullscreenPriority('external window', false)
      await capture('external-window-priority-released')
      other.close()
      main.focus()
      await wait(900)
      assertFullscreenPriority('returned focus', true)
      await capture('return-priority-restored')
      main.minimize()
      await wait(900)
      assert.equal(main.isAlwaysOnTop(), false)
      assert.equal(overlay.isAlwaysOnTop(), false)
      main.restore()
      main.focus()
      await wait(900)
      assert.equal(main.isFullScreen(), true)
      assertFullscreenPriority('restored after minimize', true)
      await capture('restored-after-minimize')
    }
    console.log('PASS: three fullscreen cycles, native focus transitions, organizer, mute, sixth panel, URL typing, idle/reveal. Taskbar requires screenshot review.')
    app.quit()
  }
}

async function parent() {
  const http = require('node:http')
  const { spawn } = require('node:child_process')
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><style>html,body{margin:0;background:#103cb0}video{width:100vw;height:100vh}</style>
      <video autoplay muted playsinline></video><canvas hidden width="640" height="360"></canvas><script>
      const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
      setInterval(()=>{context.fillStyle='#103cb0';context.fillRect(0,0,640,360);context.fillStyle='white';context.font='28px sans-serif';context.fillText('VIDEO '+location.search+' '+Date.now(),20,180)},100);
      document.querySelector('video').srcObject=canvas.captureStream(10);
      </script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const env = { ...process.env, QUADRA_TEST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-fullscreen-')),
    QUADRA_DIAGNOSTIC_URL: `http://127.0.0.1:${server.address().port}/video` }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--worker', ...(automatic ? ['--auto'] : []), ...(prototype ? ['--overlay-fullscreen'] : []), ...(topmost ? ['--scoped-topmost'] : [])], { env, windowsHide: true, stdio: 'inherit' })
  child.once('exit', (code) => { server.close(); process.exitCode = code ?? 1 })
  child.once('error', (error) => { console.error(error); server.close(); process.exitCode = 1 })
}

if (process.argv.includes('--worker')) worker().catch((error) => { console.error(error); require('electron').app.exit(1) })
else parent().catch((error) => { console.error(error); process.exitCode = 1 })
