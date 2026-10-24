import { contextBridge, ipcRenderer } from 'electron'

type LogLine = { time: string; text: string; source?: 'wh' | '365' }

contextBridge.exposeInMainWorld('quadraMonitor', {
  getBacklog: (): Promise<LogLine[]> => ipcRenderer.invoke('quadra-monitor:backlog'),
  onLine: (callback: (line: LogLine) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, line: LogLine) => callback(line)
    ipcRenderer.on('quadra-monitor:line', listener)
    return () => ipcRenderer.removeListener('quadra-monitor:line', listener)
  },
})
