const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const expectedVersion = '44.1.0+wvcus'
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const lockedElectron = lock.packages['node_modules/electron']
const dist = path.join(root, 'node_modules/electron/dist')

assert.equal(process.platform, 'win32', 'ECS release verification requires the Windows runtime')
assert.equal(process.env.ELECTRON_OVERRIDE_DIST_PATH, undefined, 'A runtime override can hide an incomplete ECS install')
assert.equal(packageJson.version, expectedVersion)
assert.match(packageJson.repository, /castlabs\/electron-releases/)
assert.match(lockedElectron.resolved, /^git\+https:\/\/github\.com\/castlabs\/electron-releases\.git#/)
assert.equal(fs.readFileSync(path.join(dist, 'version'), 'utf8').trim(), expectedVersion)
assert.equal(fs.readFileSync(path.join(root, 'node_modules/electron/path.txt'), 'utf8').trim(), 'electron.exe')
assert.ok(fs.statSync(path.join(dist, 'electron.exe')).size > 100_000_000, 'ECS executable is missing or unexpectedly small')
assert.ok(fs.statSync(path.join(dist, 'electron.exe.sig')).size > 0, 'ECS VMP signature is missing')

process.stdout.write(JSON.stringify({ ecsVersion: expectedVersion, downloadedRuntime: true, vmpSignature: true }) + '\n')
