const electronModule = require('electron')
if (typeof electronModule === 'string') {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electronModule, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = electronModule
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const logPath = path.join(os.tmpdir(), 'quadra-renderer-visual.log')
const scenario = process.argv.at(-1)
app.commandLine.appendSwitch('disable-gpu')

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitFrame(window) {
  await wait(50)
}

async function run() {
  app.disableHardwareAcceleration()
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setBackgroundThrottling(false)

  try {
    const rendererPath = path.join(projectRoot, 'out', 'renderer', 'index.html')
    async function reset() {
      await window.loadFile(rendererPath)
      await wait(700)
    }

    async function choose(count) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-count="${count}"]').click()`)
      await waitFrame(window)
      await wait(120)
    }

    async function capture(name) {
      await wait(700)
      const image = await window.webContents.capturePage()
      const output = path.join(os.tmpdir(), `quadra-${name}.png`)
      fs.writeFileSync(output, image.toPNG())
      fs.appendFileSync(logPath, `${output}\n`)
      console.log(output)
    }

    await reset()
    if (scenario === 'chooser') {
      await capture('chooser')
    } else if (scenario === 'grid-2') {
      await choose(2)
      await capture('grid-2-empty')
    } else if (scenario === 'grid-3-equal') {
      await choose(3)
      await capture('grid-3-equal')
    } else if (scenario === 'grid-3-focus') {
      await choose(3)
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('#btn-organize').click()
        document.querySelector('.panel[data-slot="0"] [data-highlight]').click()
      })()`)
      await waitFrame(window)
      await capture('grid-3-focus')
    } else if (scenario === 'grid-4') {
      await choose(4)
      await capture('grid-4-empty')
    } else if (scenario === 'grid-8') {
      await choose(8)
      await capture('grid-8-empty')
    } else if (scenario === 'overlay') {
      await choose(2)
      await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.panel[data-slot="0"]')
        const form = panel.querySelector('.panel__bar')
        form.querySelector('input[name="url"]').value = 'https://example.com/video'
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        document.querySelector('.panel[data-slot="0"] [data-edit]').click()
      })()`)
      await waitFrame(window)
      await capture('overlay-editing')
    } else if (scenario === 'toolbar-menu') {
      await choose(2)
      await window.webContents.executeJavaScript(`(() => {
        const shell = document.querySelector('.grid-shell')
        const rect = shell.getBoundingClientRect()
        shell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }))
        document.querySelector('#btn-more').click()
      })()`)
      await waitFrame(window)
      await capture('toolbar-menu')
    } else if (scenario === 'grid-16') {
      await choose(16)
      await capture('grid-16-empty')
    } else if (scenario === 'grid-13-hero') {
      await choose(13)
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('#btn-organize').click()
        document.querySelector('.panel[data-slot="0"] [data-highlight]').click()
      })()`)
      await waitFrame(window)
      await capture('grid-13-hero')
    } else {
      throw new Error(`Cenário visual desconhecido: ${scenario}`)
    }
  } finally {
    window.destroy()
    app.exit(0)
  }
}

run().catch((error) => {
  fs.appendFileSync(logPath, `${error?.stack ?? error}\n`)
  console.error(error)
  setTimeout(() => app.exit(1), 100)
})
