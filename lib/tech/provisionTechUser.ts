import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import {
  deleteAuthUserByIdToken,
  signUpAuthUser,
} from '@/lib/firebase/createManagedUser'
import { techEmailForPortalSlug } from '@/lib/tech/credentials'
import type { UserDoc } from '@/types'

/**
 * Provision (or re-provision) the shared tech Auth user for a show.
 * Safe to call from admin client after creating/updating a show.
 *
 * If the Auth email already exists, returns { existed: true } and does not
 * change the password (admin must rotate via a dedicated reset later).
 */
export async function provisionTechAuthUser(opts: {
  showId: string
  portalSlug: string
  techCredential: string
  createdBy: string
}): Promise<{ uid: string; existed: boolean }> {
  const email = techEmailForPortalSlug(opts.portalSlug)
  const password = opts.techCredential

  let uid: string
  let idToken: string | null = null
  let existed = false

  try {
    const created = await signUpAuthUser(email, password)
    uid = created.uid
    idToken = created.idToken
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg.includes('already exists')) {
      existed = true
      // Cannot obtain uid without Admin SDK / sign-in. Caller should treat
      // "existed" as: credential may be stale; Auth user already present.
      return { uid: '', existed: true }
    }
    throw err
  }

  try {
    const payload: UserDoc = {
      email,
      displayName: `Tech — ${opts.portalSlug}`,
      baseRole: 'tech',
      customPermissions: {},
      assignedShows: [opts.showId],
      createdAt: Timestamp.now(),
      createdBy: opts.createdBy,
    }
    await setDoc(doc(getClientFirestore(), 'users', uid), payload)
  } catch (err) {
    if (idToken) {
      try {
        await deleteAuthUserByIdToken(idToken)
      } catch (rollbackErr) {
        console.error('provisionTechAuthUser: rollback failed', rollbackErr)
      }
    }
    throw err
  }

  return { uid, existed }
}
