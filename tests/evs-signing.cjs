const assert = require('node:assert/strict')
const { mock } = require('node:test')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const calls = []
let mode = 'ok'
mock.method(childProcess, 'spawnSync', (_python, args, options) => {
  calls.push(args)
  assert.equal(options.env.EVS_ANY_SKI, undefined)
  assert.equal(options.env.EVS_INTERMEDIATE, undefined)
  if (mode === 'failed') return { status: 1, stdout: '' }
  return { status: 0, stdout: mode === 'dev' ? 'Certificate is valid for development only' : 'Signature is valid: streaming, 1391 days left' }
})
mock.method(fs, 'existsSync', () => mode !== 'missing')
const hook = require('../electron/after-sign.cjs')
const context = { electronPlatformName: 'win32', appOutDir: 'package with spaces', packager: { appInfo: { productFilename: 'Quadra' } } }
try {
  hook(context)
  assert.deepEqual(calls.map(args => args[3]), ['sign-pkg', 'verify-pkg'])
  assert(calls.every(args => args.includes('--streaming') && args.includes('--name-hint') && args.at(-1) === context.appOutDir))
  for (mode of ['failed', 'dev', 'missing']) assert.throws(() => hook(context), /release aborted/)
} finally { mock.restoreAll() }
console.log('EVS signing, verification and rejection checks passed.')
