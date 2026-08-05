import { NextRequest, NextResponse } from 'next/server'
import {
  AdminAuthError,
  requireAdminUser,
  requireTechManageCapability,
} from '@/lib/admin/requireAdminUser'
import { getAdminFirestore } from '@/lib/firebase/admin'
import { normalizeDeepgramKeyterms } from '@/lib/recall/deepgramStreamingPresets'
import type { TranscriptionStyle } from '@/types'

export const runtime = 'nodejs'

/**
 * POST /api/admin/shows/tech-settings
 * Body: {
 *   showId,
 *   techCredential?,
 *   transcriptionStyle?,
 *   operatorInstructions?,
 *   deepgramKeyterms?: string[],
 * }
 *
 * Requires canManageTech (independent of canEditShows / baseRole editor).
 * Writes via Admin SDK — client Firestore rules deny these fields on update.
 * Auth user provisioning for techCredential remains client-side (provisionTechAuthUser).
 */
export async function POST(request: NextRequest) {
  try {
    const { capabilities, userDoc } = await requireAdminUser(request)
    requireTechManageCapability(capabilities)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const showId = typeof body?.showId === 'string' ? body.showId.trim() : ''
    if (!showId) {
      return NextResponse.json({ error: 'showId required' }, { status: 400 })
    }

    const assigned = userDoc.assignedShows ?? []
    if (userDoc.baseRole !== 'admin' && assigned.length > 0 && !assigned.includes(showId)) {
      return NextResponse.json({ error: 'Not assigned to this show' }, { status: 403 })
    }

    const fs = getAdminFirestore()
    const showRef = fs.doc(`shows/${showId}`)
    const snap = await showRef.get()
    if (!snap.exists) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}

    if (typeof body?.techCredential === 'string') {
      const cred = body.techCredential.trim()
      if (cred.length < 8) {
        return NextResponse.json(
          { error: 'Credential must be at least 8 characters' },
          { status: 400 },
        )
      }
      updates.techCredential = cred
    }

    if (typeof body?.transcriptionStyle === 'string') {
      const style = body.transcriptionStyle as TranscriptionStyle
      if (style !== 'standard' && style !== 'lightweight') {
        return NextResponse.json({ error: 'Invalid transcriptionStyle' }, { status: 400 })
      }
      updates.transcriptionStyle = style
    }

    if (typeof body?.operatorInstructions === 'string') {
      updates.operatorInstructions = body.operatorInstructions
    }

    if (Array.isArray(body?.deepgramKeyterms)) {
      const invalid = body.deepgramKeyterms.some((t) => typeof t !== 'string')
      if (invalid) {
        return NextResponse.json(
          { error: 'deepgramKeyterms must be an array of strings' },
          { status: 400 },
        )
      }
      updates.deepgramKeyterms = normalizeDeepgramKeyterms(body.deepgramKeyterms as string[])
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No tech fields to update' }, { status: 400 })
    }

    await showRef.update(updates)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[api/admin/shows/tech-settings]', err)
    return NextResponse.json({ error: 'Failed to update tech settings' }, { status: 500 })
  }
}
