/**
 * Firebase Admin SDK — server-side only.
 *
 * Lazy initialization: getAdmin*() functions initialize on first call,
 * not at module load time. This prevents build-time errors when Firebase
 * env vars are not set in the CI/build environment.
 *
 * Authentication:
 *   - Production:  Application Default Credentials (automatic)
 *   - Local dev:   Set GOOGLE_APPLICATION_CREDENTIALS env var to service account JSON path
 *   - Optional:    FIREBASE_SERVICE_ACCOUNT_JSON = raw service-account JSON string
 *
 * RTDB note: Prefer `pushRtdbJson` (REST) for request/response handlers. The
 * Admin SDK's WebSocket RTDB client uses RECONNECT_MAX_DELAY_DEFAULT = 5 minutes
 * when auth is rejected, which surfaces as a ~5-minute hang +
 * "Provided authentication credentials ... are invalid" warnings.
 */
import {
  initializeApp,
  getApps,
  applicationDefault,
  cert,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getDatabase, type Database } from 'firebase-admin/database'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getStorage, type Storage } from 'firebase-admin/storage'

/** Module-scoped singleton — survives repeated getAdminApp() calls in one process. */
let cachedApp: App | undefined

function resolveCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inline) {
    const parsed = JSON.parse(inline) as ServiceAccount
    return cert(parsed)
  }
  // applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS or GCP metadata.
  return applicationDefault()
}

function getAdminApp(): App {
  if (cachedApp) return cachedApp

  const existing = getApps()
  if (existing.length > 0) {
    cachedApp = existing[0]
    return cachedApp
  }

  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim()
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()

  if (!databaseURL) {
    throw new Error(
      '[firebase-admin] NEXT_PUBLIC_FIREBASE_DATABASE_URL is required for Realtime Database',
    )
  }

  // Guard against quoted / whitespace-tainted env values that break RTDB namespace matching.
  let databaseHost: string
  try {
    databaseHost = new URL(databaseURL).host
  } catch {
    throw new Error(
      `[firebase-admin] NEXT_PUBLIC_FIREBASE_DATABASE_URL is not a valid URL: ${JSON.stringify(databaseURL)}`,
    )
  }

  cachedApp = initializeApp({
    credential: resolveCredential(),
    databaseURL,
    ...(projectId ? { projectId } : {}),
  })

  console.info('[firebase-admin] initialized', {
    appName: cachedApp.name,
    projectId: projectId ?? '(from credential)',
    databaseHost,
    appsCount: getApps().length,
    credentialSource: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? 'FIREBASE_SERVICE_ACCOUNT_JSON'
      : process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? 'GOOGLE_APPLICATION_CREDENTIALS'
        : 'applicationDefault()',
  })

  return cachedApp
}

type AccessTokenResult = { accessToken: string; expirationTime?: number }

/** Fetch a Google OAuth2 access token from the Admin app (same path RTDB uses). */
export async function getAdminAccessToken(forceRefresh = false): Promise<string> {
  const app = getAdminApp() as App & {
    INTERNAL: { getToken: (forceRefresh?: boolean) => Promise<AccessTokenResult> }
  }
  console.time('[firebase-admin] getToken')
  try {
    const token = await app.INTERNAL.getToken(forceRefresh)
    if (!token?.accessToken) {
      throw new Error('[firebase-admin] getToken() returned no accessToken')
    }
    return token.accessToken
  } finally {
    console.timeEnd('[firebase-admin] getToken')
  }
}

function rtdbBaseUrl(): string {
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim()
  if (!databaseURL) {
    throw new Error('[firebase-admin] NEXT_PUBLIC_FIREBASE_DATABASE_URL is required')
  }
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim()
  if (emulatorHost) {
    // Emulator: http://host:port/{namespace}
    const namespace = new URL(databaseURL).host.split('.')[0]
    return `http://${emulatorHost}/${namespace}`
  }
  return databaseURL.replace(/\/$/, '')
}

/**
 * Push a JSON value to an RTDB list path via the REST API (POST …/path.json).
 *
 * Bypasses the WebSocket client so auth failures fail fast (~seconds) instead of
 * hanging for RECONNECT_MAX_DELAY_DEFAULT (5 minutes).
 */
export async function pushRtdbJson(
  path: string,
  value: unknown,
  opts?: { timeoutMs?: number },
): Promise<{ name: string }> {
  const timeoutMs = opts?.timeoutMs ?? 15_000
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim())
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // Emulator accepts unauthenticated writes when rules allow; skip token minting
  // so local probes work without a real service account.
  if (!usingEmulator) {
    headers.Authorization = `Bearer ${await getAdminAccessToken()}`
  }
  const url = `${rtdbBaseUrl()}/${normalizedPath}.json`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  console.time(`[rtdb-rest] POST /${normalizedPath}`)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(value),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(
        `[rtdb-rest] POST /${normalizedPath} failed: ${res.status} ${text.slice(0, 500)}`,
      )
    }
    const parsed = text ? (JSON.parse(text) as { name?: string }) : {}
    if (!parsed.name) {
      throw new Error(`[rtdb-rest] POST /${normalizedPath} returned no name: ${text.slice(0, 200)}`)
    }
    return { name: parsed.name }
  } finally {
    clearTimeout(timer)
    console.timeEnd(`[rtdb-rest] POST /${normalizedPath}`)
  }
}

// Lazy getters — safe to call inside API route handlers and server components
export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}
export function getAdminDatabase(): Database {
  return getDatabase(getAdminApp())
}
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}
export function getAdminStorage(): Storage {
  return getStorage(getAdminApp())
}
