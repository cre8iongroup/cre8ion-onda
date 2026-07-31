import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import {
  AdminAuthError,
  requireAdminUser,
} from '@/lib/admin/requireAdminUser'
import { getAdminFirestore } from '@/lib/firebase/admin'
import {
  generateQrBuffer,
  qrStoragePath,
  qrTargetUrl,
  uploadQrToStorage,
  type QrFormat,
  type QrTargetType,
} from '@/lib/qr'
import type { SessionDoc, ShowDoc } from '@/types'

export const runtime = 'nodejs'

function parseBody(raw: unknown): {
  type: QrTargetType
  showId: string
  id: string
  format: QrFormat
} | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const type = b.type === 'room' || b.type === 'session' ? b.type : null
  const showId = typeof b.showId === 'string' ? b.showId.trim() : ''
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  const format = b.format === 'svg' ? 'svg' : b.format === 'png' ? 'png' : null
  if (!type || !showId || !id || !format) return null
  return { type, showId, id, format }
}

/**
 * POST /api/admin/qr
 * Body: { type: 'room'|'session', showId, id, format: 'png'|'svg' }
 *
 * Requires canDownloadQr. Persists to Storage and updates qrCodeUrl (PNG preferred).
 * Contributors may download; only admin/editor may mutate docs — Contributors
 * get a generated file without requiring write if doc update is denied…
 * Actually: Contributors need the file. We update qrCodeUrl only when caller
 * canEditShows; Contributors still receive the generated asset in the response.
 */
export async function POST(request: NextRequest) {
  try {
    const { userDoc, capabilities } = await requireAdminUser(request)
    if (!capabilities.canDownloadQr) {
      return NextResponse.json({ error: 'Missing canDownloadQr' }, { status: 403 })
    }

    const parsed = parseBody(await request.json().catch(() => null))
    if (!parsed) {
      return NextResponse.json(
        { error: 'Expected { type, showId, id, format }' },
        { status: 400 },
      )
    }

    const { type, showId, id, format } = parsed
    const assigned = userDoc.assignedShows ?? []
    const isAdmin = userDoc.baseRole === 'admin'
    if (!isAdmin && assigned.length > 0 && !assigned.includes(showId)) {
      return NextResponse.json({ error: 'Not assigned to this show' }, { status: 403 })
    }

    const fs = getAdminFirestore()
    const showSnap = await fs.doc(`shows/${showId}`).get()
    if (!showSnap.exists) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 })
    }

    if (type === 'room') {
      const roomSnap = await fs.doc(`shows/${showId}/rooms/${id}`).get()
      if (!roomSnap.exists) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
    } else {
      const sessSnap = await fs.doc(`shows/${showId}/sessions/${id}`).get()
      if (!sessSnap.exists) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }
      void (sessSnap.data() as SessionDoc)
    }

    void (showSnap.data() as ShowDoc)

    const targetUrl = qrTargetUrl(type, id)
    const { buffer, contentType } = await generateQrBuffer(targetUrl, format)
    const storagePath = qrStoragePath(showId, type, id, format)
    const downloadUrl = await uploadQrToStorage(storagePath, buffer, contentType)

    // Persist qrCodeUrl when caller can edit (admin/editor). PNG is canonical.
    if (capabilities.canEditShows || capabilities.canCreateShows) {
      if (format === 'png') {
        const ref =
          type === 'room'
            ? fs.doc(`shows/${showId}/rooms/${id}`)
            : fs.doc(`shows/${showId}/sessions/${id}`)
        await ref.update({
          qrCodeUrl: downloadUrl,
          qrUpdatedAt: FieldValue.serverTimestamp(),
        })
      }
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${type}-${id}.qr.${format}"`,
        'X-Onda-Qr-Target': targetUrl,
        'X-Onda-Qr-Url': downloadUrl,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[api/admin/qr]', err)
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 })
  }
}
