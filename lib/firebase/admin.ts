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
 *
 * RTDB REST auth: mint a Google OAuth2 access token with the scopes required by
 * https://firebase.google.com/docs/database/rest/auth — NOT a generic
 * cloud-platform-only token. A missing firebase.database scope returns 401.
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
import { GoogleAuth, JWT } from 'google-auth-library'
import { readFileSync } from 'fs'

/**
 * Scopes required by the Realtime Database REST API for admin (rules-bypass) access.
 * @see https://firebase.google.com/docs/database/rest/auth#generate_an_access_token
 *
 * Note: firebase-admin's ApplicationDefaultCredential also requests these (plus
 * cloud-platform / messaging / identitytoolkit). We mint REST tokens ourselves
 * with exactly these two so a mistyped/underscoped ADC path cannot silently 401.
 */
export const RTDB_REST_SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
] as const

/** Module-scoped singleton — survives repeated getAdminApp() calls in one process. */
let cachedApp: App | undefined
let loggedRtdbScopes = false

function resolveCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inline) {
    const parsed = JSON.parse(inline) as ServiceAccount
    return cert(parsed)
  }
  // applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS or GCP metadata.
  return applicationDefault()
}

function loadServiceAccountJson(): Record<string, string> | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inline) {
    return JSON.parse(inline) as Record<string, string>
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  if (credPath) {
    return JSON.parse(readFileSync(credPath, 'utf8')) as Record<string, string>
  }
  return null
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
    rtdbRestScopes: [...RTDB_REST_SCOPES],
  })

  return cachedApp
}

/**
 * Mint a Google OAuth2 access token scoped for RTDB REST admin access.
 *
 * Prefer an explicit service-account JWT with RTDB_REST_SCOPES. Fall back to
 * GoogleAuth ADC with the same scopes (e.g. GCP metadata server).
 */
export async function getAdminAccessToken(_forceRefresh = false): Promise<string> {
  if (!loggedRtdbScopes) {
    console.info('[rtdb-rest] minting access token with scopes', [...RTDB_REST_SCOPES])
    loggedRtdbScopes = true
  }

  console.time('[firebase-admin] getToken')
  try {
    const sa = loadServiceAccountJson()
    if (sa?.client_email && sa?.private_key) {
      const client = new JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: [...RTDB_REST_SCOPES],
      })
      const { token } = await client.getAccessToken()
      if (!token) {
        throw new Error('[rtdb-rest] JWT getAccessToken() returned no token')
      }
      return token
    }

    // No SA file/JSON — ADC with explicit RTDB scopes (not cloud-platform-only).
    const auth = new GoogleAuth({ scopes: [...RTDB_REST_SCOPES] })
    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token
    if (!token) {
      throw new Error(
        '[rtdb-rest] GoogleAuth getAccessToken() returned no token — set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON',
      )
    }
    return token
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
 *
 * Auth: Google OAuth2 access token with firebase.database + userinfo.email,
 * passed as `access_token` (Firebase REST docs) and Authorization Bearer.
 */
export async function pushRtdbJson(
  path: string,
  value: unknown,
  opts?: { timeoutMs?: number },
): Promise<{ name: string }> {
  // Ensure Admin app is initialized (logs projectId / databaseHost once).
  getAdminApp()

  const timeoutMs = opts?.timeoutMs ?? 15_000
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim())

  const url = new URL(`${rtdbBaseUrl()}/${normalizedPath}.json`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Emulator accepts unauthenticated writes when rules allow; skip token minting
  // so local probes work without a real service account.
  if (!usingEmulator) {
    const accessToken = await getAdminAccessToken()
    // Docs accept either form; set both so neither delivery path is the 401 cause.
    url.searchParams.set('access_token', accessToken)
    headers.Authorization = `Bearer ${accessToken}`
  }

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
