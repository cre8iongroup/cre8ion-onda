import { initializeApp, getApps, getApp } from 'firebase/app'
import { forceWebSockets, getDatabase, onValue, ref } from 'firebase/database'

/**
 * Firebase client config for Onda Operator renderer (RTDB caption preview + feedState).
 * Client public config only — never Admin / service-account credentials.
 *
 * Values are baked at vite build via electron-spike/vite.config.js `define`
 * (from lib/buildConfig.generated.json ← inject-build-config.js ← .env.build).
 *
 * Electron + file:// note:
 * Firebase RTDB tries WebSockets first, then falls back to long-polling via
 * dynamic <script>/iframe tags. Our CSP historically allowed wss://firebase*
 * but only script-src 'self' — so a failed/hung WebSocket left listeners
 * subscribed with neither value nor cancel callbacks (exactly: "listening"
 * log then silence). forceWebSockets() skips that broken fallback path;
 * index.html CSP also allows Firebase script/frame hosts as belt-and-suspenders.
 */

let forcedWebSockets = false
let initLogged = false

function readConfig() {
  // Read each key as a static `import.meta.env.X` member expression so Vite
  // `define` replacements always apply (do not go through a copied env object).
  return {
    apiKey: import.meta.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    databaseURL: import.meta.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '',
  }
}

function databaseHost(databaseURL) {
  try {
    return new URL(databaseURL).host || null
  } catch {
    return null
  }
}

export function getFirebaseConfigStatus() {
  const cfg = readConfig()
  return {
    hasDatabaseUrl: Boolean(cfg.databaseURL),
    hasApiKey: Boolean(cfg.apiKey),
    projectId: cfg.projectId || null,
    databaseHost: cfg.databaseURL ? databaseHost(cfg.databaseURL) : null,
  }
}

/**
 * Ensure RTDB uses native WebSockets in Electron (call once, before connect).
 * Safe to call repeatedly.
 */
function ensureElectronRtdbTransport() {
  if (forcedWebSockets) return
  forceWebSockets()
  forcedWebSockets = true
}

/**
 * Subscribe to `.info/connected` and invoke onChange(boolean).
 * Returns unsubscribe. Used by Operator to surface silent transport hangs.
 */
export function listenRendererRtdbConnected(onChange, onError) {
  const db = getRendererDatabase()
  return onValue(
    ref(db, '.info/connected'),
    (snap) => {
      onChange(snap.val() === true)
    },
    (err) => {
      onError?.(err)
    },
  )
}

export function getRendererDatabase() {
  const cfg = readConfig()
  if (!cfg.databaseURL || !cfg.apiKey || !cfg.projectId) {
    throw new Error(
      'Firebase client env incomplete — set NEXT_PUBLIC_FIREBASE_* in electron-spike/.env.build (then npm start / rebuild)',
    )
  }
  try {
    const parsed = new URL(cfg.databaseURL)
    if (parsed.pathname && parsed.pathname !== '/') {
      throw new Error(
        `NEXT_PUBLIC_FIREBASE_DATABASE_URL must be the database root (no path). Got pathname=${parsed.pathname}`,
      )
    }
  } catch (err) {
    if (err?.message?.includes('DATABASE_URL')) throw err
    throw new Error(`NEXT_PUBLIC_FIREBASE_DATABASE_URL is not a valid URL: ${cfg.databaseURL}`)
  }

  ensureElectronRtdbTransport()

  const app = getApps().length ? getApp() : initializeApp(cfg)
  const db = getDatabase(app)

  if (!initLogged) {
    initLogged = true
    console.info('[firebaseClient] RTDB init', {
      projectId: cfg.projectId,
      databaseHost: databaseHost(cfg.databaseURL),
      hasApiKey: Boolean(cfg.apiKey),
      forcedWebSockets: true,
    })
  }

  return db
}
