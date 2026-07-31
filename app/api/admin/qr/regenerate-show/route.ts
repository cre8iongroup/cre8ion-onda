import { NextRequest, NextResponse } from 'next/server'
import {
  AdminAuthError,
  requireAdminUser,
  requireQrGenerateCapability,
} from '@/lib/admin/requireAdminUser'
import { getAdminFirestore } from '@/lib/firebase/admin'
import { persistQrPair, qrTargetUrl } from '@/lib/qr'
import { getPublicAppOrigin } from '@/lib/attendee/urls'

export const runtime = 'nodejs'

/**
 * POST /api/admin/qr/regenerate-show
 * Body: { showId: string, onlyExisting?: boolean }
 *
 * Regenerates every room + session QR for a show (overwrites Storage + qrCodeUrl).
 * Use after fixing NEXT_PUBLIC_APP_URL / ONDA_PUBLIC_APP_URL so payloads stop
 * encoding localhost. onlyExisting=true (default) skips entities with no qrCodeUrl.
 */
export async function POST(request: NextRequest) {
  try {
    const { userDoc, capabilities } = await requireAdminUser(request)
    requireQrGenerateCapability(capabilities)

    const body = (await request.json().catch(() => null)) as {
      showId?: string
      onlyExisting?: boolean
    } | null
    const showId = typeof body?.showId === 'string' ? body.showId.trim() : ''
    const onlyExisting = body?.onlyExisting !== false
    if (!showId) {
      return NextResponse.json({ error: 'Expected { showId }' }, { status: 400 })
    }

    const assigned = userDoc.assignedShows ?? []
    if (userDoc.baseRole !== 'admin' && assigned.length > 0 && !assigned.includes(showId)) {
      throw new AdminAuthError(403, 'forbidden', 'Not assigned to this show')
    }

    const origin = getPublicAppOrigin()
    if (/localhost|127\.0\.0\.1/.test(origin)) {
      return NextResponse.json(
        {
          error: `Public origin is still localhost (${origin}). Fix App Hosting env before regenerating.`,
          publicAppOrigin: origin,
        },
        { status: 409 },
      )
    }

    const fs = getAdminFirestore()
    const showSnap = await fs.doc(`shows/${showId}`).get()
    if (!showSnap.exists) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 })
    }

    const [roomsSnap, sessionsSnap] = await Promise.all([
      fs.collection(`shows/${showId}/rooms`).get(),
      fs.collection(`shows/${showId}/sessions`).get(),
    ])

    const regenerated: Array<{
      type: 'room' | 'session'
      id: string
      name: string
      targetUrl: string
      pngUrl: string
    }> = []
    const skipped: Array<{ type: 'room' | 'session'; id: string; reason: string }> = []
    const failed: Array<{ type: 'room' | 'session'; id: string; error: string }> = []

    for (const doc of roomsSnap.docs) {
      const data = doc.data()
      const name = typeof data.name === 'string' ? data.name : doc.id
      const has = typeof data.qrCodeUrl === 'string' && data.qrCodeUrl.length > 0
      if (onlyExisting && !has) {
        skipped.push({ type: 'room', id: doc.id, reason: 'no existing qrCodeUrl' })
        continue
      }
      try {
        const { pngUrl, targetUrl } = await persistQrPair(showId, 'room', doc.id)
        regenerated.push({ type: 'room', id: doc.id, name, targetUrl, pngUrl })
      } catch (err: unknown) {
        failed.push({
          type: 'room',
          id: doc.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    for (const doc of sessionsSnap.docs) {
      const data = doc.data()
      const name =
        (typeof data.friendlyName === 'string' && data.friendlyName) ||
        (typeof data.title === 'string' && data.title) ||
        doc.id
      const has = typeof data.qrCodeUrl === 'string' && data.qrCodeUrl.length > 0
      if (onlyExisting && !has) {
        skipped.push({ type: 'session', id: doc.id, reason: 'no existing qrCodeUrl' })
        continue
      }
      try {
        const { pngUrl, targetUrl } = await persistQrPair(showId, 'session', doc.id)
        regenerated.push({ type: 'session', id: doc.id, name, targetUrl, pngUrl })
      } catch (err: unknown) {
        failed.push({
          type: 'session',
          id: doc.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({
      showId,
      publicAppOrigin: origin,
      sampleTarget: qrTargetUrl('room', 'example-id'),
      regenerated,
      skipped,
      failed,
    })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[api/admin/qr/regenerate-show]', err)
    return NextResponse.json({ error: 'Regenerate failed' }, { status: 500 })
  }
}
