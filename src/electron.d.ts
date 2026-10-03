import type { LayoutPayload } from './layout'

type QuadraBridge = {
  checkForUpdate: () => Promise<UpdateCheckResult>
  ready: () => void
  setLayout: (payload: LayoutPayload) => void
  setFullscreen: (on: boolean) => void
  setChromeInteractive: (interactive: boolean) => void
  setCursorHidden: (hidden: boolean) => void
  openWeddbets: (panelId: string, label: string) => void
  setWeddbetsTarget: (panelId: string | null, label?: string) => void
  openBllsport: (panelId: string, label: string) => void
  setBllsportTarget: (panelId: string | null, label?: string) => void
  onRequestLayout: (callback: () => void) => () => void
  onFullscreenChange: (callback: (on: boolean) => void) => () => void
  onWeddbetsPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => () => void
  onWeddbetsTargetRequired: (callback: () => void) => () => void
  onWeddbetsError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => () => void
  onBllsportPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => () => void
  onBllsportTargetRequired: (callback: () => void) => () => void
  onBllsportError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => () => void
}

type UpdateCheckResult = 'updated' | 'available' | 'ready' | 'busy' | 'disabled' | 'error'

declare global {
  interface Window {
    quadra?: QuadraBridge
  }
}

export {}
