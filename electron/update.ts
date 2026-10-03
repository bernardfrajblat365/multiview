import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { AppUpdater } from 'electron-updater'

type UpdateInfo = { version?: unknown }
type UpdateState = 'idle' | 'checking' | 'prompting-download' | 'downloading' | 'downloaded' | 'installing'
export type UpdateCheckResult = 'updated' | 'available' | 'ready' | 'busy' | 'disabled' | 'error'

type UpdateDialog = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

type AutoUpdateOptions = {
  enabled: boolean
  updater: AppUpdater
  showMessageBox: UpdateDialog
  quitAndInstall: () => void
  onInstallError?: () => void
  log?: (message: string) => void
}

export type AutoUpdateController = {
  check: () => Promise<UpdateCheckResult>
  getState: () => UpdateState
}

function versionLabel(info: UpdateInfo) {
  return typeof info.version === 'string' && info.version.length > 0 ? `v${info.version}` : 'disponível'
}

export function createAutoUpdateController({
  enabled,
  updater,
  showMessageBox,
  quitAndInstall,
  onInstallError,
  log = () => {},
}: AutoUpdateOptions): AutoUpdateController {
  let state: UpdateState = 'idle'
  let checkPromise: Promise<UpdateCheckResult> | null = null
  let downloadedInfo: UpdateInfo | null = null
  let checkError = false
  let installPromptOpen = false

  if (!enabled) return { check: async () => 'disabled', getState: () => state }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableWebInstaller = true

  const promptDownload = async (info: UpdateInfo) => {
    try {
      const result = await showMessageBox({
        type: 'info',
        title: 'Atualização disponível',
        message: `A versão ${versionLabel(info)} do Quadra está disponível.`,
        detail: 'Baixar agora? Os painéis continuam funcionando enquanto o download acontece.',
        buttons: ['Atualizar', 'Agora não'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (state !== 'prompting-download') return
      if (result.response !== 0) {
        state = 'idle'
        return
      }
      state = 'downloading'
      await updater.downloadUpdate()
    } catch {
      state = 'idle'
      log('Falha ao iniciar o download da atualização.')
    }
  }

  const promptInstall = async (info: UpdateInfo) => {
    if (installPromptOpen) return
    installPromptOpen = true
    try {
      const result = await showMessageBox({
        type: 'info',
        title: 'Atualização pronta',
        message: `A versão ${versionLabel(info)} foi baixada.`,
        detail: 'Reiniciar e instalar interrompe os painéis abertos. Você pode fazer isso depois.',
        buttons: ['Reiniciar e instalar', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (state !== 'downloaded' || result.response !== 0) return
      state = 'installing'
      quitAndInstall()
    } catch {
      state = 'downloaded'
      log('Falha ao preparar a instalação da atualização.')
    } finally {
      installPromptOpen = false
    }
  }

  updater.on('update-available', (info) => {
    if (state !== 'checking' && state !== 'idle') return
    state = 'prompting-download'
    void promptDownload(info)
  })
  updater.on('update-downloaded', (info) => {
    if (state === 'downloaded' || state === 'installing') return
    downloadedInfo = info
    state = 'downloaded'
    void promptInstall(info)
  })
  updater.on('update-cancelled', () => {
    if (state === 'downloading' || state === 'prompting-download') state = 'idle'
  })
  updater.on('error', () => {
    if (state === 'checking') checkError = true
    if (state === 'installing') {
      state = 'downloaded'
      onInstallError?.()
    } else {
      state = 'idle'
    }
    log('Não foi possível consultar ou baixar a atualização.')
  })

  const check = async (): Promise<UpdateCheckResult> => {
    if (checkPromise) return checkPromise
    if (state === 'downloaded' && downloadedInfo) {
      void promptInstall(downloadedInfo)
      return 'ready' as const
    }
    if (state !== 'idle') return 'busy'
    checkError = false
    state = 'checking'
    const pending = updater.checkForUpdates()
      .then((result): UpdateCheckResult => {
        if (checkError) return 'error'
        if (state !== 'checking') return 'available'
        return result?.isUpdateAvailable ? 'available' : 'updated'
      })
      .catch((): UpdateCheckResult => {
        state = 'idle'
        log('Não foi possível consultar atualizações.')
        return 'error'
      })
      .finally(() => {
        checkPromise = null
        if (state === 'checking') state = 'idle'
      })
    checkPromise = pending
    return pending
  }

  return { check, getState: () => state }
}
