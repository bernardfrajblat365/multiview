const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { createSportsPlayerFixture } = require('./sports-player-fixture.cjs')

const projectRoot = path.resolve(__dirname, '..')
const expectedAppVersion = `v${require('../package.json').version}`

function findPackagedExecutable() {
  if (process.env.QUADRA_PACKAGED_EXE) return process.env.QUADRA_PACKAGED_EXE
  return path.join(projectRoot, 'release', 'win-unpacked', 'Quadra.exe')
}

const executablePath = findPackagedExecutable()

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} while requesting ${url}`)
  return response.json()
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timeout ao avaliar a UI empacotada.'))
    }, 10000)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString())
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      const exception = message.result?.exceptionDetails
      if (exception) return reject(new Error(exception.text ?? 'Erro na UI empacotada.'))
      resolve(message.result?.result?.value)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket da UI empacotada encerrou inesperadamente.'))
    })
  })
}

async function waitForRendererTarget(port) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      for (const target of targets) {
        if (target.type !== 'page' || !target.webSocketDebuggerUrl) continue
        try {
          if (await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`)) return target
        } catch {
          // A target pode existir antes de terminar o carregamento.
        }
      }
    } catch {
      // O executável ainda pode estar iniciando.
    }
    await wait(250)
  }
  throw new Error('A UI do executável empacotado não apareceu no DevTools Protocol.')
}

async function waitForExpression(target, expression) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluate(target.webSocketDebuggerUrl, expression).catch(() => false)) return
    await wait(100)
  }
  throw new Error(`Timeout aguardando expressÃ£o empacotada: ${expression}`)
}

