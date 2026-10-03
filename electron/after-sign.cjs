const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

module.exports = function signProductionVmp(context) {
  if (context.electronPlatformName !== 'win32') return
  const name = context.packager.appInfo.productFilename
  const env = { ...process.env }
  delete env.EVS_ANY_SKI
  delete env.EVS_INTERMEDIATE
  for (const command of ['sign-pkg', 'verify-pkg']) {
    const args = ['-m', 'castlabs_evs.vmp', '-n', command, '--streaming', '--name-hint', name]
    if (command === 'sign-pkg') args.push('--force')
    args.push(context.appOutDir)
    const result = spawnSync(process.env.EVS_PYTHON || 'python', args, {
      env, encoding: 'utf8', timeout: 900000, windowsHide: true,
    })
    if (result.error || result.status !== 0) {
      throw new Error(`EVS ${command} failed. Check Python, castlabs-evs 1.3.2 and EVS authentication; release aborted.`)
    }
    if (command === 'verify-pkg' && !/Signature is valid: streaming,/.test(result.stdout)) {
      throw new Error('EVS did not confirm a production streaming signature; release aborted.')
    }
  }
  if (!existsSync(join(context.appOutDir, `${name}.exe.sig`))) {
    throw new Error('Production VMP signature missing; release aborted.')
  }
  console.log('EVS production streaming signature verified.')
}
