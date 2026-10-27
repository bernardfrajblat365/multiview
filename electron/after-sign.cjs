const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const MAX_DETAIL_LINES = 25
const MAX_DETAIL_CHARS = 3000

// Last lines of what EVS printed, with anything that could be a credential masked,
// so a failed release shows why without leaking the account in the CI log.
function evsDetail(result) {
  const text = [result.error && result.error.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b(password|passwd|secret|token|refresh_token|access_token|id_token|api[_-]?key|credentials?)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[redacted]')
  const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean)
  const tail = lines.slice(-MAX_DETAIL_LINES).join('\n')
  return tail.length > MAX_DETAIL_CHARS ? tail.slice(-MAX_DETAIL_CHARS) : tail
}

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
      const detail = evsDetail(result)
      throw new Error(`EVS ${command} failed (exit ${result.status ?? 'none'}). Check Python, castlabs-evs 1.3.2 and EVS authentication; release aborted.${detail ? `\nEVS output:\n${detail}` : ''}`)
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

module.exports.evsDetail = evsDetail
