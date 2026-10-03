// Run: node tests/drm-diagnostic.cjs. Probes capabilities, not Disney+ playback.
const { spawnSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 120000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
} else {
  const { app, components, WebContentsView, session } = require('electron')
  const assert = require('node:assert/strict')
  const http = require('node:http')
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'quadra-drm-probe-')))
  app.whenReady().then(async () => {
    const server = http.createServer((_req, res) => res.end('<!doctype html><title>DRM probe</title>'))
    let view
    try {
      await components.whenReady()
      console.log('Components:', JSON.stringify(components.status()))
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      view = new WebContentsView({ webPreferences: {
        session: session.fromPartition('persist:quadra'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
      } })
      await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}`)
      const result = await view.webContents.executeJavaScript(`(async () => {
        const result = { secureContext: isSecureContext, eme: typeof navigator.requestMediaKeySystemAccess, codecs: {}, keySystems: {} };
        const video = document.createElement('video');
        for (const type of ['video/mp4; codecs="avc1.42E01E"', 'audio/mp4; codecs="mp4a.40.2"']) result.codecs[type] = video.canPlayType(type);
        for (const key of ['org.w3.clearkey', 'com.widevine.alpha']) {
          try {
            await navigator.requestMediaKeySystemAccess(key, [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]);
            result.keySystems[key] = 'supported';
          } catch (error) { result.keySystems[key] = error.name + ': ' + error.message; }
        }
        return result;
      })()`)
      console.log(JSON.stringify({ versions: process.versions, ...result }, null, 2))
      assert.equal(result.secureContext, true)
      assert.equal(result.eme, 'function')
      assert.equal(result.keySystems['org.w3.clearkey'], 'supported', 'Control key system failed')
      assert.equal(result.keySystems['com.widevine.alpha'], 'supported', 'Widevine unavailable')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      view?.webContents.close()
      server.close()
      app.exit(process.exitCode || 0)
    }
  })
}
