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

function sendCdp(webSocketUrl, method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error(`Timeout em ${method}.`)) }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString())
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      resolve(message.result)
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

/** 365Scores game detail with line-ups: 11 starters + coach per team. Player 101 has a photo, 102 doesn't (404). */
function lineupGame(gameId) {
  const members = []
  const side = (competitorId, base, name, positions) => {
    const lineupMembers = []
    positions.forEach((position, index) => {
      const id = base + index
      members.push({ competitorId, id, athleteId: id === 1001 ? 101 : id === 1002 ? 102 : id, name: `${name} Jogador ${index + 1}`, shortName: `J${index + 1}`, jerseyNumber: index + 1, imageVersion: 5 })
      lineupMembers.push({ id, status: 1, position: { name: 'Defesa' }, formation: { name: position }, ranking: index === 0 ? 6.5 : index === 1 ? 7.4 : 5.8 })
    })
    members.push({ competitorId, id: base + 50, athleteId: base + 50, name: `${name} Técnico`, shortName: 'Téc', jerseyNumber: -1, imageVersion: 5 })
    lineupMembers.push({ id: base + 50, status: 4 })
    lineupMembers.push({ id: base + 60, status: 2 })
    return { status: 'Confirmado', formation: '4-4-2', members: lineupMembers }
  }
  const positions = ['Goleiro', 'Lateral Direito', 'Zagueiro Central', 'Zagueiro Central', 'Lateral Esquerdo', 'Volante', 'Meia Central', 'Meia Central', 'Ponta Direita', 'Centroavante', 'Ponta Esquerda']
  const home = side(1, 1001, 'Coritiba', positions)
  const away = side(2, 2001, 'Avaí', positions)
  return { game: {
    id: gameId, statusGroup: 3, gameTime: 30, events: [], statusId: 6, statusText: 'Primeiro Tempo', hasLineups: true, members,
    preciseGameTime: { minutes: 29, seconds: 10, autoProgress: true, clockDirection: 1 },
    homeCompetitor: { id: 1, name: 'Coritiba', score: 1, redCards: 0, imageVersion: 3, lineups: home }, awayCompetitor: { id: 2, name: 'Avaí', score: 0, redCards: 0, imageVersion: 1, lineups: away },
  } }
}