async function run() {
  assert.ok(fs.existsSync(executablePath), `Executável empacotado não encontrado: ${executablePath}`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-packaged-smoke-'))
  const port = 47000 + Math.floor(Math.random() * 1000)
  const fixtureServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const fixture = createSportsPlayerFixture(requestUrl)
    if (fixture) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(fixture)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Sports player packaged fixture</title>')
  })
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject)
    fixtureServer.listen(0, '127.0.0.1', resolve)
  })
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    windowsHide: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...childEnv, QUADRA_TEST_USER_DATA: userData, QUADRA_BLLSPORT_URL: `${fixtureOrigin}/bll/` },
  })

  try {
    const target = await waitForRendererTarget(port)
    const assertToolbar = async () => {
      const visible = await evaluate(target.webSocketDebuggerUrl, `(() => {
        const toolbar = document.querySelector('.toolbar')
        if (!toolbar || getComputedStyle(toolbar).opacity !== '1') return false
        return [...toolbar.querySelectorAll('button, select')].filter(el => !el.closest('[hidden]')).every(el => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight &&
            el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
        })
      })()`)
      assert.equal(visible, true, 'A toolbar empacotada deve ficar inteira e acima dos painéis.')
    }
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.app-version')?.textContent`), expectedAppVersion)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)
    const grid = await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('[data-count="16"]').click()
      return {
        className: document.querySelector('.grid')?.className ?? '',
        panelCount: document.querySelectorAll('.panel').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth ||
          document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }
    })()`)
    assert.match(grid.className, /grid--16/)
    assert.equal(grid.panelCount, 16)
    assert.equal(grid.overflow, false)
    await assertToolbar()
    const removal = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const removed = document.querySelector('.panel[data-slot="7"]')
      const removedId = removed.dataset.panelId
      removed.querySelector('[data-remove]').click()
      return {
        count: document.querySelectorAll('.panel').length,
        removed: !document.querySelector('[data-panel-id="' + removedId + '"]'),
        mode: document.querySelector('.layout-stage').dataset.layoutMode,
      }
    })()`)
    assert.deepEqual(removal, { count: 15, removed: true, mode: 'auto' })
    await assertToolbar()

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click()`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.confirm [data-ok]').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-start-one').click()`)
    await assertToolbar()
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click()`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.confirm [data-ok]').click()`)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('[data-count="3"]').click()
      document.querySelector('#btn-organize').click()
      document.querySelector('[data-composition="1"]').click()
      document.querySelector('[data-organizer-aliases~="top"]').click()
      document.querySelector('[data-organize-apply]').click()
      const base = ${JSON.stringify(fixtureOrigin)}
      document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => {
        input.value = base + '/view/sports?fixture=sports&ratio=4x3&player=openvidu&slot=' + index
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      document.querySelector('#btn-open-all').click()
    })()`)
    const sportsDeadline = Date.now() + 15000
    let sportsTargets = []
    while (Date.now() < sportsDeadline) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      sportsTargets = targets.filter((candidate) => candidate.type === 'page' &&
        candidate.url.includes(`${fixtureOrigin}/view/sports`) && candidate.url.includes('fixture=sports'))
      if (sportsTargets.length === 3) break
      await wait(100)
    }
    assert.equal(sportsTargets.length, 3, 'O executável empacotado não abriu os três players esportivos.')
    for (const sportsTarget of sportsTargets) {
      await waitForExpression(sportsTarget, `(() => {
        const video = [...document.querySelectorAll('video')].find((candidate) => candidate.videoWidth > 0)
        return document.readyState === 'complete' && Boolean(video && !video.paused && video.srcObject?.active)
      })()`)
      const metrics = await evaluate(sportsTarget.webSocketDebuggerUrl, `(() => {
        const video = [...document.querySelectorAll('video')].find((candidate) => candidate.videoWidth > 0)
        if (!video) return null
        const rect = video.getBoundingClientRect()
        const style = getComputedStyle(video)
        const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
        const rendered = { width: video.videoWidth * scale, height: video.videoHeight * scale }
        return { viewport: { width: innerWidth, height: innerHeight }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          intrinsic: { width: video.videoWidth, height: video.videoHeight }, fit: style.objectFit, position: style.objectPosition,
          paused: video.paused, rendered }
      })()`)
      assert.ok(metrics && metrics.intrinsic.width > 0 && metrics.intrinsic.height > 0, 'Player esportivo empacotado sem dimensões intrínsecas.')
      assert.equal(metrics.fit, 'contain')
      assert.equal(metrics.position, '50% 50%')
      assert.equal(metrics.paused, false)
      assert.ok(metrics.rect.x >= -2 && metrics.rect.y >= -2 &&
        metrics.rect.x + metrics.rect.width <= metrics.viewport.width + 2 &&
        metrics.rect.y + metrics.rect.height <= metrics.viewport.height + 2,
      `Player esportivo empacotado excedeu o viewport: ${JSON.stringify(metrics)}`)
      assert.ok(Math.abs(metrics.rect.width - metrics.viewport.width) <= 2 && Math.abs(metrics.rect.height - metrics.viewport.height) <= 2,
        `Player esportivo empacotado não ocupou o painel: ${JSON.stringify(metrics)}`)
      assert.ok(Math.abs(metrics.rendered.width - metrics.rect.width) <= 2 || Math.abs(metrics.rendered.height - metrics.rect.height) <= 2,
        `Player esportivo empacotado não maximizou a imagem: ${JSON.stringify(metrics)}`)
    }
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click()`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.confirm [data-ok]').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.chooser'))`)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('[data-count="2"]').click()
      const form = document.querySelector('.panel[data-slot="0"] .panel__bar')
      form.querySelector('input[name="url"]').value = 'https://example.com/packaged'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`)
    const targetDeadline = Date.now() + 10000
    let commonPage = false
    while (Date.now() < targetDeadline) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      commonPage = targets.some((candidate) => candidate.type === 'page' && candidate.url.includes('example.com/packaged'))
      if (commonPage) break
      await wait(250)
    }
    assert.equal(commonPage, true, 'O executável empacotado não criou o WebContentsView comum.')
    const transparentPanel = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const stage = document.querySelector('[data-stage]')
      if (!stage || getComputedStyle(document.documentElement).colorScheme !== 'normal') return false
      for (let element = stage; element; element = element.parentElement) {
        const style = getComputedStyle(element)
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none') return false
      }
      return true
    })()`)
    assert.equal(transparentPanel, true, 'A interface empacotada encobre o conteúdo do painel.')
    await assertToolbar()
    process.stdout.write(JSON.stringify({ executable: executablePath, version: expectedAppVersion, grid16: true, chooserReturn: true, electronView: true }) + '\n')
  } finally {
    if (child.exitCode === null) {
      child.kill()
      if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    }
    await new Promise((resolve) => fixtureServer.close(resolve))
    await wait(1200)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try {
        fs.rmSync(userData, { recursive: true, force: true })
      } catch {
        await wait(250)
      }
    }
    if (fs.existsSync(userData)) throw new Error('userData temporário do smoke empacotado não foi liberado.')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
