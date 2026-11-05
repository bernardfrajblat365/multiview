// macOS variant: Widevine VMP signature for the .app.
// On macOS the VMP signature has to be made BEFORE Apple code signing (castlabs ECS docs),
// so this runs as afterPack; electron-builder then signs the bundle ad-hoc ("-").
// QUADRA_MAC_VMP=dev keeps the ECS development signature (local builds without EVS).
const { spawnSync } = require('node:child_process')
const { existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { evsDetail } = require('./after-sign.cjs')

function findSignatures(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path, { throwIfNoEntry: false })
    if (!stat || stat.isSymbolicLink()) continue
    if (stat.isDirectory()) findSignatures(path, found)
    else if (name.endsWith('.sig')) found.push(path)
  }
  return found
}

module.exports = function signMacVmp(context) {
  if (context.electronPlatformName !== 'darwin') return
  const name = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${name}.app`)
  if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`)

  if (process.env.QUADRA_MAC_VMP === 'dev') {
    console.log('QUADRA_MAC_VMP=dev: keeping the ECS development VMP signature (no EVS).')
    return
  }

  const env = { ...process.env }
  delete env.EVS_ANY_SKI
  delete env.EVS_INTERMEDIATE
  for (const command of ['sign-pkg', 'verify-pkg']) {
    const args = ['-m', 'castlabs_evs.vmp', '-n', command, '--streaming', '--name-hint', name]
    if (command === 'sign-pkg') args.push('--force')
    args.push(context.appOutDir)
    const result = spawnSync(process.env.EVS_PYTHON || 'python3', args, {
      env, encoding: 'utf8', timeout: 900000,
    })
    if (result.error || result.status !== 0) {
      const detail = evsDetail(result)
      throw new Error(`EVS ${command} failed (exit ${result.status ?? 'none'}). Check Python, castlabs-evs 1.3.2 and EVS authentication, or build with QUADRA_MAC_VMP=dev.${detail ? `\nEVS output:\n${detail}` : ''}`)
    }
    if (command === 'verify-pkg' && !/Signature is valid: streaming,/.test(result.stdout)) {
      throw new Error('EVS did not confirm a production streaming signature for the macOS app.')
    }
  }
  if (findSignatures(appPath).length === 0) {
    throw new Error('Production VMP signature missing inside the macOS app bundle.')
  }
  console.log('EVS production streaming signature verified (macOS).')
}
