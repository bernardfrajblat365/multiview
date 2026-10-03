const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(check) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await wait(50)
  }
  throw new Error('O aplicativo não ficou pronto para o teste de fechamento.')
}

async function runWorker() {
  const { app, BaseWindow, BrowserWindow, webContents } = require('electron')
  // Report failures to the parent instead of opening Electron's error dialog.
  const fail = (error) => {
    console.error(error?.stack ?? error)
    app.exit(1)
  }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND')
  await import(pathToFileURL(path.join(projectRoot, 'out', 'main', 'main.js')).href)
  const overlay = await waitFor(() => BrowserWindow.getAllWindows().find(
    (window) => window.webContents.getURL().includes('/renderer/index.html'),
  ))
  await waitFor(() => overlay.webContents.executeJavaScript("Boolean(document.querySelector('.chooser'))"))
  await overlay.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-count="2"]').click()
    document.querySelectorAll('.panel input[name="url"]').forEach((input, index) => {
      input.value = ${JSON.stringify(process.env.QUADRA_CLOSE_TEST_URL)} + '?slot=' + index
    })
    document.querySelector('#btn-open-all').click()
  })()`)
  const contents = await waitFor(() => {
    const pages = webContents.getAllWebContents().filter((page) => page.getTitle() === 'Quadra Close Test')
    return pages.length === 2 ? pages : null
  })
  for (const page of contents) page.once('destroyed', () => console.log('REMOTE_DESTROYED'))
  console.log('READY_TO_CLOSE')
  if (process.env.QUADRA_CLOSE_TEST_ACTION === 'quit') {
    app.quit()
  } else {
    const mainWindow = BaseWindow.getAllWindows().find((window) => window !== overlay)
    assert.ok(mainWindow, 'Janela principal não encontrada.')
    mainWindow.close()
  }
}

async function runParent() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Quadra Close Test</title><p>Local page for shutdown regression.</p>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    for (const action of ['close', 'quit']) {
      const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-close-smoke-'))
      const childEnv = { ...process.env }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [__filename, '--worker'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...childEnv,
          QUADRA_TEST_USER_DATA: userData,
          QUADRA_CLOSE_TEST_ACTION: action,
          QUADRA_CLOSE_TEST_URL: `http://127.0.0.1:${server.address().port}/page`,
        },
      })
      let output = ''
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
      let timer
      try {
        const code = await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Timeout no fechamento (${action}).\n${output}`)), 20000)
          child.once('error', reject)
          child.once('exit', resolve)
        })
        assert.equal(code, 0, `Falha no fechamento (${action}).\n${output}`)
        assert.match(output, /READY_TO_CLOSE/)
        assert.equal((output.match(/REMOTE_DESTROYED/g) ?? []).length, 2, output)
        console.log(JSON.stringify({ action, openPanels: 2, destroyedPanels: 2, exitCode: code }))
      } finally {
        clearTimeout(timer)
        if (child.exitCode === null && child.pid) {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        }
        // Only remove the exact temporary profile created by this test.
        const resolved = path.resolve(userData)
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
        assert.ok(path.basename(resolved).startsWith('quadra-close-smoke-'))
        await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

if (process.argv.includes('--worker')) {
  runWorker().catch((error) => {
    console.error(error?.stack ?? error)
    require('electron').app.exit(1)
  })
} else {
  runParent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
