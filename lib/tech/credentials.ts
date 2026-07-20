/**
 * Tech Operator Panel credentials — v1 shared secret per show.
 *
 * Each show gets a synthetic Firebase Auth user:
 *   email:    tech+{portalSlug}@onda.tech
 *   password: show.techCredential
 *   userDoc:  baseRole 'tech', assignedShows: [showId]
 *
 * Operators sign in with portal slug + credential on /tech/login.
 * No Recall/Firebase secrets live on the operator machine beyond this password.
 */

export const TECH_EMAIL_DOMAIN = 'onda.tech'

export function techEmailForPortalSlug(portalSlug: string): string {
  const slug = portalSlug.trim().toLowerCase()
  return `tech+${slug}@${TECH_EMAIL_DOMAIN}`
}

export function portalSlugFromTechEmail(email: string): string | null {
  const m = email.trim().toLowerCase().match(new RegExp(`^tech\\+(.+)@${TECH_EMAIL_DOMAIN.replace('.', '\\.')}$`))
  return m?.[1] ?? null
}
