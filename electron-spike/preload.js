const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ondaSpike', {
  unlock: (credential) => ipcRenderer.invoke('spike:unlock', credential),
  selectSession: (payload) => ipcRenderer.invoke('spike:select-session', payload),
  clearSession: () => ipcRenderer.invoke('spike:clear-session'),
  start: () => ipcRenderer.invoke('spike:start'),
  stop: () => ipcRenderer.invoke('spike:stop'),
  getConfig: () => ipcRenderer.invoke('spike:get-config'),
  onLog: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('spike:log', handler)
    return () => ipcRenderer.removeListener('spike:log', handler)
  },
  onStatus: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('spike:status', handler)
    return () => ipcRenderer.removeListener('spike:status', handler)
  },
})
