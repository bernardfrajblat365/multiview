const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const preserveEcsVmpSignature = require('../electron/after-pack.cjs')

const appOutDir = mkdtempSync(join(tmpdir(), 'quadra-vmp-hook-'))
const context = {
  electronPlatformName: 'win32',
  appOutDir,
  packager: { appInfo: { productFilename: 'Quadra' } },
}

try {
  writeFileSync(join(appOutDir, 'electron.exe.sig'), 'development-signature')
  preserveEcsVmpSignature(context)
  assert.equal(existsSync(join(appOutDir, 'Quadra.exe.sig')), true)
  assert.equal(existsSync(join(appOutDir, 'electron.exe.sig')), false)
  assert.throws(() => preserveEcsVmpSignature(context), /ECS VMP signature not found/)
} finally {
  rmSync(appOutDir, { recursive: true, force: true })
}

process.stdout.write('ECS VMP rename and missing-signature checks passed.\n')
