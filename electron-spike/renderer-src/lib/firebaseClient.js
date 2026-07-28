import { initializeApp, getApps, getApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

/**
 * Firebase client config for Onda Operator renderer (RTDB caption preview).
 * Client public config only — never Admin / service-account credentials.
 *
 * Env (electron-spike/.env, exposed via Vite envPrefix NEXT_PUBLIC_):
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL
 */
function readConfig() {
  const env = import.meta.env || {}
  return {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '',
  }
}

export function getFirebaseConfigStatus() {
  const cfg = readConfig()
  return {
    hasDatabaseUrl: Boolean(cfg.databaseURL),
    hasApiKey: Boolean(cfg.apiKey),
    projectId: cfg.projectId || null,
  }
}

export function getRendererDatabase() {
  const cfg = readConfig()
  if (!cfg.databaseURL || !cfg.apiKey || !cfg.projectId) {
    throw new Error(
      'Firebase client env incomplete — set NEXT_PUBLIC_FIREBASE_* in electron-spike/.env',
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
  const app = getApps().length ? getApp() : initializeApp(cfg)
  return getDatabase(app)
}
