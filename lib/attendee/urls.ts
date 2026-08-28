/**
 * Public app origin for QR payloads and absolute attendee links.
 *
 * Resolution order (first non-empty wins, then localhost safety net):
 *  1. ONDA_PUBLIC_APP_URL / APP_URL — server-only, NOT inlined by Next
 *     (survives a bad NEXT_PUBLIC bake on App Hosting / Cloud Run)
 *  2. NEXT_PUBLIC_APP_URL — build-time inlined (client + server)
 *  3. VERCEL_URL
 *  4. On the browser: window.location.origin when the resolved value is
 *     localhost but the page is not (preview links on a misconfigured deploy)
 *  5. Known production origin when running on App Hosting/Cloud Run and the
 *     resolved value is still localhost / missing
 *  6. http://localhost:3000 for local dev only
 */

/** Confirmed custom domain for the cre8ion-onda App Hosting backend. */
export const PRODUCTION_PUBLIC_ORIGIN = 'https://cre8ion-onda.app'

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin.includes('://') ? origin : `http://${origin}`)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0'
  } catch {
    return /localhost|127\.0\.0\.1/.test(origin)
  }
}

/** Cloud Run / App Hosting set K_SERVICE; FIREBASE_CONFIG is injected on App Hosting. */
function isHostedServerRuntime(): boolean {
  if (typeof window !== 'undefined') return false
  return Boolean(
    process.env.K_SERVICE?.trim() ||
      process.env.FIREBASE_CONFIG?.trim() ||
      process.env.X_GOOGLE_TARGET_PLATFORM?.trim(),
  )
}

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    // Bracket access for non-NEXT_PUBLIC keys avoids any static replace surprises.
    const raw = process.env[key]
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (v) return v
  }
  return ''
}

export function getPublicAppOrigin(): string {
  // Server-only runtime vars first (never inlined by the Next compiler).
  let origin = ''
  if (typeof window === 'undefined') {
    origin = firstEnv('ONDA_PUBLIC_APP_URL', 'APP_URL')
  }

  if (!origin) {
    origin = firstEnv('NEXT_PUBLIC_APP_URL')
  }

  if (!origin) {
    const vercel = firstEnv('VERCEL_URL')
    if (vercel) {
      const host = vercel.replace(/^https?:\/\//, '')
      origin = `https://${host}`
    }
  }

  if (!origin) {
    origin = 'http://localhost:3000'
  }

  origin = stripTrailingSlash(origin)

  // Client browsing production with a localhost bake → use the live host.
  if (typeof window !== 'undefined' && isLocalhostOrigin(origin) && !isLocalhostOrigin(window.location.origin)) {
    return stripTrailingSlash(window.location.origin)
  }

  // Server on App Hosting / Cloud Run must never encode localhost into QR payloads.
  if (isHostedServerRuntime() && isLocalhostOrigin(origin)) {
    console.error(
      `[urls] Refusing localhost public origin on hosted runtime; using ${PRODUCTION_PUBLIC_ORIGIN}. ` +
        `Set ONDA_PUBLIC_APP_URL / NEXT_PUBLIC_APP_URL in App Hosting (and remove any console override of localhost).`,
    )
    return PRODUCTION_PUBLIC_ORIGIN
  }

  return origin
}

export function roomPublicUrl(roomId: string): string {
  return `${getPublicAppOrigin()}/room/${roomId}`
}

export function sessionPublicUrl(sessionId: string): string {
  return `${getPublicAppOrigin()}/session/${sessionId}`
}

export function showPublicUrl(slug: string): string {
  return `${getPublicAppOrigin()}/show/${slug}`
}

export function summaryPublicUrl(showId: string, sessionId: string): string {
  return `${getPublicAppOrigin()}/summary/${showId}/${sessionId}`
}
