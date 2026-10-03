const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const projectRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const tagOnly = args[0] === '--tag-only'
const tag = tagOnly ? args[1] : args[0] || `v${packageJson.version}`
const releaseDir = path.resolve(projectRoot, tagOnly ? args[2] || 'release' : args[1] || 'release')
const expectedTag = `v${packageJson.version}`

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (tag !== expectedTag) {
  fail(`Tag ${tag || '(vazia)'} não corresponde à versão ${packageJson.version} (esperado ${expectedTag}).`)
} else if (tagOnly) {
  process.stdout.write(JSON.stringify({ tag, version: packageJson.version }) + '\n')
} else {
  const installer = `Quadra-Setup-${packageJson.version}.exe`
  const assets = [installer, `${installer}.blockmap`, 'latest.yml']
  const missing = assets.filter((asset) => {
    const file = path.join(releaseDir, asset)
    return !fs.existsSync(file) || fs.statSync(file).size === 0
  })

  if (missing.length > 0) {
    fail(`Artefatos ausentes ou vazios em ${releaseDir}: ${missing.join(', ')}`)
  } else {
    const metadataPath = path.join(releaseDir, 'latest.yml')
    const metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8')) ?? {}
    const installerPath = path.join(releaseDir, installer)
    const installerBytes = fs.readFileSync(installerPath)
    const actualSha512 = crypto.createHash('sha512').update(installerBytes).digest('base64')
    const fileEntry = Array.isArray(metadata.files)
      ? metadata.files.find((file) => file && file.url === installer)
      : null

    if (metadata.version !== packageJson.version || metadata.path !== installer || !fileEntry) {
      fail(`latest.yml não aponta exatamente para ${installer} na versão ${packageJson.version}.`)
    }
    if (metadata.sha512 !== actualSha512 || fileEntry.sha512 !== actualSha512) {
      fail(`SHA-512 de ${installer} não corresponde ao metadata.`)
    }
    if (fileEntry.size !== installerBytes.length) {
      fail(`Tamanho de ${installer} não corresponde ao metadata.`)
    }

    process.stdout.write(JSON.stringify({
      tag,
      version: packageJson.version,
      releaseDir,
      assets,
      installerBytes: installerBytes.length,
      sha512: actualSha512,
    }) + '\n')
  }
}

