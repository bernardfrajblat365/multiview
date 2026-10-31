import { contextBridge, ipcRenderer } from 'electron'
import type { PipCommand, PipState } from '../src/pip'

contextBridge.exposeInMainWorld('quadraPip', {
  ready: () => ipcRenderer.send('quadra-pip:ready'),
  command: (command: PipCommand) => ipcRenderer.send('quadra-pip:command', command),
  setBarHeight: (px: number) => ipcRenderer.send('quadra-pip:bar-height', px),
  onState: (callback: (state: PipState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PipState) => callback(state)
    ipcRenderer.on('quadra-pip:state', listener)
    return () => ipcRenderer.removeListener('quadra-pip:state', listener)
  },
})
