/**
 * Public app origin for QR payloads and absolute attendee links.
 * Prefer NEXT_PUBLIC_APP_URL (documented in .env.example).
 */

export function getPublicAppOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, '')
    return `https://${host}`
  }

  return 'http://localhost:3000'
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
