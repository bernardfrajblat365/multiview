// Run: node tests/bll-feed-diagnostic.cjs [seconds]  (QUADRA_FEED_URL overrides the page)
// Opens the full BLL view page (without view=clean) using a copy of the Quadra
// persist:quadra partition and records feed-related network traffic and DOM.
// Never stores cookies, request headers or auth responses.
const { spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const DEFAULT_URL = 'https://www.bllsport.com/view/6ad6304a59ba8dce6cacb1c3'

if (!process.versions.electron) {
  const sourceProfile = join(process.env.APPDATA ?? '', 'quadra-multiview')
  const profile = mkdtempSync(join(tmpdir(), 'quadra-bll-feed-'))
  if (existsSync(join(sourceProfile, 'Local State'))) cpSync(join(sourceProfile, 'Local State'), join(profile, 'Local State'))
  if (existsSync(join(sourceProfile, 'Partitions', 'quadra'))) {
    cpSync(join(sourceProfile, 'Partitions', 'quadra'), join(profile, 'Partitions', 'quadra'), {
      recursive: true,
      filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache)([\\/]|$)/.test(src),
    })
  }
  const env = { ...process.env, QUADRA_FEED_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 15 * 60 * 1000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  // The copied partition holds the user's cookies; never leave it behind.
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow, session } = require('electron')
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const targetUrl = process.env.QUADRA_FEED_URL ?? DEFAULT_URL
  const seconds = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 120)
  const outDir = join(__dirname, '..', 'artifacts', 'bll-feed')
  mkdirSync(outDir, { recursive: true })
  app.setPath('userData', process.env.QUADRA_FEED_PROFILE)

  const SENSITIVE_RE = /login|logout|auth|token|session|senha|password|license|widevine|cookie/i
  const STATIC_RE = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|css|mp4|m4s|ts|aac|m3u8|mpd)(\?|$)/i
  const requests = new Map()
  const log = []
  const bodies = []
  const wsFrames = []
  const domSnapshots = []

  function redactUrl(raw) {
    try {
      const url = new URL(raw)
      for (const [key, value] of url.searchParams) {
        if (/token|key|sig|auth|session|jwt/i.test(key) || value.length > 40) url.searchParams.set(key, '<redacted>')
      }
      return url.toString()
    } catch {
      return String(raw).slice(0, 300)
    }
  }

  const domProbe = `(() => {
    const out = {
      href: location.href,
      title: document.title,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight,
      iframes: [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, rect: f.getBoundingClientRect().toJSON() })),
      classes: [...new Set([...document.querySelectorAll('[class]')].flatMap((e) => [...e.classList]))].slice(0, 400),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
      globals: Object.keys(window).filter((k) => /sir|sportradar|widget|lmt|stats|perform|genius|betradar/i.test(k)),
    }
    const video = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    const videoBottom = video ? video.getBoundingClientRect().bottom : 0
    const blocks = []
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect()
      if (rect.top < videoBottom - 2 || rect.height < 8) continue
      const text = (el.innerText || '').trim()
      if (!text || el.children.length > 6) continue
      blocks.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 120), id: el.id, top: Math.round(rect.top), text: text.slice(0, 200) })
      if (blocks.length > 250) break
    }
    out.belowVideo = blocks
    const root = document.querySelector('#app') || document.body
    out.htmlSample = root.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/gi, '').slice(0, 400000)
    return out
  })()`

  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      width: 460,
      height: 900,
      show: true,
      title: 'Quadra BLL feed diagnostic',
      webPreferences: {
        session: session.fromPartition('persist:quadra'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    win.webContents.audioMuted = true
    const dbg = win.webContents.debugger
    dbg.attach('1.3')

    const send = (method, params, sessionId) => Promise.race([
      dbg.sendCommand(method, params, sessionId),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timeout`)), 3000)),
    ])
    const enableSession = async (sessionId) => {
      await send('Network.enable', { maxResourceBufferSize: 10_000_000, maxTotalBufferSize: 50_000_000 }, sessionId).catch((e) => console.log(e.message))
      if (process.argv.includes('--iframes')) {
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch((e) => console.log(e.message))
      }
    }

    dbg.on('message', async (_event, method, params, sessionId) => {
      if (method === 'Target.attachedToTarget') {
        log.push({ t: Date.now(), type: 'target', targetType: params.targetInfo.type, url: redactUrl(params.targetInfo.url) })
        await enableSession(params.sessionId)
        return
      }
      if (method === 'Network.requestWillBeSent') {
        const { requestId, request, type } = params
        requests.set(requestId, { url: request.url, method: request.method, type, sessionId })
        if (STATIC_RE.test(request.url)) return
        log.push({ t: Date.now(), type: 'request', resource: type, method: request.method, url: redactUrl(request.url), frame: sessionId ? 'child' : 'main' })
        return
      }
      if (method === 'Network.loadingFinished') {
        const req = requests.get(params.requestId)
        if (!req || !['XHR', 'Fetch', 'Script', 'Document'].includes(req.type)) return
        if (SENSITIVE_RE.test(req.url) || STATIC_RE.test(req.url)) return
        if (req.type === 'Script' && !/sportradar|widget|lmt|stats|tracker|genius|perform/i.test(req.url)) return
        try {
          const body = await send('Network.getResponseBody', { requestId: params.requestId }, req.sessionId)
          const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
          bodies.push({ t: Date.now(), type: req.type, url: redactUrl(req.url), size: text.length, body: text.slice(0, req.type === 'Script' ? 3000 : 200000) })
        } catch {}
        return
      }
      if (method === 'Network.webSocketCreated') {
        log.push({ t: Date.now(), type: 'websocket', url: redactUrl(params.url) })
        return
      }
      if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
        const payload = params.response?.payloadData ?? ''
        if (SENSITIVE_RE.test(payload.slice(0, 200)) && method.endsWith('Sent')) return
        if (wsFrames.length < 3000) wsFrames.push({ t: Date.now(), dir: method.endsWith('Received') ? 'in' : 'out', size: payload.length, data: payload.slice(0, 500000) })
      }
    })
    await enableSession(undefined)

    const flush = () => {
      writeFileSync(join(outDir, 'network-log.json'), JSON.stringify(log, null, 2))
      writeFileSync(join(outDir, 'response-bodies.json'), JSON.stringify(bodies, null, 2))
      writeFileSync(join(outDir, 'websocket-frames.json'), JSON.stringify(wsFrames, null, 2))
      writeFileSync(join(outDir, 'dom-snapshots.json'), JSON.stringify(domSnapshots, null, 2))
    }

    console.log(`Loading ${targetUrl} for ${seconds}s → ${outDir}`)
    win.loadURL(targetUrl).catch((error) => console.error('loadURL:', error.message))
    const started = Date.now()
    while (Date.now() - started < seconds * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 15000))
      const snapshot = await win.webContents.executeJavaScript(domProbe).catch((error) => ({ error: error.message }))
      const { htmlSample, ...summary } = snapshot
      domSnapshots.push({ t: Date.now(), ...summary })
      if (htmlSample) writeFileSync(join(outDir, 'page.html'), htmlSample)
      await win.webContents.capturePage().then((image) => writeFileSync(join(outDir, 'page.png'), image.toPNG())).catch(() => {})
      flush()
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${snapshot.href ?? ''} requests=${log.length} bodies=${bodies.length} ws=${wsFrames.length} iframes=${snapshot.iframes?.length ?? '?'}`)
    }
    flush()
    try { dbg.detach() } catch {}
    win.destroy()
    app.exit(0)
  })
}
