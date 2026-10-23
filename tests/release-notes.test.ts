import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RELEASES, releaseToShow, type Release } from '../src/release-notes.ts'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const currentVersion = packageJson.version

const customReleases: readonly Release[] = [
  { version: '2.0.0', label: '2.0', notes: [{ title: 'Novidade', body: 'Corpo da novidade' }] },
]

test('releaseToShow retorna a versão atual quando lastSeen é null (primeira execução após atualizar)', () => {
  const release = releaseToShow(currentVersion, null)
  assert.ok(release)
  assert.equal(release.version, currentVersion)
})

test('releaseToShow retorna a versão atual quando lastSeen é uma versão anterior', () => {
  const release = releaseToShow(currentVersion, '1.0.16')
  assert.ok(release)
  assert.equal(release.version, currentVersion)
})

test('releaseToShow retorna null quando lastSeen é igual à versão atual', () => {
  assert.equal(releaseToShow(currentVersion, currentVersion), null)
})

test('releaseToShow retorna null quando a versão atual não tem entrada', () => {
  assert.equal(releaseToShow('9.9.9', null), null)
  assert.equal(releaseToShow('9.9.9', '1.0.16'), null)
})

test('releaseToShow usa o array de releases informado', () => {
  assert.equal(releaseToShow('2.0.0', null, customReleases), customReleases[0])
  assert.equal(releaseToShow('2.0.0', '2.0.0', customReleases), null)
  assert.equal(releaseToShow('1.1.0', null, customReleases), null)
})

test('RELEASES tem entrada para a versão do package.json', () => {
  const entry = RELEASES.find((release) => release.version === currentVersion)
  assert.ok(entry, `falta entrada em RELEASES para ${currentVersion}`)
})

test('RELEASES: cada entrada tem label e pelo menos uma nota', () => {
  for (const release of RELEASES) {
    assert.ok(release.label.trim().length > 0, `label vazio em ${release.version}`)
    assert.ok(release.notes.length >= 1, `sem notas em ${release.version}`)
  }
})

test('RELEASES: toda nota tem título e corpo não vazios', () => {
  for (const release of RELEASES) {
    for (const note of release.notes) {
      assert.ok(note.title.trim().length > 0, `título vazio em ${release.version}`)
      assert.ok(note.body.trim().length > 0, `corpo vazio em ${release.version} (${note.title})`)
    }
  }
})

test('RELEASES: versões são únicas', () => {
  const versions = RELEASES.map((release) => release.version)
  assert.equal(new Set(versions).size, versions.length)
})
