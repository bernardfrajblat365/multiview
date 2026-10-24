const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { createSportsPlayerFixture } = require('./sports-player-fixture.cjs')

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
  const deadline = Date.now() + 20000
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
  const youtubeTestKey = `AIza${'T'.repeat(35)}`
  const youtubeQueries = []
  const port = 46000 + Math.floor(Math.random() * 1000)
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/bll/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>BLL Test Catalog</title>
        <button id="game-a" onclick="window.open('/view/game-a?canal=2&title=' + encodeURIComponent('Time A x Time B'), 'game-a')">Jogo A</button>
        <button id="game-b" onclick="window.open('/view/game-b?title=' + encodeURIComponent('Time C x Time D') + '&evento=' + encodeURIComponent('Coritiba x Avaí'), 'game-b')">Jogo B</button>
        <div id="app"></div>
        <script>
          // Mirrors the BLL home: a Vue 2 tree whose ListEventosHome2 holds the listed games.
          const list = {
            $options: { name: 'ListEventosHome2' }, $children: [],
            itens: [
              { _id: 'game-c', nome: 'Time E x Time F 🔊', competicao: 'Liga Teste, Grupo A', situacao: 3, dataHora: 17, dataMinuto: 0 },
              { _id: 'game-d', nome: 'Time G x Time H', competicao: 'Liga Teste, Grupo A', situacao: 3, dataHora: 17, dataMinuto: 0 },
              { _id: 'game-e', nome: 'Time I x Time J', competicao: 'Outra Liga', situacao: 3, dataHora: 18, dataMinuto: 30 },
              { _id: 'game-f', nome: 'Time K x Time L', competicao: 'Liga Teste, Grupo A', situacao: 1, dataHora: 21, dataMinuto: 0 },
            ],
            formatarHora: (item) => String(item.dataHora).padStart(2, '0') + ':' + String(item.dataMinuto).padStart(2, '0'),
          }
          document.querySelector('#app').__vue__ = { $options: { name: 'App' }, $children: [list] }
        </script>`)
      return
    }
    if (request.url?.startsWith('/youtube/search')) {
      youtubeQueries.push(Object.fromEntries(new URL(request.url, 'http://fixture').searchParams))
      const video = (videoId, title, channelTitle, liveBroadcastContent = 'live') => ({ id: { videoId }, snippet: { title, channelTitle, liveBroadcastContent } })
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ items: [
        video('ytLiveAAAA1', 'AO VIVO: Time M x Time N | Copa do Brasil', 'Canal Teste'),
        video('ytLiveAAAA2', 'Time O x Time P &#39;ao vivo&#39;', 'Canal Dois'),
        video('ytLiveAAAA3', 'REACT Time Q x Time R', 'Canal Teste'),
        video('ytLiveAAAA4', 'Time S x Time T', 'Canal Teste', 'upcoming'),
        video('ytLiveAAAA5', 'Resenha de segunda ao vivo', 'Canal Teste'),
      ] }))
      return
    }
    if (request.url?.startsWith('/web/games/')) {
      // game-b has no William Hill feed: its BLL panel falls back to this 365Scores game.
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ games: [{
        id: 9001, sportId: 1, statusGroup: 3, statusText: "30'", competitionDisplayName: 'Liga Teste',
        startTime: new Date().toISOString(), homeCompetitor: { id: 1, name: 'Coritiba' }, awayCompetitor: { id: 2, name: 'Avaí' },
      }] }))
      return
    }
    if (request.url?.startsWith('/web/game/')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ game: {
        id: 9001, statusGroup: 3, gameTime: 30, events: [],
        homeCompetitor: { id: 1, name: 'Coritiba', score: 1, redCards: 0 }, awayCompetitor: { id: 2, name: 'Avaí', score: 0, redCards: 0 },
      } }))
      return
    }
    if (request.url?.startsWith('/watch')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(fs.readFileSync(path.join(__dirname, 'fixtures', 'youtube-watch.html')))
      return
    }
    if (request.url?.startsWith('/view/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(createSportsPlayerFixture(new URL(request.url, `http://${request.headers.host}`)))
      return
    }
    const title = request.url?.startsWith('/blocked') ? 'Quadra Blocked Page' : 'Quadra Integration Page'
    if (request.url?.startsWith('/blocked')) response.setHeader('X-Frame-Options', 'DENY')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${title}</title><button id="click-target">Page</button>`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronPath, [mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false, stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...childEnv, QUADRA_TEST_USER_DATA: userData, QUADRA_BLLSPORT_URL: `${baseUrl}/bll/`, QUADRA_365SCORES_URL: baseUrl,
      QUADRA_YOUTUBE_API_URL: `${baseUrl}/youtube/search`, QUADRA_YOUTUBE_WATCH_ORIGIN: baseUrl, QUADRA_YOUTUBE_API_KEY: youtubeTestKey,
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
    // No William Hill feed in game-b: the panel links to the 365Scores game named by the player instead.
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="1"] .panel__delay')?.title.includes('365Scores: Coritiba x Avaí') === true`)

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
      document.querySelector('#btn-bll-batch').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.bll-batch__group').length === 2`, 20000)
    const batchList = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const groups = [...document.querySelectorAll('.bll-batch__group')].map((group) => ({
        title: group.querySelector('legend').textContent.replace(/\\s+/g, ' ').trim(),
        items: [...group.querySelectorAll('.bll-batch__item')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()),
      }))
      document.querySelector('.bll-batch input[data-group="0"]').click()
      return { groups, ok: document.querySelector('.bll-batch [data-ok]').textContent }
    })()`)
    assert.deepEqual(batchList.groups, [
      { title: 'Liga Teste, Grupo A (2)', items: ['17:00 Time E x Time F', '17:00 Time G x Time H'] },
      { title: 'Outra Liga (1)', items: ['18:30 Time I x Time J'] },
    ], 'O lote deve listar só jogos ao vivo, agrupados por competição e sem marcadores de som.')
    assert.equal(batchList.ok, 'Abrir 2 jogos')
    const playerIdsBeforeBatch = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.url.includes('/view/game-b')).map((candidate) => candidate.id).sort()
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-ok]').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 4 && !document.querySelector('.bll-batch')`)
    const batchPanels = await evaluate(target.webSocketDebuggerUrl,
      `[...document.querySelectorAll('.panel input[name="url"]')].map((input) => new URL(input.value).pathname)`)
    assert.deepEqual(batchPanels.slice(2), ['/view/game-c', '/view/game-d'], 'O lote deve criar uma tela para cada jogo marcado.')
    assert.ok(await waitForPageTarget(port, (candidate) => candidate.url.includes('/view/game-c?view=clean')), 'O jogo C do lote não abriu.')
    assert.ok(await waitForPageTarget(port, (candidate) => candidate.url.includes('/view/game-d?view=clean')), 'O jogo D do lote não abriu.')
    assert.deepEqual((await fetchJson(`http://127.0.0.1:${port}/json`))
      .filter((candidate) => candidate.url.includes('/view/game-b')).map((candidate) => candidate.id).sort(),
    playerIdsBeforeBatch, 'Abrir em lote não pode recarregar os jogos que já estavam abertos.')

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('#btn-more').click()
      document.querySelector('#btn-youtube-batch').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.bll-batch__group').length === 2`, 20000)
    const youtubeList = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const groups = [...document.querySelectorAll('.bll-batch__group')].map((group) => ({
        title: group.querySelector('legend').textContent.replace(/\\s+/g, ' ').trim(),
        items: [...group.querySelectorAll('.bll-batch__item')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()),
        urls: [...group.querySelectorAll('input[data-url]')].map((input) => input.dataset.url),
      }))
      return { title: document.querySelector('#bll-batch-title').textContent, groups }
    })()`)
    assert.deepEqual(youtubeList, {
      title: 'Abrir jogos ao vivo do YouTube',
      groups: [
        { title: 'Copa do Brasil (1)', items: ['AO VIVO: Time M x Time N | Copa do Brasil Canal Teste'], urls: ['https://www.youtube.com/watch?v=ytLiveAAAA1'] },
        { title: 'Canal Dois (1)', items: ["Time O x Time P 'ao vivo'"], urls: ['https://www.youtube.com/watch?v=ytLiveAAAA2'] },
      ],
    }, 'O lote do YouTube deve listar só lives de jogos ao vivo, agrupadas por competição ou canal.')
    assert.equal(youtubeQueries.length, 1)
    assert.equal(youtubeQueries[0].key, youtubeTestKey, 'A chave deve vir do ambiente/.env, só no main.')
    assert.equal(youtubeQueries[0].eventType, 'live')
    assert.equal(youtubeQueries[0].videoCategoryId, '17')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.documentElement.outerHTML.includes(${JSON.stringify(youtubeTestKey)})`), false,
      'A chave do YouTube não pode chegar ao renderer.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-cancel]').click()`)
    await waitForExpression(target, `!document.querySelector('.bll-batch')`)

    // YouTube watch page: only the player, filling the panel, chat hidden, ad skipped.
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="3"]')
      panel.querySelector('[data-edit]').click()
      panel.querySelector('.panel__overlay input[name="url"]').value = ${JSON.stringify(baseUrl + '/watch?v=fixture1')}
      panel.querySelector('.panel__overlay .panel__bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`)
    const youtubePage = await waitForPageTarget(port, (candidate) => candidate.url.includes('/watch?v=fixture1'))
    assert.ok(youtubePage, 'A página watch do YouTube não abriu.')
    await wait(1500)
    const youtubeState = await evaluate(youtubePage.webSocketDebuggerUrl, `(() => {
      const rect = document.querySelector('#movie_player').getBoundingClientRect()
      return {
        skipClicks: window.__skipClicks,
        adShowing: document.querySelector('#movie_player').classList.contains('ad-showing'),
        chatDisplay: getComputedStyle(document.querySelector('#chat')).display,
        mastheadDisplay: getComputedStyle(document.querySelector('#masthead-container')).display,
        fills: Math.abs(rect.width - window.innerWidth) < 2 && Math.abs(rect.height - window.innerHeight) < 2,
        videoVisible: document.querySelector('#movie_player video').getBoundingClientRect().height > 0,
      }
    })()`)
    assert.deepEqual(youtubeState, { skipClicks: 1, adShowing: false, chatDisplay: 'none', mastheadDisplay: 'none', fills: true, videoVisible: true },
      'O painel do YouTube deve mostrar só o player em tela cheia, sem chat, com o anúncio pulado.')

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
    await new Promise((resolve) => setTimeout(resolve, 200))
    const targetsAfterReorganize = await fetchJson(`http://127.0.0.1:${port}/json`)
    const pageIdsAfterReorganize = targetsAfterReorganize
      .filter((candidate) => candidate.type === 'page' && (candidate.url.includes('/blocked') || candidate.url.includes('/page?slot=1')))
      .map((candidate) => candidate.id)
    assert.deepEqual(pageIdsAfterReorganize.sort(), stablePageIds.sort(), 'A reorganização recriou uma página.')

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

    await fetch(`http://127.0.0.1:${port}/json/close/${bllCatalog.id}`)
    const catalogClosedDeadline = Date.now() + 10000
    while (Date.now() < catalogClosedDeadline &&
      (await fetchJson(`http://127.0.0.1:${port}/json`)).some((candidate) => candidate.id === bllCatalog.id)) await wait(100)
    // With the visible catalog closed, the list still loads on its own (hidden BLL page) as soon as the dialog opens.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-start-bll-batch').click()`)
    await waitForExpression(target, `document.querySelectorAll('.bll-batch__group').length === 2`, 20000)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-refresh]').click()`)
    await waitForExpression(target, `document.querySelectorAll('.bll-batch__group').length === 2 && !document.querySelector('.bll-batch [data-refresh]').disabled`, 20000)
    const chooserBatch = await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.bll-batch input[data-group="0"]').click()
      return {
        alreadyOpen: document.querySelectorAll('.bll-batch__item.is-open').length,
        ok: document.querySelector('.bll-batch [data-ok]').textContent,
      }
    })()`)
    assert.deepEqual(chooserBatch, { alreadyOpen: 0, ok: 'Abrir 2 jogos em 2 telas' })
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-ok]').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.grid--2')) && !document.querySelector('.bll-batch')`)
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl,
      `[...document.querySelectorAll('.panel input[name="url"]')].map((input) => new URL(input.value).pathname)`),
    ['/view/game-c', '/view/game-d'], 'Na tela inicial, o lote deve abrir uma tela por jogo escolhido.')
    process.stdout.write(JSON.stringify({ chooser: true, bllsportCatalog: true, bllsportSequentialPanels: true, bllsportExplicitReplacement: true, bllsportBatch: true, bllsportBatchFromChooser: true, youtubeLivesBatch: true, youtubePlayerOnly: true, twoElectronViews: true, blockedFramePolicyPage: true, reorganizedWithoutReload: true, removesOnlyChosenPanel: true, clear: true, returnToChooser: true }) + '\n')
  } finally {
    if (child.exitCode === null) child.kill()
    await new Promise((resolve) => server.close(() => resolve()))
    await wait(600)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await wait(250) }
    }
    if (fs.existsSync(userData)) throw new Error('userData temporário não foi liberado.')
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
