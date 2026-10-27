import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { MessageBoxOptions } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { createAutoUpdateController } from '../electron/update.ts'
import { fetchGitHubReleaseNotes, formatReleaseNotesForDialog, parseReleaseNotes, releaseNotesFromUpdateInfo } from '../electron/release-notes.ts'

test('parseReleaseNotes limpa marcadores do GitHub e remove duplicados', () => {
  const body = '## What\'s Changed\n* feat: Botão novo by @user in https://github.com/a/b/pull/1\n- fix: Botão novo\n**Full Changelog**: https://x'
  assert.deepEqual(parseReleaseNotes(body), ['Botão novo'])
  assert.deepEqual(parseReleaseNotes(null), [])
})

test('releaseNotesFromUpdateInfo aceita string e lista', () => {
  assert.deepEqual(releaseNotesFromUpdateInfo({ releaseNotes: '- a' }), ['a'])
  assert.deepEqual(releaseNotesFromUpdateInfo({ releaseNotes: [{ note: '- b' }, '- b', '- c'] }), ['b', 'c'])
  assert.deepEqual(releaseNotesFromUpdateInfo({}), [])
})

test('formatReleaseNotesForDialog limita itens', () => {
  assert.equal(formatReleaseNotesForDialog(['a', 'b', 'c'], 2), '• a\n• b\n• … e mais 1')
  assert.equal(formatReleaseNotesForDialog([]), '')
})

test('fetchGitHubReleaseNotes lê o corpo do release e ignora erro HTTP', async () => {
  let url = ''
  const ok = (async (u: string) => { url = u; return { ok: true, json: async () => ({ body: '- x' }) } }) as unknown as typeof fetch
  assert.deepEqual(await fetchGitHubReleaseNotes('v1.2.0', ok), ['x'])
  assert.match(url, /releases\/tags\/v1\.2\.0$/)
  const bad = (async () => ({ ok: false })) as unknown as typeof fetch
  assert.deepEqual(await fetchGitHubReleaseNotes('1.2.0', bad), [])
})

test('diálogo de atualização mostra as novidades (feed ou fallback)', async () => {
  for (const withFeed of [true, false]) {
    const updater = Object.assign(new EventEmitter(), {
      checkForUpdates: async () => ({ isUpdateAvailable: true }),
      downloadUpdate: async () => [],
    })
    const dialogs: MessageBoxOptions[] = []
    const controller = createAutoUpdateController({
      enabled: true,
      updater: updater as unknown as AppUpdater,
      showMessageBox: async (o) => { dialogs.push(o); return { response: 1 } },
      quitAndInstall: () => {},
      fetchReleaseNotes: async () => ['do fallback'],
    })
    const pending = controller.check()
    updater.emit('update-available', withFeed ? { version: '1.2.0', releaseNotes: '- do feed' } : { version: '1.2.0' })
    await pending
    await new Promise((r) => setImmediate(r))
    assert.match(String(dialogs[0]?.detail), withFeed ? /• do feed/ : /• do fallback/)
  }
})