async function run() {
  assert.ok(fs.existsSync(electronPath), 'Electron não encontrado.')
  assert.ok(fs.existsSync(mainPath), 'Bundle main não encontrado; execute npm run build.')

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-app-integration-'))
  const youtubeTestKey = `AIza${'T'.repeat(35)}`
  const youtubeQueries = []
  let detailRequests = 0
  let gameCenterRequests = 0
  let finishingDetailRequests = 0
  const crestRequests = []
  const athleteRequests = []
  let basketballListRequests = 0
  let basketballDetailRequests = 0
  let americanFootballListRequests = 0
  let americanFootballDetailRequests = 0
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
      if (request.url.includes('/Athletes/')) {
        // Player photos: every athlete has one except 102.
        athleteRequests.push(request.url)
        if (request.url.endsWith('/Athletes/102')) {
          response.writeHead(404)
          response.end()
          return
        }
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))
        return
      }
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
    if (request.url?.startsWith('/web/games/') && new URL(request.url, 'http://fixture').searchParams.get('sports') === '6') {
      // American football list: a BLL "🏈" game is looked up here, even when the BLL gives it a William Hill id.
      americanFootballListRequests += 1
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ games: [{
        id: 9201, sportId: 6, statusGroup: 3, statusText: 'Q1', competitionDisplayName: 'NFL',
        startTime: new Date().toISOString(), homeCompetitor: { id: 7, name: 'Green Bay Packers', shortName: 'Packers' }, awayCompetitor: { id: 8, name: 'Carolina Panthers', shortName: 'Panthers' },
      }] }))
      return
    }
    if (request.url?.startsWith('/web/game/') && new URL(request.url, 'http://fixture').searchParams.get('gameId') === '9201') {
      // 0-0 for the first two rounds, then a passing touchdown with the extra point (7-0).
      americanFootballDetailRequests += 1
      const scored = americanFootballDetailRequests >= 3
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ game: {
        id: 9201, statusGroup: 3, gameTime: 9,
        homeCompetitor: { id: 7, name: 'Green Bay Packers', score: scored ? 7 : 0 }, awayCompetitor: { id: 8, name: 'Carolina Panthers', score: 0 },
        events: scored ? [{ order: 1, competitorId: 7, stageId: 64, gameTime: 9, eventType: { id: 16, name: 'Touchdown', subTypeId: 26 } }] : [],
      } }))
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
    if (request.url?.startsWith('/Data/Games/GameCenter/')) {
      // 365Scores mobile game center: a VAR review of a penalty runs for a few reads of Coritiba x Avaí, then the VAR decides (the entry is gone).
      const gameId = Number(new URL(request.url, 'http://fixture').searchParams.get('games'))
      if (gameId === 9001) gameCenterRequests += 1
      const reviewing = gameId === 9001 && gameCenterRequests >= 2 && gameCenterRequests <= 6
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ Games: [{
        ID: gameId, Active: true,
        ...(reviewing ? { ActiveVarEvents: [{ Type: 2, Num: 1, Comp: 2, GT: 26, GTD: "26'", AddedTime: 0, Player: 'Zofia Burzan', PID: 1, S: '1-0', Status: 1, OriginalRefDecision: false }] } : {}),
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
      response.end(JSON.stringify(lineupGame(9001)))
      return
    }
    if (request.url?.startsWith('/scoreboard/')) {
      // William Hill scoreboard: second half for a few seconds after loading (the clock ticks each second), then the match is over.
      // Event 7201 ends its first half and comes back for the second one; 7202 keeps playing its second half.
      const eventId = new URL(request.url, 'http://fixture').searchParams.get('eventId')
      const timeline = eventId === '7201'
        ? `let period = 'FIRST_HALF'
          let duration = 44 * 60
          setTimeout(() => { period = 'HALF_TIME' }, 12000)
          setTimeout(() => { period = 'SECOND_HALF'; duration = 45 * 60 }, 26000)`
        : eventId === '7202' || eventId === '7301'
          ? `let period = 'SECOND_HALF'
          let duration = 75 * 60`
          : `let period = 'SECOND_HALF'
          let duration = 67 * 60 + 10
          setTimeout(() => { period = 'GAME_FINISHED' }, 8000)`
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Scoreboard fixture</title><div>Time W</div><div>1 - 0</div><div>Time Z</div>
        <div style="display:none"><div class="players_home"><ul><li><div class="box-col1"><span>1</span><span>Herrera, Lautaro</span></div></li><li><div class="box-col1"><span>9</span><span>Silva, Gabriel</span></div></li></ul></div><div class="players_away"><ul></ul></div></div>
        <script>
          ${timeline}
          window.WH = { scoreboard: {
            diffusion: { isConnected: true },
            commentaries: { acceptIncident: () => true },
            statistics: { getPeriod: () => period, acceptIncident: () => true },
            scores: { setClock: () => {} },
            // Event 7301: a goal with only the shirt number (9) at 3 s; the line-up tells the name 3 s later.
            lineups: { addEvents: () => {}, getPlayerName: (team, number) => ${eventId === '7301' ? "lineupKnown && team === 'HOME' && number === 9 ? 'Silva, Gabriel' : ''" : "''"} },
          } }
          let lineupKnown = false
          ${eventId === '7301' ? `setTimeout(() => window.WH.scoreboard.commentaries.acceptIncident([{ id: 'OB_EV7301#goal1', type: 'GOAL', teamType: 'HOME', timestamp: new Date().toISOString(), time: { duration: 3000 }, data: { PLAYER: '9' } }]), 3000)
          setTimeout(() => { lineupKnown = true }, 7000)` : ''}
          setInterval(() => { if (period === 'SECOND_HALF' || period === 'FIRST_HALF') window.WH.scoreboard.scores.setClock({ currentTime: { duration: duration++ } }) }, 1000)
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
  const inspectPort = port + 1
  const child = spawn(electronPath, [`--inspect=${inspectPort}`, mainPath, `--remote-debugging-port=${port}`], {
    windowsHide: false, stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...childEnv, QUADRA_TEST_USER_DATA: userData, QUADRA_BLLSPORT_URL: `${baseUrl}/bll/`, QUADRA_365SCORES_URL: baseUrl, QUADRA_365SCORES_IMAGE_URL: baseUrl,
      QUADRA_YOUTUBE_API_URL: `${baseUrl}/youtube`, QUADRA_YOUTUBE_WATCH_ORIGIN: baseUrl, QUADRA_YOUTUBE_API_KEY: youtubeTestKey,
      QUADRA_SCOREBOARD_URL: `${baseUrl}/scoreboard/index.html`, QUADRA_BLL_END_POLL_MS: '1500', QUADRA_AUTO_OPEN_POLL_MS: '1500',
    },
  })
  try {
    const target = await waitForRendererTarget(port)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.app-version')?.textContent`), expectedAppVersion)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('[data-count="2"]').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.panel[data-slot="0"] [data-bllsport]'))`)
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl,
      `[...document.querySelectorAll('.panel[data-slot="0"] .panel__bar button')].map((button) => button.textContent.trim())`),
    ['BLL', 'YouTube', 'Zapping', 'Abrir', 'Limpar'], 'O botão YouTube fica entre BLL e Zapping.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] [data-youtube]').click()`)
    await waitForExpression(target, `document.querySelector('#bll-batch-title')?.textContent === 'Abrir jogos ao vivo do YouTube'`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.bll-batch [data-cancel]').click()`)
    await waitForExpression(target, `!document.querySelector('.bll-batch')`)
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
    // The shirt button appears on a panel with a 365Scores game, right before the delay button, and opens the line-up drawer.
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__info') !== null`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `(() => {
      const kids = [...document.querySelector('.panel[data-slot="1"] .panel__controls').children]
      return kids.indexOf(document.querySelector('.panel[data-slot="1"] .panel__info')) === kids.indexOf(document.querySelector('.panel[data-slot="1"] .panel__delay')) - 1
    })()`), true, 'O botão de escalação vem logo antes do ⏱.')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="0"] .panel__info') === null`), true, 'Painel sem jogo não mostra o botão de escalação.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__info').click()`)
    await waitForExpression(target, `document.querySelectorAll('.info-drawer [data-info-row]').length === 11`).catch(async (error) => {
      const html = await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.info-drawer')?.innerText ?? null`)
      throw new Error(`${error.message}; gaveta: ${JSON.stringify(html)}`)
    })
    const lineupRows = await evaluate(target.webSocketDebuggerUrl, `(() => {
      const row = (index) => document.querySelectorAll('.info-drawer [data-info-row]')[index]
      const text = (index, selector) => row(index).querySelector(selector).textContent
      return {
        number: text(0, '.info-row__number'), name: text(0, '.info-row__name'), pos: text(0, '.info-row__pos'), rating: text(0, '.info-row__rating'),
        secondRating: text(1, '.info-row__rating'), lateral: text(1, '.info-row__pos'),
        secondHigh: row(1).querySelector('.info-row__rating').className.includes('--high'), thirdLow: row(2).querySelector('.info-row__rating').className.includes('--low'),
        coach: document.querySelector('.info-drawer [data-info-coach] .info-row__name')?.textContent,
        note: document.querySelector('.info-drawer [data-info-note]').textContent, team: document.querySelector('.info-drawer .info-team.is-selected').textContent,
      }
    })()`)
    assert.deepEqual(lineupRows, {
      number: '1', name: 'Coritiba Jogador 1', pos: 'GOL', rating: '6,5', secondRating: '7,4', lateral: 'LD', secondHigh: true, thirdLow: true,
      coach: 'Coritiba Técnico', note: 'Escalação confirmada', team: 'Coritiba',
    })
    // Photos follow the text; the player without one keeps the initials.
    await waitForExpression(target, `document.querySelector('.info-drawer [data-photo="101:5"] img') !== null`).catch((error) => {
      throw new Error(`${error.message}; fotos pedidas: ${JSON.stringify(athleteRequests)}`)
    })
    await waitForExpression(target, `document.querySelector('.info-drawer [data-photo="102:5"]') !== null && !document.querySelector('.info-drawer [data-photo="102:5"] img')`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.info-drawer [data-photo="102:5"]').textContent`), 'CJ', 'Sem foto, aparecem as iniciais.')
    assert.ok(athleteRequests.some((url) => url.includes('/v5/Athletes/101')), 'A foto usa a versão da imagem do atleta.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.info-drawer [data-info-team="1"]').click()`)
    await waitForExpression(target, `document.querySelector('.info-drawer [data-info-row] .info-row__name')?.textContent === 'Avaí Jogador 1'`)
    // Esc closes the drawer; the shirt button opens it again and the × closes it.
    await evaluate(target.webSocketDebuggerUrl, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitForExpression(target, `!document.querySelector('.info-drawer')`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__info').click()`)
    await waitForExpression(target, `document.querySelectorAll('.info-drawer [data-info-row]').length === 11`)
    // The coach comes right after the players, and the drawer is only as tall as its content (up to the panel).
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl, `(() => {
      const drawer = document.querySelector('.info-drawer').getBoundingClientRect()
      const panel = document.querySelector('.panel[data-slot="1"]').getBoundingClientRect()
      const coach = document.querySelector('.info-drawer [data-info-coach]')
      return { afterList: coach.previousElementSibling?.matches('[data-info-list]') ?? false, label: coach.querySelector('.info-coach__label')?.textContent, fits: drawer.bottom <= panel.bottom + 1 }
    })()`), { afterList: true, label: 'Técnico', fits: true })
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.info-drawer [data-info-close]').click()`)
    await waitForExpression(target, `!document.querySelector('.info-drawer')`)
    // A click on the panel outside the drawer closes it.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__info').click()`)
    await waitForExpression(target, `document.querySelectorAll('.info-drawer [data-info-row]').length === 11`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const panel = document.querySelector('.panel[data-slot="1"]').getBoundingClientRect()
      const x = panel.left + 12
      const y = panel.bottom - 12
      document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }))
    })()`)
    await waitForExpression(target, `!document.querySelector('.info-drawer')`)
    // Match clock from 365Scores (preciseGameTime): a box after the names, ticking every second.
    await waitForExpression(target, `/^1T (29|30):\\d\\d$/.test(document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.clock ?? '')`, 9000).catch(async (error) => {
      const label = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({ ...document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset })`)
      throw new Error(`${error.message}; rótulo: ${label}`)
    })
    const clockBefore = await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__label-clock-time').textContent`)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__label-clock-time')?.textContent !== ${JSON.stringify(clockBefore)}`, 3000)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `[...document.querySelector('.panel[data-slot="1"] .panel__label-chip').children].slice(-2, -1)[0].className`),
      'panel__label-clock', 'O relógio vem depois do 2º time, antes do ×.')
    // VAR review from the mobile game center: a blue badge while it runs, gone once the VAR decides.
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="1"] .panel__var-text')?.textContent === "Revisão: pênalti · 26' Zofia Burzan"`, 15000).catch((error) => {
      throw new Error(`${error.message}; leituras do game center: ${gameCenterRequests}`)
    })
    await waitForExpression(target, `!document.querySelector('.panel[data-slot="1"] .panel__var')`, 20000)

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
    const byTime = await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('.bll-batch [data-order="time"]').click()
      const result = {
        pressed: document.querySelector('.bll-batch [data-order="time"]').getAttribute('aria-pressed'),
        groups: document.querySelectorAll('.bll-batch__group').length,
        items: [...document.querySelectorAll('.bll-batch__item')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()),
        ok: document.querySelector('.bll-batch [data-ok]').textContent,
        saved: localStorage.getItem('quadra:bll-batch-order'),
      }
      document.querySelector('.bll-batch [data-order="league"]').click()
      return { ...result, back: document.querySelectorAll('.bll-batch__group').length, okBack: document.querySelector('.bll-batch [data-ok]').textContent }
    })()`)
    assert.deepEqual(byTime, {
      pressed: 'true',
      groups: 1,
      items: ['17:00 Time E x Time F Brasil, Liga Teste, Grupo A', '17:00 Time G x Time H Brasil, Liga Teste, Grupo A', '18:30 🏀 Time I x Time J Brasil, Outra Liga'],
      ok: 'Abrir 2 jogos',
      saved: 'time',
      back: 2,
      okBack: 'Abrir 2 jogos',
    }, 'Por horário deve mostrar uma lista só, com a competição ao lado, mantendo os jogos marcados.')
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
    // The panel's YouTube button may already have searched once (more than 60 s ago, past the cache).
    assert.equal(new Set(playlistQueries.map((query) => query.playlistId)).size, 10, 'A lista padrão tem 10 canais, um playlistItems por canal.')
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

    // Ctrl + / Ctrl - / Ctrl + wheel inside an open player zoom only the overlay UI.
    const zoomPanel = (await fetchJson(`http://127.0.0.1:${port}/json`))
      .find((page) => page.type === 'page' && page.url.startsWith(`${baseUrl}/page?slot=`))
    assert.ok(zoomPanel, 'Nenhum painel aberto para testar o zoom.')
    const uiZoom = () => evaluate(target.webSocketDebuggerUrl, `({ ratio: window.devicePixelRatio,
      button: document.querySelector('[data-mute]').getBoundingClientRect().width * window.devicePixelRatio,
      // The ⋯ button: the text buttons shrink below 1000 CSS px, which a zoomed 1024 px window (CI) crosses.
      toolbar: document.querySelector('#btn-more').getBoundingClientRect().height * window.devicePixelRatio,
      panel: document.querySelector('.panel[data-slot="0"]').getBoundingClientRect().width * window.devicePixelRatio })`)
    const playerSize = () => evaluate(zoomPanel.webSocketDebuggerUrl, `({ ratio: window.devicePixelRatio, width: window.innerWidth * window.devicePixelRatio })`)
    // DevTools input skips Electron's input hooks, so the keys and the wheel go through the player's sendInputEvent.
    const mainProcess = (await fetchJson(`http://127.0.0.1:${inspectPort}/json`))[0]
    const inPlayer = (events) => sendCdp(mainProcess.webSocketDebuggerUrl, 'Runtime.evaluate', {
      includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const { webContents } = require('electron')
        const player = webContents.getAllWebContents().find((contents) => contents.getURL() === ${JSON.stringify(zoomPanel.url)})
        if (!player) return false
        for (const event of ${JSON.stringify(events)}) { player.sendInputEvent(event); await new Promise((resolve) => setTimeout(resolve, 30)) }
        return true
      })()`,
    }).then((result) => assert.equal(result.result?.value, true, `Não deu para mandar teclas ao player: ${JSON.stringify(result)}`))
    const pressInPlayer = (keyCode) => inPlayer(['keyDown', 'keyUp'].map((type) => ({ type, keyCode, modifiers: ['control'] })))
    const wheelInPlayer = (deltaY) => inPlayer([{ type: 'mouseWheel', x: 40, y: 40, deltaX: 0, deltaY, wheelTicksX: 0, wheelTicksY: Math.sign(deltaY), canScroll: true, modifiers: ['control'] }])
    const waitForZoom = async (predicate, message) => {
      const deadline = Date.now() + 5000
      let last
      while (Date.now() < deadline) {
        last = await uiZoom()
        if (predicate(last)) return last
        await wait(100)
      }
      throw new Error(`${message} (${JSON.stringify(last)})`)
    }
    const zoomBefore = await uiZoom()
    const playerBefore = await playerSize()
    await pressInPlayer('=')
    const zoomedIn = await waitForZoom((value) => value.ratio > zoomBefore.ratio, 'Ctrl + no player não aumentou a interface.')
    assert.ok(zoomedIn.button > zoomBefore.button * 1.05, 'Os botões do painel não cresceram com Ctrl +.')
    assert.ok(zoomedIn.toolbar > zoomBefore.toolbar * 1.05, 'A barra de baixo não cresceu com Ctrl +.')
    await wait(400)
    assert.ok(Math.abs((await uiZoom()).panel - zoomBefore.panel) <= 3, 'O zoom da interface mudou o tamanho do painel.')
    const playerZoomed = await playerSize()
    assert.equal(playerZoomed.ratio, playerBefore.ratio, 'Ctrl + deu zoom na página do player.')
    assert.ok(Math.abs(playerZoomed.width - playerBefore.width) <= 3, 'O zoom da interface mudou o tamanho do player.')
    await pressInPlayer('-')
    await pressInPlayer('-')
    await waitForZoom((value) => value.ratio < zoomBefore.ratio, 'Ctrl - no player não diminuiu a interface.')
    await wheelInPlayer(120)
    await waitForZoom((value) => Math.abs(value.ratio - zoomBefore.ratio) < 0.01, 'Ctrl + roda do mouse no player não aumentou a interface.')
    await wheelInPlayer(120)
    await waitForZoom((value) => value.ratio > zoomBefore.ratio, 'Ctrl + roda do mouse no player não aumentou a interface de novo.')
    await pressInPlayer('0')
    await waitForZoom((value) => Math.abs(value.ratio - zoomBefore.ratio) < 0.01, 'Ctrl 0 no player não voltou a interface ao tamanho normal.')
    assert.equal((await playerSize()).ratio, playerBefore.ratio, 'O player ficou com zoom.')
    assert.deepEqual((await fetchJson(`http://127.0.0.1:${port}/json`)).filter((page) => page.url.startsWith(`${baseUrl}/page?slot=`)).map((page) => page.id).sort(),
      [...stablePageIds].sort(), 'O zoom da interface recriou uma página.')

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
    // Auto mode from the start screen: games live in a listed competition open on their own; a game the user closes stays closed.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-start-auto-open').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.auto-open [data-add-competition]'))`)
    await evaluate(target.webSocketDebuggerUrl, `(() => {
      const form = document.querySelector('.auto-open [data-add-competition]')
      form.querySelector('input').value = 'Brasil, Liga Teste'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      document.querySelector('.auto-open [data-auto-open-toggle]').click()
    })()`)
    await waitForExpression(target, `Boolean(document.querySelector('.grid--2'))`, 20000)
    assert.deepEqual(await evaluate(target.webSocketDebuggerUrl,
      `[...document.querySelectorAll('.panel input[name="url"]')].map((input) => new URL(input.value).pathname)`),
    ['/view/game-c', '/view/game-d'], 'O modo Auto abre só os jogos ao vivo da competição da lista (sem o previsto nem o de basquete).')
    assert.match(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.auto-open [data-auto-open-status]').textContent`), /^Ligado · lista lida às \d\d:\d\d · 2 jogos abertos pelo modo Auto/)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.auto-open [data-cancel]').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-more').classList.contains('is-auto-open')`), true)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] [data-remove]').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 1`)
    await wait(4000)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelectorAll('.panel').length`), 1, 'Um jogo fechado pelo usuário não volta no modo Auto.')
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-auto-open').click()`)
    await waitForExpression(target, `document.querySelector('.auto-open [data-auto-open-toggle]')?.textContent === 'Desligar modo Auto'`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.auto-open [data-auto-open-toggle]').click(); document.querySelector('.auto-open [data-cancel]').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-more').classList.contains('is-auto-open')`), false)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click(); document.querySelector('.confirm [data-ok]').click()`)
    await waitForExpression(target, `Boolean(document.querySelector('.chooser'))`)

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
    // William Hill clock: the board's tick (each second) in the second half; it goes away with the end of the match.
    await waitForExpression(target, `/^2T 67:\\d\\d$/.test(document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset.clock ?? '')`, 8000).catch(async (error) => {
      const label = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({ ...document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset })`)
      throw new Error(`${error.message}; rótulo: ${label}`)
    })
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
    // A BLL American football game ("🏈") goes to 365Scores even with a William Hill id, and alerts the touchdown.
    await openFinishingMatch(1, 0, `nfl?evento=${encodeURIComponent('🏈 Packers x Panthers')}&wh=7101`)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset.score === '7 – 0'`, 30000).catch(async (error) => {
      const label = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({ ...document.querySelector('.panel[data-slot="1"] .panel__label')?.dataset })`)
      throw new Error(`${error.message}; rótulo: ${label}; listas de futebol americano: ${americanFootballListRequests}; detalhes: ${americanFootballDetailRequests}`)
    })
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__label').dataset.label`), 'Green Bay Packers x Carolina Panthers',
      'O rótulo do jogo de futebol americano usa os nomes do 365Scores.')
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"]')?.classList.contains('panel--alert-touchdown')`, 20000)
    assert.match(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__alert')?.textContent ?? ''`), /TOUCHDOWN · Green Bay Packers \(passe · 1º quarto\) · 7 - 0/)
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
    // Half-time: the user's highlight goes to its break and swaps places with the game being played (not the 🏈 one, which has no clock), then comes back.
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-add-panel').click()`)
    await waitForExpression(target, `document.querySelectorAll('.panel').length === 3`)
    await openFinishingMatch(2, 300, `wh-7202?evento=${encodeURIComponent('Time J x Time K')}&wh=7202`)
    await openFinishingMatch(0, 300, `wh-7201?evento=${encodeURIComponent('Time H x Time I')}&wh=7201`)
    await waitForExpression(target, `/^1T 44:\\d\\d$/.test(document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset.clock ?? '')`, 12000)
    // In "auto" mode the layout may already have made this panel big: the first ★ then turns highlights off, the next one sets it.
    const highlightSlotZero = `(() => {
      const panel = document.querySelector('.panel[data-slot="0"]')
      if (!panel.classList.contains('is-highlighted') || document.querySelector('.layout-stage')?.dataset.layoutMode !== 'highlights') panel.querySelector('[data-highlight]').click()
      return document.querySelector('.panel[data-slot="0"]').classList.contains('is-highlighted') && document.querySelector('.layout-stage').dataset.layoutMode === 'highlights'
    })()`
    if (!(await evaluate(target.webSocketDebuggerUrl, highlightSlotZero))) await evaluate(target.webSocketDebuggerUrl, highlightSlotZero)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="0"]')?.classList.contains('is-highlighted')`)
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="2"]')?.classList.contains('is-highlighted') && !document.querySelector('.panel[data-slot="0"]').classList.contains('is-highlighted')`, 20000).catch(async (error) => {
      const state = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify([...document.querySelectorAll('.panel')].map((panel) => ({ slot: panel.dataset.slot, highlighted: panel.classList.contains('is-highlighted'), clock: panel.querySelector('.panel__label')?.dataset.clock })))`)
      throw new Error(`${error.message}; painéis: ${state}`)
    })
    const halftimeBadge = JSON.parse(await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({
      text: document.querySelector('.panel[data-slot="2"] .panel__halftime-text')?.textContent,
      label: document.querySelector('.panel[data-slot="0"] .panel__label')?.dataset.label,
    })`))
    assert.equal(halftimeBadge.text, `Intervalo em ${halftimeBadge.label}`, 'O jogo que entrou no destaque diz de qual intervalo veio.')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"]').classList.contains('is-highlighted')`), false,
      'Jogo sem relógio (🏈) não entra no destaque do intervalo.')
    await waitForExpression(target,
      `document.querySelector('.panel[data-slot="0"]')?.classList.contains('is-highlighted') && !document.querySelector('.panel[data-slot="2"]').classList.contains('is-highlighted') && !document.querySelector('.panel__halftime')`, 25000).catch(async (error) => {
      const state = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify([...document.querySelectorAll('.panel')].map((panel) => ({ slot: panel.dataset.slot, highlighted: panel.classList.contains('is-highlighted'), clock: panel.querySelector('.panel__label')?.dataset.clock })))`)
      throw new Error(`${error.message}; painéis: ${state}`)
    })
    // A William Hill goal alerts at once with the shirt number only; the scorer's name joins the same alert when the line-up gives it.
    await openFinishingMatch(1, 300, `wh-7301?evento=${encodeURIComponent('Time W x Time Z')}&wh=7301`)
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"]')?.classList.contains('panel--alert-goal')`, 20000)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__alert-player')?.textContent ?? ''`), '',
      'O alerta do gol sai na hora, sem esperar o nome.')
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__alert-player')?.textContent === ' · Gabriel Silva'`, 15000).catch(async (error) => {
      const alert = await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__alert')?.textContent ?? null`)
      throw new Error(`${error.message}; alerta: ${JSON.stringify(alert)}`)
    })
    assert.match(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__alert')?.textContent ?? ''`), /GOL · Time W · 51' · 1 - 0 · Gabriel Silva/)
    // A William Hill game that 365Scores doesn't have: the drawer shows William Hill's own line-up (starters only, names formatted).
    await waitForExpression(target, `document.querySelector('.panel[data-slot="1"] .panel__info') !== null`, 15000)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.panel[data-slot="1"] .panel__info').click()`)
    await waitForExpression(target, `document.querySelectorAll('.info-drawer [data-info-row]').length === 2`, 10000)
    const whLineup = await evaluate(target.webSocketDebuggerUrl, `JSON.stringify({
      names: [...document.querySelectorAll('.info-drawer .info-row__name')].map((node) => node.textContent),
      note: document.querySelector('.info-drawer [data-info-note]').textContent,
      ratingShown: getComputedStyle(document.querySelector('.info-drawer .info-row__rating')).display !== 'none',
      coach: document.querySelector('.info-drawer [data-info-coach]') !== null,
    })`)
    assert.deepEqual(JSON.parse(whLineup), { names: ['Lautaro Herrera', 'Gabriel Silva'], note: 'Fonte: William Hill', ratingShown: false, coach: false })
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.info-drawer [data-info-close]').click()`)
    process.stdout.write(JSON.stringify({ lineupDrawer: true, scorerName: true, chooser: true, bllsportCatalog: true, bllsportSequentialPanels: true, bllsportExplicitReplacement: true, bllsportBatch: true, bllsportBatchFromChooser: true, closesFinishedMatch: true, closesFinished365Match: true, closesBllEndedMatch: true, halftimeSwap: true, bllBasketball365: true, youtubeLivesBatch: true, youtubePlayerOnly: true, twoElectronViews: true, blockedFramePolicyPage: true, reorganizedWithoutReload: true, removesOnlyChosenPanel: true, clear: true, returnToChooser: true }) + '\n')
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
