const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { gunzipSync } = require('node:zlib')
const yaml = require('js-yaml')
const asar = require('@electron/asar')
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js')
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js')

function requireFile(file, message) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error(message)
}

function payloadPaths(payloadDir) {
  const exe = path.join(payloadDir, 'Quadra.exe')
  const sig = `${exe}.sig`
  const appAsar = path.join(payloadDir, 'resources', 'app.asar')
  requireFile(exe, 'The extracted payload is missing Quadra.exe.')
  requireFile(sig, 'The extracted payload is missing Quadra.exe.sig.')
  requireFile(appAsar, 'The extracted payload is missing resources/app.asar.')
  return { exe, sig, appAsar }
}

function filesBelow(dir) {
  const files = []
  const pending = [dir]
  while (pending.length) {
    const currentDir = pending.pop()
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const file = path.join(currentDir, entry.name)
      if (entry.isDirectory()) pending.push(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  return files
}

function run7zip(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 600_000 })
  if (result.error || result.status !== 0) throw new Error('7-Zip could not extract the Windows installer payload.')
}

function readProductVersion(exe) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Out.Write((Get-Item -LiteralPath $env:QUADRA_VERIFY_EXE).VersionInfo.ProductVersion)',
  ], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, QUADRA_VERIFY_EXE: exe },
  })
  if (result.error || result.status !== 0) throw new Error('Could not read the packaged executable version.')
  return result.stdout.trim().replace(/^v/i, '').replace(/\.0$/, '')
}

async function compareBlockmap(installer, blockmapFile, tempDir) {
  const actual = JSON.parse(gunzipSync(fs.readFileSync(blockmapFile)).toString('utf8'))
  if (actual.version !== '2' || !Array.isArray(actual.files) || actual.files.length !== 1) {
    throw new Error('The installer blockmap format is invalid.')
  }
  const generatedFile = path.join(tempDir, 'expected-installer.blockmap')
  try {
    await buildBlockMap(installer, 'gzip', generatedFile)
    const expected = JSON.parse(gunzipSync(fs.readFileSync(generatedFile)).toString('utf8'))
    assert.deepEqual(actual, expected, 'The blockmap chunks do not match the installer bytes.')
  } finally {
    fs.rmSync(generatedFile, { force: true })
  }
}

async function verify(installer, expectedVersion, extractionDir) {
  if (process.platform !== 'win32') throw new Error('Installer payload verification must run on Windows.')
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error('Expected version must use x.y.z format.')
  requireFile(installer, 'The Windows installer is missing or empty.')

  const releaseDir = path.dirname(installer)
  const filename = `Quadra-Setup-${expectedVersion}.exe`
  if (path.basename(installer) !== filename) throw new Error('Installer filename does not match the expected version.')
  const metadataFile = path.join(releaseDir, 'latest.yml')
  const blockmapFile = `${installer}.blockmap`
  requireFile(metadataFile, 'latest.yml is missing.')
  requireFile(blockmapFile, 'The installer blockmap is missing.')

  const metadata = yaml.load(fs.readFileSync(metadataFile, 'utf8'))
  const installerBytes = fs.readFileSync(installer)
  const sha512 = crypto.createHash('sha512').update(installerBytes).digest('base64')
  const fileEntry = Array.isArray(metadata?.files) ? metadata.files.find((entry) => entry?.url === filename) : null
  if (metadata?.version !== expectedVersion || metadata?.path !== filename || !fileEntry ||
      metadata.sha512 !== sha512 || fileEntry.sha512 !== sha512 || fileEntry.size !== installerBytes.length) {
    throw new Error('latest.yml does not describe the exact installer bytes and version.')
  }

  if (fs.existsSync(extractionDir) && fs.readdirSync(extractionDir).length !== 0) {
    throw new Error('The extraction directory must be new or empty.')
  }
  fs.mkdirSync(extractionDir, { recursive: true })
  const nsisDir = path.join(extractionDir, 'nsis')
  const appDir = path.join(extractionDir, 'app')
  fs.mkdirSync(nsisDir)
  fs.mkdirSync(appDir)
  const sevenZip = await getPath7za()
  run7zip(sevenZip, ['x', '-bd', '-y', installer, `-o${nsisDir}`])

  let payloadRoot = nsisDir
  const nsisFiles = filesBelow(nsisDir)
  const hasExpandedPayload = nsisFiles.some((file) => path.basename(file).toLowerCase() === 'quadra.exe')
  if (!hasExpandedPayload) {
    const appArchive = nsisFiles.find((file) => /^app-64\.7z$/i.test(path.basename(file)))
    if (!appArchive) throw new Error('The NSIS installer does not contain an expanded Quadra payload or app-64.7z.')
    run7zip(sevenZip, ['x', '-bd', '-y', appArchive, `-o${appDir}`])
    payloadRoot = appDir
  }
  const exe = filesBelow(payloadRoot).find((file) => path.basename(file).toLowerCase() === 'quadra.exe')
  if (!exe) throw new Error('The extracted installer payload is missing Quadra.exe.')
  const payloadDir = path.dirname(exe)
  const { sig, appAsar } = payloadPaths(payloadDir)
  const appPackage = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'))
  const executableVersion = readProductVersion(exe)
  if (appPackage.version !== expectedVersion || executableVersion !== expectedVersion) {
    throw new Error('The executable or packaged app version does not match the release version.')
  }

  await compareBlockmap(installer, blockmapFile, extractionDir)

  const evsEnv = { ...process.env }
  delete evsEnv.EVS_ANY_SKI
  delete evsEnv.EVS_INTERMEDIATE
  const evs = spawnSync(process.env.EVS_PYTHON || 'python', [
    '-m', 'castlabs_evs.vmp', '-n', 'verify-pkg', '--streaming', '--name-hint', 'Quadra', payloadDir,
  ], { encoding: 'utf8', windowsHide: true, timeout: 900_000, env: evsEnv })
  if (evs.error || evs.status !== 0 || !/Signature is valid: streaming,/.test(evs.stdout || '')) {
    throw new Error('The extracted Quadra payload failed production streaming VMP verification.')
  }

  const report = {
    version: expectedVersion,
    installer: {
      file: filename,
      size: installerBytes.length,
      sha256: crypto.createHash('sha256').update(installerBytes).digest('hex'),
      sha512,
    },
    payload: {
      executable: 'Quadra.exe',
      executableSha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
      signature: 'Quadra.exe.sig',
      signatureSha256: crypto.createHash('sha256').update(fs.readFileSync(sig)).digest('hex'),
      appAsarSha256: crypto.createHash('sha256').update(fs.readFileSync(appAsar)).digest('hex'),
      executableVersion,
      packageVersion: appPackage.version,
      vmp: 'production streaming verified',
      blockmap: 'matches installer bytes',
    },
  }
  const reportFile = path.join(releaseDir, 'release-verification.json')
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

async function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-invalid-payload-'))
  try {
    assert.throws(() => payloadPaths(dir), /missing Quadra\.exe/)
    process.stdout.write('Invalid payload rejection check passed.\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--self-test') return selfTest()
  if (args.length !== 3) throw new Error('Usage: node tests/verify-installer.cjs <installer.exe> <version> <empty-extract-directory>.')
  await verify(path.resolve(args[0]), args[1], path.resolve(args[2]))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
