/**
 * Thin accessor for the preload bridge.
 * Contract must match electron-spike/preload.js — do not invent new channels here.
 */

function installBrowserPreviewStub() {
  if (window.ondaSpike) return window.ondaSpike

  const listeners = { log: [], status: [] }
  const stub = {
    unlock: async () => ({
      ok: false,
      error: 'Browser preview stub — unlock requires Electron + Next API',
    }),
    selectSession: async () => ({ ok: false, error: 'Browser preview stub' }),
    clearSession: async () => ({ ok: true }),
    start: async () => ({ ok: false, error: 'Browser preview stub' }),
    stop: async () => ({ ok: true }),
    getConfig: async () => ({
      region: 'us-west-2',
      ondaApiBase: 'http://localhost:3000',
      hasApiKey: false,
      hasWebhookSecret: false,
      platform: 'browser-preview',
      sdkReady: false,
      recording: false,
      projectCheckOk: false,
      projectCheckError:
        'Browser preview (Vite) — not running inside Electron. IPC stub active.',
      sessionId: null,
      lifecycleStatus: null,
      webhookUrl: null,
    }),
    onLog: (cb) => {
      listeners.log.push(cb)
      return () => {
        listeners.log = listeners.log.filter((fn) => fn !== cb)
      }
    },
    onStatus: (cb) => {
      listeners.status.push(cb)
      return () => {
        listeners.status = listeners.status.filter((fn) => fn !== cb)
      }
    },
  }

  window.ondaSpike = stub
  console.info(
    '[ondaSpike] Installed browser preview stub (http/https only). Real IPC requires Electron preload.',
  )
  return stub
}

export function getOndaSpike() {
  if (typeof window !== 'undefined' && window.ondaSpike) {
    return window.ondaSpike
  }
  // Vite preview / browser only — never used under Electron file:// + preload
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return installBrowserPreviewStub()
  }
  throw new Error(
    'window.ondaSpike is missing — preload did not expose the bridge (or this page is not running inside Electron).',
  )
}
