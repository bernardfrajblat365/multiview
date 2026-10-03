import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { createAutoUpdateController } from '../electron/update.ts'

type FakeUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  checkForUpdates: () => Promise<void | { isUpdateAvailable?: boolean }>
  downloadUpdate: () => Promise<string[]>
}

function fakeUpdater(): FakeUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    checkForUpdates: async () => {},
    downloadUpdate: async () => [],
  })
}

function controllerFor(
  updater: FakeUpdater,
  responses: number[],
  dialogs: MessageBoxOptions[],
  quit: () => void,
  onInstallError: () => void = () => {},
) {
  const showMessageBox = async (options: MessageBoxOptions): Promise<MessageBoxReturnValue> => {
    dialogs.push(options)
    return { response: responses.shift() ?? 1 }
  }
  return createAutoUpdateController({
    enabled: true,
    updater: updater as unknown as AppUpdater,
    showMessageBox,
    quitAndInstall: quit,
    onInstallError,
  })
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('não duplica o diálogo de instalação e permite reabrir após Depois', async () => {
  const updater = fakeUpdater()
  let dialogs = 0
  let dismiss!: (value: MessageBoxReturnValue) => void
  const controller = createAutoUpdateController({
    enabled: true,
    updater: updater as unknown as AppUpdater,
    showMessageBox: () => {
      dialogs += 1
      return new Promise((resolve) => { dismiss = resolve })
    },
    quitAndInstall: () => {},
  })
  updater.emit('update-downloaded', { version: '1.0.10' })
  await Promise.all([controller.check(), controller.check()])
  assert.equal(dialogs, 1)
  dismiss({ response: 1 })
  await nextTick()
  assert.equal(await controller.check(), 'ready')
  assert.equal(dialogs, 2)
  dismiss({ response: 1 })
  await nextTick()
})

test('só baixa após consentimento, não duplica operações e adia sem instalar ao sair', async () => {
  const updater = fakeUpdater()
  const dialogs: MessageBoxOptions[] = []
  let checks = 0
  let downloads = 0
  let quitCalls = 0
  let resolveCheck!: () => void
  updater.checkForUpdates = () => {
    checks += 1
    return new Promise<void>((resolve) => { resolveCheck = resolve })
  }
  updater.downloadUpdate = async () => {
    downloads += 1
    updater.emit('update-downloaded', { version: '1.0.10' })
    return []
  }
  const controller = controllerFor(updater, [0, 1], dialogs, () => { quitCalls += 1 })

  const checkPromise = controller.check()
  const duplicateCheck = controller.check()
  await nextTick()
  assert.equal(controller.getState(), 'checking')
  updater.emit('update-available', { version: '1.0.10' })
  await nextTick()
  await nextTick()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(downloads, 1)
  assert.deepEqual(dialogs.map(({ buttons }) => buttons), [
    ['Atualizar', 'Agora não'],
    ['Reiniciar e instalar', 'Depois'],
  ])
  assert.equal(controller.getState(), 'downloaded')
  updater.emit('update-downloaded', { version: '1.0.10' })
  await nextTick()
  assert.equal(dialogs.length, 2)
  updater.emit('update-available', { version: '1.0.10' })
  await nextTick()
  assert.equal(dialogs.length, 2)
  assert.equal(checks, 1)
  resolveCheck()
  assert.deepEqual(await Promise.all([checkPromise, duplicateCheck]), ['available', 'available'])
  assert.equal(quitCalls, 0)
  assert.equal(await controller.check(), 'ready')
  await nextTick()
  assert.equal(dialogs.length, 3)
})

test('instala somente quando o segundo diálogo é confirmado', async () => {
  const updater = fakeUpdater()
  const dialogs: MessageBoxOptions[] = []
  let quitCalls = 0
  let installErrors = 0
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '1.0.10' })
  }
  updater.downloadUpdate = async () => {
    updater.emit('update-downloaded', { version: '1.0.10' })
    return []
  }
  const controller = controllerFor(updater, [0, 0], dialogs, () => { quitCalls += 1 }, () => { installErrors += 1 })
  await controller.check()
  await nextTick()
  await nextTick()
  assert.equal(controller.getState(), 'installing')
  assert.equal(quitCalls, 1)
  updater.emit('error', new Error('fixture installer failure'))
  assert.equal(controller.getState(), 'downloaded')
  assert.equal(installErrors, 1)
})

test('recusa, modo desabilitado e falhas de consulta/download não bloqueiam o app', async () => {
  const disabledUpdater = fakeUpdater()
  let disabledChecks = 0
  disabledUpdater.checkForUpdates = async () => { disabledChecks += 1 }
  const disabled = createAutoUpdateController({
    enabled: false,
    updater: disabledUpdater as unknown as AppUpdater,
    showMessageBox: async () => ({ response: 1 }),
    quitAndInstall: () => {},
  })
  await disabled.check()
  assert.equal(disabledChecks, 0)
  assert.equal(await disabled.check(), 'disabled')

  const refusedUpdater = fakeUpdater()
  let refusedDownloads = 0
  refusedUpdater.checkForUpdates = async () => ({ isUpdateAvailable: false })
  refusedUpdater.downloadUpdate = async () => {
    refusedDownloads += 1
    return []
  }
  const refused = controllerFor(refusedUpdater, [1], [], () => {})
  assert.equal(await refused.check(), 'updated')
  await nextTick()
  assert.equal(refused.getState(), 'idle')
  assert.equal(refusedDownloads, 0)

  const failedQueryUpdater = fakeUpdater()
  failedQueryUpdater.checkForUpdates = async () => { throw new Error('offline fixture') }
  const failedQuery = controllerFor(failedQueryUpdater, [], [], () => {})
  assert.equal(await failedQuery.check(), 'error')
  assert.equal(failedQuery.getState(), 'idle')

  const emittedErrorUpdater = fakeUpdater()
  emittedErrorUpdater.checkForUpdates = async () => {
    emittedErrorUpdater.emit('error', new Error('offline event fixture'))
  }
  const emittedError = controllerFor(emittedErrorUpdater, [], [], () => {})
  assert.equal(await emittedError.check(), 'error')

  const failedDownloadUpdater = fakeUpdater()
  failedDownloadUpdater.checkForUpdates = async () => {
    failedDownloadUpdater.emit('update-available', { version: '1.0.10' })
  }
  failedDownloadUpdater.downloadUpdate = async () => { throw new Error('broken fixture') }
  const failedDownload = controllerFor(failedDownloadUpdater, [0], [], () => {})
  await failedDownload.check()
  await nextTick()
  await nextTick()
  assert.equal(failedDownload.getState(), 'idle')
})
