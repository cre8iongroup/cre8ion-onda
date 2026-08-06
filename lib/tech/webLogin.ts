/**
 * Web Tech login — credential → Firestore show lookup → custom token.
 *
 * Operator unlock (POST /api/tech/unlock) is purely Firestore techCredential
 * equality and never touches Firebase Auth. Web login reuses that lookup, then
 * mints a custom token for the show's tech Auth user so the browser can hold a
 * normal Firebase session for /tech Firestore rules. No password in this path.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase/admin'
import { techEmailForPortalSlug } from '@/lib/tech/credentials'
import {
  TechLifecycleError,
  unlockShowByCredential,
} from '@/lib/tech/sessionLifecycle'

export type WebLoginResult = {
  customToken: string
  show: { id: string; name: string; portalURL: string }
}

/**
 * Ensure Auth user tech+{portalSlug}@onda.tech exists + users/{uid} doc scoped
 * to showId. Returns uid for createCustomToken. Does not set/rotate password.
 */
export async function ensureTechAuthUserForShow(
  showId: string,
  portalSlug: string,
): Promise<string> {
  const slug = portalSlug.trim().toLowerCase()
  if (!slug) {
    throw new TechLifecycleError(
      400,
      'missing_portal_slug',
      'Show has no portal slug — set branding.portalURL in Admin before Tech web login',
    )
  }

  const email = techEmailForPortalSlug(slug)
  const auth = getAdminAuth()
  let uid: string

  try {
    const existing = await auth.getUserByEmail(email)
    uid = existing.uid
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : ''
    if (code !== 'auth/user-not-found') throw err
    const created = await auth.createUser({
      email,
      emailVerified: true,
      disabled: false,
      displayName: `Tech — ${slug}`,
    })
    uid = created.uid
  }

  const fs = getAdminFirestore()
  const userRef = fs.doc(`users/${uid}`)
  const snap = await userRef.get()

  if (!snap.exists) {
    await userRef.set({
      email,
      displayName: `Tech — ${slug}`,
      baseRole: 'tech',
      customPermissions: {},
      assignedShows: [showId],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'tech-web-login',
    })
  } else {
    const data = snap.data() || {}
    const assigned = Array.isArray(data.assignedShows)
      ? (data.assignedShows as string[]).filter((id) => typeof id === 'string')
      : []
    const updates: Record<string, unknown> = {}
    if (data.baseRole !== 'tech' && data.baseRole !== 'admin') {
      // Do not demote admins who somehow share the email; unexpected — leave role
    } else if (!data.baseRole) {
      updates.baseRole = 'tech'
    }
    if (!assigned.includes(showId)) {
      updates.assignedShows = [...assigned, showId]
    }
    if (Object.keys(updates).length > 0) {
      await userRef.update(updates)
    }
  }

  return uid
}

/** Credential-only web login: Firestore unlock + custom token (no password). */
export async function webLoginWithCredential(credential: string): Promise<WebLoginResult> {
  const unlocked = await unlockShowByCredential(credential)
  const portalURL =
    typeof unlocked.show.portalURL === 'string' ? unlocked.show.portalURL.trim() : ''
  if (!portalURL) {
    throw new TechLifecycleError(
      400,
      'missing_portal_slug',
      'Show has no portal slug — set branding.portalURL in Admin before Tech web login',
    )
  }

  const uid = await ensureTechAuthUserForShow(unlocked.show.id, portalURL)
  const customToken = await getAdminAuth().createCustomToken(uid, {
    techShowId: unlocked.show.id,
  })

  return {
    customToken,
    show: {
      id: unlocked.show.id,
      name: unlocked.show.name,
      portalURL,
    },
  }
}
