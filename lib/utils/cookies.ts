/**
 * Lightweight cookie utilities for client-side use.
 * Used to set the onda-session cookie that middleware checks.
 *
 * Note: this is NOT a secure auth mechanism — the real auth guard
 * is Firebase Auth on the client and Admin SDK on the server.
 * The cookie is only used by middleware to avoid unnecessary redirects
 * on authenticated users. Firebase client SDK handles true auth state.
 */

export function setCookie(name: string, value: string, days: number) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Strict`
}
