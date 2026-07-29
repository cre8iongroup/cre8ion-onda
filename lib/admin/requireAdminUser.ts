import { NextRequest } from 'next/server'
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase/admin'
import { resolveCapabilities } from '@/lib/permissions/check'
import type { Capabilities, UserDoc } from '@/types'

export class AdminAuthError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Verify Firebase ID token from Authorization: Bearer <token> and load
 * the Firestore users/{uid} doc + resolved capabilities.
 */
export async function requireAdminUser(request: NextRequest): Promise<{
  uid: string
  email: string | undefined
  userDoc: UserDoc
  capabilities: Capabilities
}> {
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) {
    throw new AdminAuthError(401, 'missing_token', 'Authorization Bearer token required')
  }

  let decoded: { uid: string; email?: string }
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1])
  } catch {
    throw new AdminAuthError(401, 'invalid_token', 'Invalid or expired auth token')
  }

  const snap = await getAdminFirestore().doc(`users/${decoded.uid}`).get()
  if (!snap.exists) {
    throw new AdminAuthError(403, 'user_not_found', 'User profile not found')
  }

  const userDoc = snap.data() as UserDoc
  const capabilities = resolveCapabilities(userDoc)
  return {
    uid: decoded.uid,
    email: decoded.email,
    userDoc,
    capabilities,
  }
}

export function requireShowEditCapability(capabilities: Capabilities): void {
  if (!capabilities.canEditShows && !capabilities.canCreateShows) {
    throw new AdminAuthError(
      403,
      'forbidden',
      'Missing canEditShows / canCreateShows capability',
    )
  }
}
