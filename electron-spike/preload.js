const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ondaSpike', {
  unlock: (credential) => ipcRenderer.invoke('spike:unlock', credential),
  selectSession: (payload) => ipcRenderer.invoke('spike:select-session', payload),
  clearSession: () => ipcRenderer.invoke('spike:clear-session'),
  start: () => ipcRenderer.invoke('spike:start'),
  goLive: () => ipcRenderer.invoke('spike:go-live'),
  stop: () => ipcRenderer.invoke('spike:stop'),
  openOsSettings: (target) => ipcRenderer.invoke('spike:open-os-settings', target),
  getNetworkName: () => ipcRenderer.invoke('spike:get-network-name'),
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
