import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RELEASES, releaseHistory, releaseToShow, type Release } from '../src/release-notes.ts'

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

const historyReleases: readonly Release[] = [
  { version: '2.0.0', label: '2.0', notes: [{ title: 'Dois', body: 'Corpo dois' }] },
  { version: '1.1.0', label: '1.1', notes: [{ title: 'Um um', body: 'Corpo um um' }] },
  { version: '1.0.0', label: '1.0', notes: [{ title: 'Um zero', body: 'Corpo um zero' }] },
]

test('releaseHistory com a versão mais nova retorna todas as versões na ordem', () => {
  assert.deepEqual(releaseHistory(historyReleases[0], historyReleases), historyReleases)
})

test('releaseHistory com uma versão do meio retorna ela e só as mais antigas', () => {
  assert.deepEqual(releaseHistory(historyReleases[1], historyReleases), [historyReleases[1], historyReleases[2]])
})

test('releaseHistory com a versão mais antiga retorna só ela', () => {
  assert.deepEqual(releaseHistory(historyReleases[2], historyReleases), [historyReleases[2]])
})

test('releaseHistory com versão fora da lista retorna só essa versão', () => {
  const outside: Release = { version: '9.9.9', label: '9.9', notes: [{ title: 'Fora', body: 'Corpo fora' }] }
  const result = releaseHistory(outside, historyReleases)
  assert.equal(result.length, 1)
  assert.equal(result[0], outside)
})

test('releaseHistory compara pela versão, não pela identidade do objeto', () => {
  const copy: Release = { version: '1.1.0', label: 'cópia', notes: [] }
  const result = releaseHistory(copy, historyReleases)
  assert.deepEqual(result, [historyReleases[1], historyReleases[2]])
  assert.equal(result[0], historyReleases[1])
})

test('releaseHistory usa RELEASES por padrão', () => {
  const index = RELEASES.findIndex((release) => release.version === currentVersion)
  assert.ok(index >= 0, `falta entrada em RELEASES para ${currentVersion}`)
  const result = releaseHistory(RELEASES[index])
  assert.equal(result.length, RELEASES.length - index)
  assert.equal(result[0].version, currentVersion)
  assert.deepEqual(result, RELEASES.slice(index))
})
