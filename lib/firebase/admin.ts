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
 *
 * ─── Project ID footgun ─────────────────────────────────────────────────────
 * Two separate GCP/Firebase projects share the display name "cre8ion Onda":
 *   • cre8ion-onda          — owns the Realtime Database (THIS is the one to use)
 *   • cre8ion-onda-503301   — unrelated sibling project (do NOT use for RTDB)
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_DATABASE_URL, and the
 * service account behind GOOGLE_APPLICATION_CREDENTIALS must all come from
 * cre8ion-onda (no -503301 suffix). Mixing them causes invalid-credential /
 * 401 failures that look like SDK bugs.
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

/** The only Firebase project Onda may use for Admin/RTDB/Firestore. */
export const REQUIRED_FIREBASE_PROJECT_ID = 'cre8ion-onda'

/**
 * Fail loudly if env points at the sibling cre8ion-onda-503301 project (or anything
 * other than cre8ion-onda). Called on Admin init and from /api/health.
 */
export function assertCorrectFirebaseProject(opts?: {
  projectId?: string | null
  databaseHost?: string | null
}): { projectId: string; databaseHost: string | null } {
  const projectId =
    opts?.projectId?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    ''
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() || ''
  let databaseHost = opts?.databaseHost?.trim() || null
  if (!databaseHost && databaseURL) {
    try {
      databaseHost = new URL(databaseURL).host
    } catch {
      databaseHost = null
    }
  }

  const looksLikeSibling =
    projectId.includes('503301') ||
    Boolean(databaseHost?.includes('503301')) ||
    databaseURL.includes('503301')

  if (looksLikeSibling || (projectId && projectId !== REQUIRED_FIREBASE_PROJECT_ID)) {
    throw new Error(
      `[firebase-admin] FATAL: Firebase project must be "${REQUIRED_FIREBASE_PROJECT_ID}" ` +
        `(got projectId=${JSON.stringify(projectId || '(empty)')}, ` +
        `databaseHost=${JSON.stringify(databaseHost || '(empty)')}). ` +
        `Do NOT use cre8ion-onda-503301 — RTDB and show data live on cre8ion-onda.`,
    )
  }

  if (!projectId) {
    throw new Error(
      `[firebase-admin] FATAL: NEXT_PUBLIC_FIREBASE_PROJECT_ID is required and must be "${REQUIRED_FIREBASE_PROJECT_ID}".`,
    )
  }

  return { projectId, databaseHost }
}

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

  // Hard fail: cre8ion-onda vs cre8ion-onda-503301 collision (see header comment).
  assertCorrectFirebaseProject({ projectId, databaseHost })

  const { bucket: storageBucket, source: storageBucketSource } =
    resolveFirebaseStorageBucket()

  cachedApp = initializeApp({
    credential: resolveCredential(),
    databaseURL,
    ...(projectId ? { projectId } : {}),
    // Required for Admin Storage uploads — App Hosting injects the correct
    // default via FIREBASE_CONFIG; also accept NEXT_PUBLIC_* / FIREBASE_STORAGE_BUCKET.
    ...(storageBucket ? { storageBucket } : {}),
  })

  console.info('[firebase-admin] initialized', {
    appName: cachedApp.name,
    projectId: projectId ?? '(from credential)',
    databaseHost,
    storageBucket: storageBucket ?? '(unset)',
    storageBucketSource: storageBucketSource ?? '(none)',
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
  const result = await rtdbRestWrite('POST', path, value, opts)
  const parsed = result as { name?: string }
  if (!parsed.name) {
    throw new Error(`[rtdb-rest] POST /${path} returned no name: ${JSON.stringify(result).slice(0, 200)}`)
  }
  return { name: parsed.name }
}

/**
 * Set (overwrite) a JSON value at an RTDB path via REST PUT.
 * Used for feedState / metadata writes that must not create a push-id child.
 */
export async function setRtdbJson(
  path: string,
  value: unknown,
  opts?: { timeoutMs?: number },
): Promise<void> {
  await rtdbRestWrite('PUT', path, value, opts)
}

/**
 * Merge-update a JSON object at an RTDB path via REST PATCH.
 */
export async function updateRtdbJson(
  path: string,
  value: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<void> {
  await rtdbRestWrite('PATCH', path, value, opts)
}

async function rtdbRestWrite(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  value: unknown,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  // Ensure Admin app is initialized (logs projectId / databaseHost once + project guard).
  getAdminApp()

  const timeoutMs = opts?.timeoutMs ?? 15_000
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim())

  const url = new URL(`${rtdbBaseUrl()}/${normalizedPath}.json`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (!usingEmulator) {
    const accessToken = await getAdminAccessToken()
    url.searchParams.set('access_token', accessToken)
    headers.Authorization = `Bearer ${accessToken}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(value),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(
        `[rtdb-rest] ${method} /${normalizedPath} failed: ${res.status} ${text.slice(0, 500)}`,
      )
    }
    return text ? JSON.parse(text) : null
  } finally {
    clearTimeout(timer)
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

/**
 * Normalize a Storage bucket id: strip `gs://` / trailing slash.
 * Admin SDK wants `project.firebasestorage.app` or `project.appspot.com`, not a URL.
 */
export function normalizeStorageBucketName(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const cleaned = raw
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/, '')
  return cleaned || null
}

type StorageBucketSource =
  | 'FIREBASE_CONFIG'
  | 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'
  | 'FIREBASE_STORAGE_BUCKET'

/**
 * Resolve the Cloud Storage bucket used by Admin uploads (webhook audio, etc.).
 *
 * Prefer App Hosting's auto-injected `FIREBASE_CONFIG.storageBucket` when present —
 * that is the project default. Fall back to explicit env vars (manual Console /
 * .env.local). Never guess `*.appspot.com` vs `*.firebasestorage.app`.
 */
export function resolveFirebaseStorageBucket(): {
  bucket: string | null
  source: StorageBucketSource | null
} {
  const fromConfig = normalizeStorageBucketName(readFirebaseConfig()?.storageBucket)
  if (fromConfig) return { bucket: fromConfig, source: 'FIREBASE_CONFIG' }

  const fromPublic = normalizeStorageBucketName(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  )
  if (fromPublic) {
    return { bucket: fromPublic, source: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET' }
  }

  const fromServer = normalizeStorageBucketName(process.env.FIREBASE_STORAGE_BUCKET)
  if (fromServer) return { bucket: fromServer, source: 'FIREBASE_STORAGE_BUCKET' }

  return { bucket: null, source: null }
}

function readFirebaseConfig(): {
  storageBucket?: string
  databaseURL?: string
  projectId?: string
} | null {
  const raw = process.env.FIREBASE_CONFIG?.trim()
  if (!raw || raw[0] !== '{') return null
  try {
    return JSON.parse(raw) as {
      storageBucket?: string
      databaseURL?: string
      projectId?: string
    }
  } catch {
    return null
  }
}
