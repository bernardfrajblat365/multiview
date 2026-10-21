const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { FEED_EVENT_ID, startBllFeedServer } = require('./fixtures/bll-feed-server.cjs')

const projectRoot = path.resolve(__dirname, '..')
const expectedAppVersion = `v${require('../package.json').version}`
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

async function run() {
  assert.ok(fs.existsSync(electronPath), 'Electron não encontrado.')
  assert.ok(fs.existsSync(mainPath), 'Bundle main não encontrado; execute npm run build.')

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-app-integration-'))
  const port = 46000 + Math.floor(Math.random() * 1000)
  const feed = await startBllFeedServer({
    handleExtraRequest(request, response) {
      const title = request.url?.startsWith('/blocked') ? 'Quadra Blocked Page' : 'Quadra Integration Page'
      if (request.url?.startsWith('/blocked')) response.setHeader('X-Frame-Options', 'DENY')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>${title}</title><button id="click-target">Page</button>`)
      return true
    },
  })
  const { baseUrl } = feed
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false, stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...childEnv,
      QUADRA_TEST_USER_DATA: userData,
      QUADRA_BLLSPORT_URL: `${baseUrl}/bll/`,
      QUADRA_FEED_SCOREBOARD_URL: `${baseUrl}/scoreboard/?eventId={eventId}&sport=football&locale=pt-pt`,
    },
  })
  try {
    const target = await waitForRendererTarget(port)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.app-version')?.textContent`), expectedAppVersion)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-count="2"]').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.panel[data-slot="0"] [data-bllsport]'))`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] [data-bllsport]').click()`)
    const bllCatalog = await waitForPageTarget(port, (candidate) => candidate.url.includes('/bll/'))
    if (!bllCatalog) {
      const pages = (await fetchJson(`http://127.0.0.1:${port}/json`).catch(() => []))
        .filter((candidate) => candidate.type === 'page')
        .map((candidate) => candidate.url)
      assert.fail(`O catálogo BLL não abriu. Páginas: ${JSON.stringify(pages)}`)
    }
    await waitForExpression(bllCatalog, `Boolean(document.querySelector('#game-a'))`)
    await evaluate(bllCatalog.webSocketDebuggerUrl, `document.querySelector('#game-a').click()`)
    const firstBllPlayer = await waitForPageTarget(port, (candidate) => candidate.url.includes('/view/game-a'))
    assert.ok(firstBllPlayer, 'O primeiro player BLL não foi direcionado ao painel.')
    const firstBllState = await evaluate(target.webSocketDebuggerUrl, `(() => ({
      loaded: document.querySelector('.panel[data-slot="0"]').classList.contains('panel--loaded'),
      nextTarget: document.querySelector('.panel[data-slot="1"] [data-bllsport]').classList.contains('is-target'),
      url: document.querySelector('.panel[data-slot="0"] input[name="url"]').value,
    }))()`)
    assert.equal(firstBllState.loaded, true)
    assert.equal(firstBllState.nextTarget, true)
    assert.ok(firstBllState.url.includes('/view/game-a'))
    assert.equal(new URL(firstBllState.url).searchParams.get('canal'), '2')
    assert.equal(new URL(firstBllState.url).searchParams.get('view'), 'clean')

    const firstPlayerId = firstBllPlayer.id
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset.label === 'Time A x Time B'`)
    const labelBeforeSwap = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      const label = panel.querySelector('.panel__label')
      return {
        panelId: panel.dataset.panelId,
        label: label?.dataset.label ?? null,
        mode: label?.dataset.mode ?? null,
        hasDismiss: Boolean(label?.querySelector('[data-dismiss-label]')),
      }
    })()`)
    assert.equal(labelBeforeSwap.label, 'Time A x Time B')
    assert.ok(labelBeforeSwap.mode, 'O rótulo precisa ter um modo de posicionamento.')
    assert.equal(labelBeforeSwap.hasDismiss, true, 'O rótulo precisa ter um X para ocultar.')
    assert.equal(firstBllPlayer.id, firstPlayerId, 'A chegada do título não pode recriar o WebContents do painel.')

    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="0"].panel--alert[data-alert-kind="goal"]')`,
      20000)
    const alertState = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      const badge = panel.querySelector('.panel__alert')
      return {
        kind: panel.dataset.alertKind ?? null,
        text: badge?.textContent ?? null,
      }
    })()`)
    assert.deepEqual(alertState, { kind: 'goal', text: 'Gol - fora' })

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] [data-dismiss-label]').click()`)
    await waitForExpression(target, `!document.querySelector('.panel[data-slot="0"] .panel__label')`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const form = document.querySelector('.panel[data-slot="0"] [data-panel-form]')
      form.requestSubmit()
    })()`)
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset.label === 'Time A x Time B'`,
      12000)

    await evaluate(bllCatalog.webSocketDebuggerUrl, `document.querySelector('#game-b').click()`)
    const secondBllPlayer = await waitForPageTarget(port, (candidate) => candidate.url.includes('/view/game-b'))
    assert.ok(secondBllPlayer, 'O segundo player BLL não foi direcionado ao painel seguinte.')
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] input[name="url"]').value.includes('/view/game-b')`)
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.label === 'Time C x Time D'`)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const source = document.querySelector('.panel[data-slot="0"]')
      const targetPanel = document.querySelector('.panel[data-slot="1"]')
      const handle = source.querySelector('[data-drag]')
      const from = handle.getBoundingClientRect()
      const to = targetPanel.getBoundingClientRect()
      const startX = from.left + from.width / 2
      const startY = from.top + from.height / 2
      const endX = to.left + to.width / 2
      const endY = to.top + to.height / 2
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: startX, clientY: startY, buttons: 1 }))
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: startX + 20, clientY: startY + 20, buttons: 1 }))
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: endX, clientY: endY, buttons: 1 }))
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: endX, clientY: endY }))
    })()`)
    await waitForExpression(target, `(() => {
      const panel = document.querySelector('[data-panel-id="${labelBeforeSwap.panelId}"]')
      return panel?.querySelector('.panel__label')?.dataset.label === 'Time A x Time B'
        && panel.querySelector('input[name="url"]')?.value.includes('/view/game-a')
    })()`)
    assert.equal(
      (await fetchJson(`http://127.0.0.1:${port}/json`)).some((candidate) => candidate.id === firstPlayerId),
      true,
      'Trocar posição não pode destruir o WebContents do jogo.',
    )

    const idsBeforeBlockedReplacement = [firstBllPlayer.id, secondBllPlayer.id].sort()
    await evaluate(bllCatalog.webSocketDebuggerUrl, `document.querySelector('#game-a').click()`)
    await wait(150)
    const idsAfterBlockedReplacement = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.url.includes('/view/game-')).map((candidate) => candidate.id).sort()
    assert.deepEqual(idsAfterBlockedReplacement, idsBeforeBlockedReplacement,
      'Um clique sem painel selecionado substituiu um jogo existente.')

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.panel[data-slot="0"] [data-edit]').click()
      document.querySelector('.panel[data-slot="0"] [data-bllsport]').click()
    })()`)
    await evaluate(bllCatalog.webSocketDebuggerUrl, `document.querySelector('#game-b').click()`)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="0"] input[name="url"]').value.includes('/view/game-b')`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl,
      `document.querySelector('.panel[data-slot="1"] input[name="url"]').value.includes('/view/game-b')`), true,
    'A substituição explícita alterou o painel errado.')
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-more').click()
      document.querySelector('#btn-match-labels').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.panel__label').length === 0`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-more').click()
      document.querySelector('#btn-match-labels').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.panel__label').length >= 1`)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-more').click()
      document.querySelector('#btn-clear-all').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.panel__label').length === 0`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-layout').click()
      document.querySelector('.confirm [data-ok]').click()
    })()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)

    const opened = await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-start-one').click()
      let form = document.querySelector('.panel[data-slot="0"] .panel__bar')
      form.querySelector('input[name="url"]').value = ${JSON.stringify(baseUrl + '/page?slot=0')}
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      document.querySelector('#btn-add-panel').click()
      form = document.querySelector('.panel[data-slot="1"] .panel__bar')
      form.querySelector('input[name="url"]').value = ${JSON.stringify(baseUrl + '/page?slot=1')}
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return {
        grid: Boolean(document.querySelector('.grid--2')),
        panelCount: document.querySelectorAll('.panel').length,
        hasBackendControl: Boolean(document.querySelector('.panel select')),
      }
    })()`)
    assert.deepEqual(opened, { grid: true, panelCount: 2, hasBackendControl: false })

    const pages = []
    for (let index = 0; index < 2; index += 1) {
      const page = await waitForPageTarget(port, (candidate) => candidate.url.includes(`/page?slot=${index}`))
      assert.ok(page, `Painel ${index + 1} não criou um WebContentsView.`)
      pages.push(page)
    }
    assert.equal(pages.length, 2)
    const stablePageIds = pages.map((page) => page.id)
    const overlayBackgrounds = await evaluate(target.webSocketDebuggerUrl, `(() => {
      return [...document.querySelectorAll('[data-stage]')].map((stage) => {
        const backgrounds = []
        for (let element = stage; element; element = element.parentElement) {
          const style = getComputedStyle(element)
          backgrounds.push({ element: element.tagName + '.' + element.className,
            color: style.backgroundColor, image: style.backgroundImage })
        }
        return backgrounds
      })
    })()`)
    assert.equal(overlayBackgrounds.length, 2)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `getComputedStyle(document.documentElement).colorScheme`), 'normal')
    for (const backgrounds of overlayBackgrounds) {
      for (const background of backgrounds) {
        assert.equal(background.color, 'rgba(0, 0, 0, 0)', `${background.element} encobre o conteúdo do painel.`)
        assert.equal(background.image, 'none', `${background.element} pinta sobre o conteúdo do painel.`)
      }
    }
    const audioControls = await evaluate(target.webSocketDebuggerUrl, `(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 100))
      const buttons = () => [...document.querySelectorAll('[data-mute]')]
      const muted = (button) => button.getAttribute('aria-pressed') === 'true'
      const originalStage = document.querySelector('[data-stage]')
      buttons()[0].click()
      await wait()
      const individual = muted(buttons()[0]) && !muted(buttons()[1])
      document.querySelector('#btn-mute-all').click()
      await wait()
      const all = buttons().every(muted)
      buttons()[1].click()
      await wait()
      const independent = muted(buttons()[0]) && !muted(buttons()[1]) &&
        !muted(document.querySelector('#btn-mute-all'))
      document.querySelector('#btn-mute-all').click()
      await wait()
      document.querySelector('#btn-mute-all').click()
      await wait()
      return { individual, all, independent, unmuted: buttons().every((button) => !muted(button)),
        stableStage: originalStage === document.querySelector('[data-stage]') }
    })()`)
    assert.deepEqual(audioControls, { individual: true, all: true, independent: true, unmuted: true, stableStage: true })
    const audioTargets = await fetchJson(`http://127.0.0.1:${port}/json`)
    assert.deepEqual(audioTargets.filter((page) => page.url.startsWith(`${baseUrl}/page?slot=`)).map((page) => page.id).sort(),
      [...stablePageIds].sort(), 'Os controles de áudio recriaram uma página.')

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      panel.querySelector('[data-edit]').click()
      panel.querySelector('.panel__overlay input[name="url"]').value = ${JSON.stringify(baseUrl + '/blocked')}
      panel.querySelector('.panel__overlay .panel__bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`)
    const blocked = await waitForPageTarget(port, (candidate) => candidate.url.includes('/blocked'))
    assert.ok(blocked, 'A página com X-Frame-Options não abriu no painel principal.')

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-add-panel').click()
      document.querySelector('#btn-organize').click()
      document.querySelector('[data-composition="1"]').click()
      document.querySelector('[data-organizer-aliases~="right"]').click()
      document.querySelector('[data-organize-apply]').click()
      document.querySelector('.panel[data-slot="2"] [data-remove]').click()
    })()`)
    const reorganizeDeadline = Date.now() + 5000
    let pageIdsAfterReorganize = []
    while (Date.now() < reorganizeDeadline) {
      pageIdsAfterReorganize = (await fetchJson(`http://127.0.0.1:${port}/json`))
        .filter((candidate) => candidate.type === 'page' && (candidate.url.includes('/blocked') || candidate.url.includes('/page?slot=1')))
        .map((candidate) => candidate.id)
        .sort()
      if (pageIdsAfterReorganize.length === stablePageIds.length &&
        pageIdsAfterReorganize.every((id, index) => id === [...stablePageIds].sort()[index])) {
        break
      }
      await wait(100)
    }
    assert.deepEqual(pageIdsAfterReorganize, [...stablePageIds].sort(), 'A reorganização recriou uma página.')

    const removal = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const removed = document.querySelector('.panel[data-slot="1"]')
      const removedId = removed.dataset.panelId
      removed.querySelector('[data-remove]').click()
      return {
        removedId,
        panelCount: document.querySelectorAll('.panel').length,
        className: document.querySelector('.grid').className,
        mode: document.querySelector('.layout-stage').dataset.layoutMode,
        highlighted: document.querySelectorAll('.panel.is-highlighted').length,
        trashDisabled: document.querySelector('[data-remove]').disabled,
      }
    })()`)
    assert.equal(removal.panelCount, 1)
    assert.match(removal.className, /grid--1/)
    assert.equal(removal.mode, 'auto')
    assert.equal(removal.highlighted, 0)
    assert.equal(removal.trashDisabled, true)
    const removedTargetDeadline = Date.now() + 10000
    let targetsAfterRemoval = []
    while (Date.now() < removedTargetDeadline) {
      targetsAfterRemoval = (await fetchJson(`http://127.0.0.1:${port}/json`))
        .filter((candidate) => candidate.type === 'page' && (candidate.url.includes('/blocked') || candidate.url.includes('/page?slot=1')))
      if (targetsAfterRemoval.length === 1) break
      await wait(100)
    }
    assert.equal(targetsAfterRemoval.length, 1, 'A remoção deve destruir somente o painel escolhido.')
    assert.equal(stablePageIds.includes(targetsAfterRemoval[0].id), true,
      'A remoção recriou o vídeo que deveria permanecer.')

    const cleared = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      panel.querySelector('[data-edit]')?.click()
      panel.querySelector('[data-clear]')?.click()
      const nextPanel = document.querySelector('.panel[data-slot="0"]')
      return { empty: nextPanel.classList.contains('panel--empty'), hasStage: Boolean(nextPanel.querySelector('[data-stage]')) }
    })()`)
    assert.deepEqual(cleared, { empty: true, hasStage: false })

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-more').click(); document.querySelector('#btn-clear-all').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelectorAll('.panel--empty').length`), 1)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click(); document.querySelector('.confirm [data-ok]').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `getComputedStyle(document.documentElement).backgroundColor`), 'rgb(7, 26, 20)')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `getComputedStyle(document.documentElement).colorScheme`), 'dark')
    process.stdout.write(JSON.stringify({ chooser: true, bllsportCatalog: true, bllsportSequentialPanels: true, bllsportExplicitReplacement: true, bllsportPanelAlert: true, twoElectronViews: true, blockedFramePolicyPage: true, reorganizedWithoutReload: true, removesOnlyChosenPanel: true, clear: true, returnToChooser: true }) + '\n')
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
