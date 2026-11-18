import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { MessageBoxOptions } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { createAutoUpdateController } from '../electron/update.ts'
import { readFileSync } from 'node:fs'
import { buildReleaseBody, fetchGitHubReleaseNotes, formatReleaseNotesForDialog, parseReleaseNotes, releaseNotesFromUpdateInfo } from '../electron/release-notes.ts'

test('parseReleaseNotes limpa marcadores do GitHub e remove duplicados', () => {
  const body = '## Novidades\n* feat: Botão novo by @user in https://github.com/a/b/pull/1\n- fix: Botão novo\n**Full Changelog**: https://x'
  assert.deepEqual(parseReleaseNotes(body), ['Botão novo'])
  assert.deepEqual(parseReleaseNotes(null), [])
})

test('parseReleaseNotes ignora a seção "Como instalar" do release', () => {
  const body = [
    '## Como instalar',
    '1. Baixe o instalador.',
    '- **"O Windows protegeu seu computador"**: clique em Mais informações.',
    '- **"Não é baixado com frequência"** (Edge ou Chrome): clique em Manter.',
    '',
    "## What's Changed",
    '* feat: Aba Estatísticas by @user in https://github.com/a/b/pull/47',
  ].join('\n')
  assert.deepEqual(parseReleaseNotes(body), [])
})

test('texto do release gerado mostra no aviso só os títulos das novidades', () => {
  const install = readFileSync(new URL('../.github/release-install.md', import.meta.url), 'utf8')
  const body = buildReleaseBody(
    [
      { title: 'Modo Auto no YouTube', body: 'O Modo Auto também procura nas lives.' },
      { title: 'Estatísticas do jogo', body: 'A gaveta ganhou a aba Estatísticas.' },
    ],
    install,
  )
  assert.deepEqual(parseReleaseNotes(body), ['Modo Auto no YouTube', 'Estatísticas do jogo'])
  // Leitor das versões já instaladas (1.3.2 e anteriores): todo item "- "/"* " vira novidade.
  const oldReader = body.split('\n').map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line))
  assert.deepEqual(oldReader, ['- **Modo Auto no YouTube**', '- **Estatísticas do jogo**'])
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
