/**
 * Renderer bridge to Electron preload (window.ondaSpike).
 * Contract must match electron-spike/preload.js — do not invent new channels here.
 */

export function getOndaSpike() {
  if (typeof window === 'undefined' || !window.ondaSpike) {
    console.warn('ondaSpike bridge missing — running outside Electron?')
    return {
      unlock: async () => ({ ok: false, error: 'Not in Electron' }),
      selectSession: async () => ({ ok: false, error: 'Not in Electron' }),
      clearSession: async () => ({ ok: true }),
      start: async () => ({ ok: false, error: 'Not in Electron' }),
      goLive: async () => ({ ok: false, error: 'Not in Electron' }),
      stop: async () => ({ ok: false, error: 'Not in Electron' }),
      openOsSettings: async () => ({ ok: false }),
      getNetworkName: async () => ({ ok: true, name: '—' }),
      getConfig: async () => ({
        region: null,
        ondaApiBase: null,
        hasApiKey: false,
        hasWebhookSecret: false,
        platform: 'browser',
        sdkReady: false,
        recording: false,
        projectCheckOk: false,
        feedState: null,
      }),
      onLog: () => () => {},
      onStatus: () => () => {},
    }
  }
  return window.ondaSpike
}
