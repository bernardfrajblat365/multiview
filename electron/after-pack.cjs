const { existsSync, renameSync } = require('node:fs')
const { join } = require('node:path')

module.exports = function preserveEcsVmpSignature(context) {
  if (context.electronPlatformName !== 'win32') return

  const source = join(context.appOutDir, 'electron.exe.sig')
  const target = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe.sig`)
  if (!existsSync(source)) {
    throw new Error(`ECS VMP signature not found: ${source}`)
  }
  if (existsSync(target)) {
    throw new Error(`ECS VMP signature target already exists: ${target}`)
  }
  renameSync(source, target)
}
