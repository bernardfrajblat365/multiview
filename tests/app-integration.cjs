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
  let detailRequests = 0
  let finishingDetailRequests = 0
  const crestRequests = []
  let basketballListRequests = 0
  let basketballDetailRequests = 0
  let bllEndOpened = false
  let bllEndListLoads = 0
  const port = 46000 + Math.floor(Math.random() * 1000)
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/bll/')) {
      // Once its player opens, "game-bllend" is listed live on the next home load, then under "Encerrados".
      const bllEnd = bllEndOpened ? (bllEndListLoads++ === 0 ? 3 : 4) : 0
      const bllEndRow = `{ _id: 'game-bllend', nome: 'Time X x Time Y', competicao: 'Brasil, Liga Final', situacao: ${bllEnd}, dataHora: 16, dataMinuto: 0 }`
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
              { _id: 'game-c', nome: 'Time E x Time F 🔊', competicao: 'Brasil, Liga Teste, Grupo A', situacao: 3, dataHora: 17, dataMinuto: 0 },
              { _id: 'game-d', nome: 'Time G x Time H', competicao: 'Brasil, Liga Teste, Grupo A', situacao: 3, dataHora: 17, dataMinuto: 0 },
              { _id: 'game-e', nome: '🏀 Time I x Time J', competicao: 'Brasil, Outra Liga', situacao: 3, dataHora: 18, dataMinuto: 30 },
              { _id: 'game-f', nome: 'Time K x Time L', competicao: 'Brasil, Liga Teste, Grupo A', situacao: 1, dataHora: 21, dataMinuto: 0 },
              ${bllEnd === 3 ? bllEndRow : ''}
            ],
            itensEncerrados: [${bllEnd === 4 ? bllEndRow : ''}],
            formatarHora: (item) => String(item.dataHora).padStart(2, '0') + ':' + String(item.dataMinuto).padStart(2, '0'),
          }
          document.querySelector('#app').__vue__ = { $options: { name: 'App' }, $children: [list] }
        </script>`)
      return
    }
    if (request.url?.startsWith('/youtube/')) {
      const requestUrl = new URL(request.url, 'http://fixture')
      const params = Object.fromEntries(requestUrl.searchParams)
      youtubeQueries.push({ path: requestUrl.pathname, ...params })
      const json = (body, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(body))
      }
      const live = { actualStartTime: '2026-10-24T18:00:00Z', concurrentViewers: '100' }
      const videos = {
        ytLiveAAAA1: { snippet: { title: 'AO VIVO: Time M x Time N | Copa do Brasil', channelTitle: 'CazéTV', liveBroadcastContent: 'live' }, liveStreamingDetails: { ...live, concurrentViewers: '900' } },
        ytLiveAAAA2: { snippet: { title: 'Time O x Time P &#39;ao vivo&#39;', channelTitle: 'CazéTV', liveBroadcastContent: 'live' }, liveStreamingDetails: live },
        ytLiveAAAA3: { snippet: { title: 'REACT Time Q x Time R', channelTitle: 'CazéTV', liveBroadcastContent: 'live' }, liveStreamingDetails: live },
        ytLiveAAAA4: { snippet: { title: 'Time S x Time T', channelTitle: 'CazéTV', liveBroadcastContent: 'upcoming' }, liveStreamingDetails: {} },
        ytLiveAAAA5: { snippet: { title: 'Time U x Time V', channelTitle: 'CazéTV', liveBroadcastContent: 'none' }, liveStreamingDetails: { ...live, actualEndTime: '2026-10-24T20:00:00Z' } },
        ytLiveAAAA6: { snippet: { title: 'AO VIVO: Time W x Time Z', channelTitle: 'Canal Teste', liveBroadcastContent: 'live' }, liveStreamingDetails: live },
      }
      if (requestUrl.pathname === '/youtube/playlistItems') {
        // CazéTV (default list) and the channel added in the test have uploads; other default channels answer 404.
        const uploads = { UUZiYbVptd3PVPf4f6eR6UaQ: ['ytLiveAAAA1', 'ytLiveAAAA2', 'ytLiveAAAA3', 'ytLiveAAAA4', 'ytLiveAAAA5'], UUtestChannelAAAAAAAAAAA: ['ytLiveAAAA6'] }[params.playlistId]
        if (!uploads) return json({ error: { code: 404, errors: [{ reason: 'playlistNotFound' }] } }, 404)
        return json({ items: uploads.map((videoId) => ({ contentDetails: { videoId } })) })
      }
      if (requestUrl.pathname === '/youtube/videos') {
        return json({ items: params.id.split(',').filter((id) => videos[id]).map((id) => ({ id, ...videos[id] })) })
      }
      if (requestUrl.pathname === '/youtube/channels') {
        return json({ items: params.forHandle === 'canalteste' ? [{ id: 'UCtestChannelAAAAAAAAAAA', snippet: { title: 'Canal Teste' } }] : [] })
      }
      return json({}, 404)
    }
    if (request.url?.startsWith('/image/upload/')) {
      // 365Scores crests: Coritiba (1), Avaí (2), Celtics (5) and Nets (6) have one; any other team answers 404, like the CDN without a default image.
      crestRequests.push(request.url)
      if (!/\/Competitors\/[1256]$/.test(request.url)) {
        response.writeHead(404)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))
      return
    }
    if (request.url?.startsWith('/web/games/') && new URL(request.url, 'http://fixture').searchParams.get('sports') === '2') {
      // Basketball list: a BLL "🏀" game is looked up here, never among the football games.
      basketballListRequests += 1
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ games: [{
        id: 9101, sportId: 2, statusGroup: 3, statusText: 'Q3', competitionDisplayName: 'NBA',
        startTime: new Date().toISOString(), homeCompetitor: { id: 5, name: 'Boston Celtics', imageVersion: 6 }, awayCompetitor: { id: 6, name: 'Brooklyn Nets', imageVersion: 2 },
      }] }))
      return
    }
    if (request.url?.startsWith('/web/game/') && new URL(request.url, 'http://fixture').searchParams.get('gameId') === '9101') {
      // Live for the first rounds (a three-pointer in the 3rd), then over: a basketball panel stays open (score only, no closing yet).
      basketballDetailRequests += 1
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ game: {
        id: 9101, statusGroup: basketballDetailRequests <= 3 ? 3 : 4, gameTime: 6,
        homeCompetitor: { id: 5, name: 'Boston Celtics', score: basketballDetailRequests >= 3 ? 101 : 98, imageVersion: 6 }, awayCompetitor: { id: 6, name: 'Brooklyn Nets', score: 95, imageVersion: 2 },
      } }))
      return
    }
    if (request.url?.startsWith('/web/games/')) {
      // game-b has no William Hill feed: its BLL panel falls back to this 365Scores game.
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ games: [{
        id: 9001, sportId: 1, statusGroup: 3, statusText: "30'", competitionDisplayName: 'Liga Teste',
        startTime: new Date().toISOString(), homeCompetitor: { id: 1, name: 'Coritiba', imageVersion: 3 }, awayCompetitor: { id: 2, name: 'Avaí', imageVersion: 1 },
      }, {
        id: 9002, sportId: 1, statusGroup: 3, statusText: "88'", competitionDisplayName: 'Liga Teste',
        startTime: new Date().toISOString(), homeCompetitor: { id: 3, name: 'Bahia' }, awayCompetitor: { id: 4, name: 'Vitória' },
      }] }))
      return
    }
    if (request.url?.startsWith('/web/game/') && new URL(request.url, 'http://fixture').searchParams.get('gameId') === '9002') {
      // Live for the first rounds, then over: its panel closes like a William Hill one.
      finishingDetailRequests += 1
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ game: {
        id: 9002, statusGroup: finishingDetailRequests <= 2 ? 3 : 4, gameTime: 90, events: [],
        homeCompetitor: { id: 3, name: 'Bahia', score: 2, redCards: 0 }, awayCompetitor: { id: 4, name: 'Vitória', score: 1, redCards: 0 },
      } }))
      return
    }
    if (request.url?.startsWith('/web/game/')) {
      // The first detail request hangs, like the API's occasional stall: the app must give up and retry at once.
      detailRequests += 1
      if (detailRequests === 1) return
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ game: {
        id: 9001, statusGroup: 3, gameTime: 30, events: [],
        homeCompetitor: { id: 1, name: 'Coritiba', score: 1, redCards: 0, imageVersion: 3 }, awayCompetitor: { id: 2, name: 'Avaí', score: 0, redCards: 0, imageVersion: 1 },
      } }))
      return
    }
    if (request.url?.startsWith('/scoreboard/')) {
      // William Hill scoreboard: second half for a few seconds after loading, then the match is over.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Scoreboard fixture</title><div>Time W</div><div>1 - 0</div><div>Time Z</div>
        <script>
          let period = 'SECOND_HALF'
          setTimeout(() => { period = 'GAME_FINISHED' }, 4000)
          window.WH = { scoreboard: {
            diffusion: { isConnected: true },
            commentaries: { acceptIncident: () => true },
            statistics: { getPeriod: () => period, acceptIncident: () => true },
          } }
        </script>`)
      return
    }
    if (request.url?.startsWith('/watch')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(fs.readFileSync(path.join(__dirname, 'fixtures', 'youtube-watch.html')))
      return
    }
    if (request.url?.startsWith('/view/')) {
      if (request.url.startsWith('/view/game-bllend')) bllEndOpened = true
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
      ...childEnv, QUADRA_TEST_USER_DATA: userData, QUADRA_BLLSPORT_URL: `${baseUrl}/bll/`, QUADRA_365SCORES_URL: baseUrl, QUADRA_365SCORES_IMAGE_URL: baseUrl,
      QUADRA_YOUTUBE_API_URL: `${baseUrl}/youtube`, QUADRA_YOUTUBE_WATCH_ORIGIN: baseUrl, QUADRA_YOUTUBE_API_KEY: youtubeTestKey,
      QUADRA_SCOREBOARD_URL: `${baseUrl}/scoreboard/index.html`, QUADRA_BLL_END_POLL_MS: '1500',
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
    const dismissHover = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      const chip = panel.querySelector('.panel__label-chip')
      const dismiss = panel.querySelector('[data-dismiss-label]')
      const visible = () => getComputedStyle(dismiss).visibility === 'visible'
      const rect = chip.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
      const before = visible()
      move(rect.left + rect.width / 2, rect.top + rect.height / 2)
      const over = visible()
      move(panelRect.left + 4, panelRect.top + panelRect.height / 2)
      // Hiding fades out over 0.15 s, so the class tells whether it is leaving.
      const away = panel.querySelector('.panel__label').classList.contains('is-hovered')
      return { before, over, away }
    })()`)
    assert.deepEqual(dismissHover, { before: false, over: true, away: false },
      'O X do rótulo só pode aparecer com o mouse sobre os nomes dos times.')
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
    // The score arrives although the first detail request hung (old timing: 8 s timeout + 6 s backoff).
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.score === '1 – 0'`, 9000).catch(async (error) => {
      const label = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({ ...document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset })`)
      throw new Error(`${error.message}; rótulo: ${label}; consultas ao detalhe: ${detailRequests}`)
    })
    assert.ok(detailRequests >= 2, 'O detalhe travado precisa ser consultado de novo.')
    // Crests follow the names and score: one per team, beside each name, from the 365Scores CDN.
    await waitForExpression(target,
      `document.querySelectorAll('.panel[data-slot="1"] .panel__label img.panel__label-crest[src^="data:image/png;base64,"]').length === 2`).catch(async (error) => {
      throw new Error(`${error.message}; escudos pedidos: ${JSON.stringify(crestRequests)}`)
    })
    assert.ok(crestRequests.some((url) => url.endsWith('/v3/Competitors/1')), 'O escudo usa a versão de imagem do time.')

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

    const reloadOrder = await evaluate(target.webSocketDebuggerUrl, `[...document.querySelectorAll('.panel[data-slot="0"] .panel__controls > button')]
      .map((button) => button.dataset.edit !== undefined ? 'edit' : button.dataset.reload !== undefined ? 'reload' : button.dataset.alerts !== undefined ? 'alerts' : button.dataset.remove !== undefined ? 'remove' : null)
      .filter(Boolean)`)
    assert.deepEqual(reloadOrder, ['edit', 'reload', 'alerts', 'remove'], 'Recarregar fica entre editar URL e alertas; alertas logo antes de remover tela.')
    const alertsToggle = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const button = () => document.querySelector('.panel[data-slot="0"] [data-alerts]')
      button().click()
      const off = button().getAttribute('aria-pressed')
      button().click()
      return { off, on: button().getAttribute('aria-pressed') }
    })()`)
    assert.deepEqual(alertsToggle, { off: 'true', on: 'false' }, 'O botão de alertas deve desligar e religar os alertas do painel.')
    const players = (await fetchJson(`http://127.0.0.1:${port}/json`)).filter((candidate) => candidate.url.includes('/view/game-'))
    assert.ok(players.length >= 2, 'O teste de recarregar precisa de pelo menos dois players abertos.')
    for (const player of players) await evaluate(player.webSocketDebuggerUrl, `window.__quadraReloadMark = true`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] [data-reload]').click()`)
    const reloadDeadline = Date.now() + 10000
    let reloaded = []
    while (Date.now() < reloadDeadline) {
      reloaded = []
      for (const player of players) {
        if (await evaluate(player.webSocketDebuggerUrl, `window.__quadraReloadMark === true`).catch(() => true) === false) reloaded.push(player.url)
      }
      if (reloaded.length > 0) break
      await wait(100)
    }
    await wait(300)
    assert.equal(reloaded.length, 1, 'Recarregar deve recarregar só a página do próprio painel, sem recriar a view.')
    assert.ok(reloaded[0].includes('/view/game-b'), 'Recarregar atingiu o player errado.')

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
      { title: 'Brasil, Liga Teste (2)', items: ['17:00 Time E x Time F Grupo A', '17:00 Time G x Time H Grupo A'] },
      { title: 'Brasil, Outra Liga (1)', items: ['18:30 🏀 Time I x Time J'] },
    ], 'O lote deve listar só jogos ao vivo, agrupados por liga (fase ao lado do jogo), sem marcadores de som e com 🏀 nos jogos de basquete.')
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
        { title: 'Copa do Brasil (1)', items: ['AO VIVO: Time M x Time N | Copa do Brasil CazéTV'], urls: ['https://www.youtube.com/watch?v=ytLiveAAAA1'] },
        { title: 'CazéTV (1)', items: ["Time O x Time P 'ao vivo'"], urls: ['https://www.youtube.com/watch?v=ytLiveAAAA2'] },
      ],
    }, 'O lote do YouTube deve listar só jogos ao vivo dos canais da lista, agrupados por competição ou canal.')
    const playlistQueries = youtubeQueries.filter((query) => query.path === '/youtube/playlistItems')
    assert.equal(playlistQueries.length, 10, 'A lista padrão tem 10 canais, um playlistItems por canal.')
    assert.ok(playlistQueries.some((query) => query.playlistId === 'UUZiYbVptd3PVPf4f6eR6UaQ'), 'A playlist de uploads é o id do canal com UU no lugar de UC.')
    assert.ok(youtubeQueries.every((query) => query.key === youtubeTestKey), 'A chave deve vir do ambiente/.env, só no main.')
    assert.equal(youtubeQueries.some((query) => query.path === '/youtube/search'), false, 'Sem busca aberta (100 unidades).')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.documentElement.outerHTML.includes(${JSON.stringify(youtubeTestKey)})`), false,
      'A chave do YouTube não pode chegar ao renderer.')

    // Channel editor: add by @handle, remove, and the list is searched again on the way back.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-channels]').click()`)
    await waitForExpression(target, `!document.querySelector('.yt-channels').hidden && document.querySelector('.bll-batch__list').hidden`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelectorAll('.yt-channels__list li').length`), 10)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.yt-channels__add input').value = 'https://www.youtube.com/@canalteste/streams'
      document.querySelector('.yt-channels__add button').click()
    })()`)
    await waitForExpression(target, `document.querySelectorAll('.yt-channels__list li').length === 11`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.yt-channels__add input').value = '@naoexiste'
      document.querySelector('.yt-channels__add button').click()
    })()`)
    await waitForExpression(target, `document.querySelector('.yt-channels__message').textContent.startsWith('Canal não encontrado')`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.yt-channels [data-remove="UCZiYbVptd3PVPf4f6eR6UaQ"]').click()`)
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl, `JSON.parse(localStorage.getItem('quadra:youtube-channels')).map((channel) => channel.title).slice(-2)`),
      ['N Sports', 'Canal Teste'], 'A lista de canais fica salva no app.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-channels]').click()`)
    await waitForExpression(target, `document.querySelector('.bll-batch__item')?.textContent.includes('Time W x Time Z')`, 20000)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch__list').textContent.includes('Time M x Time N')`), false,
      'O canal removido não é mais lido.')
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.bll-batch [data-channels]').click()
      document.querySelector('.yt-channels [data-restore]').click()
      document.querySelector('.bll-batch [data-cancel]').click()
    })()`)
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

    // The William Hill feed reports the end of the match: the panel counts down, "Manter aberto" keeps it.
    const openFinishingMatch = (slot, closeAfter, query) => evaluate(target.webSocketDebuggerUrl, `(() => {
      const select = document.querySelector('[data-close-finished]')
      select.value = ${JSON.stringify(String(closeAfter))}
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const panel = document.querySelector('.panel[data-slot="${slot}"]')
      // Loaded panels keep the URL bar in the overlay; an empty one shows its own form.
      const input = panel.querySelector('.panel__overlay input[name="url"]') ?? panel.querySelector('input[name="url"]')
      input.value = ${JSON.stringify(baseUrl)} + ${JSON.stringify('/view/game-' + query)}
      input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`)
    await openFinishingMatch(0, 30, `wh-7001?evento=${encodeURIComponent('Time W x Time Z')}&wh=7001`)
    await waitForExpression(target, `/^Fim de jogo · fecha em \\d+ s$/.test(document.querySelector('.panel[data-slot="0"] [data-finished-count]')?.textContent ?? '')`, 30000)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] [data-finished-keep]').click()`)
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl, `({ notice: Boolean(document.querySelector('.panel__finished')), panels: document.querySelectorAll('.panel').length })`),
      { notice: false, panels: 2 }, '"Manter aberto" deve cancelar o fechamento.')
    await openFinishingMatch(1, 0, `wh-7002?evento=${encodeURIComponent('Time W x Time Z')}&wh=7002`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 1`, 30000)
    assert.equal(new URL(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel input[name="url"]').value`)).pathname, '/view/game-wh-7001',
      'Só o painel do jogo encerrado deve fechar.')
    // A BLL game without a William Hill feed, followed on 365Scores, closes too when 365Scores reports it over.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-add-panel').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 2`)
    await openFinishingMatch(1, 0, `365?evento=${encodeURIComponent('Bahia x Vitória')}`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 1`, 30000)
    assert.ok(finishingDetailRequests >= 3, 'O jogo do 365Scores precisa ter sido consultado até acabar.')
    assert.equal(new URL(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel input[name="url"]').value`)).pathname, '/view/game-wh-7001',
      'Só o painel do jogo do 365Scores encerrado deve fechar.')
    // A BLL basketball game ("🏀", no William Hill feed) gets the 365Scores names, crests and score; it does not close at the end.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-add-panel').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 2`)
    await openFinishingMatch(1, 0, `basket?evento=${encodeURIComponent('🏀 Boston Celtics x Brooklyn Nets 🔊')}`)
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.score === '98 – 95'`, 20000).catch(async (error) => {
      const label = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({ ...document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset })`)
      throw new Error(`${error.message}; rótulo: ${label}; listas de basquete pedidas: ${basketballListRequests}`)
    })
    await waitForExpression(target,
      `document.querySelectorAll('.panel[data-slot="1"] .panel__label img.panel__label-crest[src^="data:image/png;base64,"]').length === 2`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__label').dataset.label`), 'Boston Celtics x Brooklyn Nets',
      'O rótulo do jogo de basquete usa os nomes do 365Scores.')
    assert.ok(crestRequests.some((url) => url.endsWith('/v6/Competitors/5')), 'O escudo do time de basquete vem do CDN do 365Scores.')
    assert.ok((await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__delay')?.title ?? ''`)).includes('basquete'))
    // A basket rolls the digits that changed (98 → 101) without lighting up the label.
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.score === '101 – 95'`, 20000)
    const basketballRoll = JSON.parse(await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({
      flash: document.querySelector('.panel[data-slot="1"] .panel__label').classList.contains('panel__label--flash'),
      rolls: document.querySelectorAll('.panel[data-slot="1"] .panel__label-roll').length,
    })`))
    assert.equal(basketballRoll.flash, false, 'Cesta no basquete não acende o placar.')
    assert.equal(basketballRoll.rolls, 3, 'Os três dígitos do 98 → 101 rolam como roleta.')
    const basketballDeadline = Date.now() + 20000
    while (Date.now() < basketballDeadline && basketballDetailRequests < 4) await wait(200)
    assert.ok(basketballDetailRequests >= 4, 'O jogo de basquete precisa ter sido consultado até acabar.')
    await wait(1500)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelectorAll('.panel').length`), 2, 'O painel de basquete não fecha no fim do jogo.')
    // Any BLL game closes once the BLL list moves it from "Ao Vivo" to "Encerrado" (no William Hill or 365Scores needed).
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-add-panel').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 3`)
    await openFinishingMatch(2, 0, `bllend?evento=${encodeURIComponent('Time X x Time Y')}`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 2`, 30000).catch((error) => {
      throw new Error(`${error.message}; leituras da lista da BLL depois de abrir o jogo: ${bllEndListLoads}`)
    })
    assert.ok(bllEndListLoads >= 2, 'A lista da BLL precisa ter mostrado o jogo ao vivo e depois encerrado.')
    assert.ok(!(await evaluate(target.webSocketDebuggerUrl,
      `[...document.querySelectorAll('.panel input[name="url"]')].some((input) => input.value.includes('game-bllend'))`)), 'Só o painel do jogo encerrado na BLL deve fechar.')
    process.stdout.write(JSON.stringify({ chooser: true, bllsportCatalog: true, bllsportSequentialPanels: true, bllsportExplicitReplacement: true, bllsportBatch: true, bllsportBatchFromChooser: true, closesFinishedMatch: true, closesFinished365Match: true, closesBllEndedMatch: true, bllBasketball365: true, youtubeLivesBatch: true, youtubePlayerOnly: true, twoElectronViews: true, blockedFramePolicyPage: true, reorganizedWithoutReload: true, removesOnlyChosenPanel: true, clear: true, returnToChooser: true }) + '\n')
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
