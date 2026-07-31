import { NextRequest, NextResponse } from 'next/server'
import {
  AdminAuthError,
  requireAdminUser,
  requireQrDownloadCapability,
  requireQrGenerateCapability,
} from '@/lib/admin/requireAdminUser'
import { getAdminFirestore } from '@/lib/firebase/admin'
import {
  persistQrPair,
  qrStoragePath,
  qrTargetUrl,
  readQrFromStorage,
  type QrAction,
  type QrFormat,
  type QrTargetType,
} from '@/lib/qr'

export const runtime = 'nodejs'

function parseBody(raw: unknown): {
  type: QrTargetType
  showId: string
  id: string
  format: QrFormat
  action: QrAction
} | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const type = b.type === 'room' || b.type === 'session' ? b.type : null
  const showId = typeof b.showId === 'string' ? b.showId.trim() : ''
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  const format = b.format === 'svg' ? 'svg' : b.format === 'png' ? 'png' : 'png'
  const action: QrAction =
    b.action === 'regenerate' || b.action === 'generate' || b.action === 'download'
      ? b.action
      : 'download'
  if (!type || !showId || !id) return null
  return { type, showId, id, format, action }
}

function assertAssigned(
  userDoc: { baseRole: string; assignedShows?: string[] },
  showId: string,
) {
  const assigned = userDoc.assignedShows ?? []
  if (userDoc.baseRole !== 'admin' && assigned.length > 0 && !assigned.includes(showId)) {
    throw new AdminAuthError(403, 'forbidden', 'Not assigned to this show')
  }
}

/**
 * POST /api/admin/qr
 * Body: { type, showId, id, format?: 'png'|'svg', action: 'generate'|'regenerate'|'download' }
 *
 * Shared by QR codes tab + Session/Room edit — one generation path.
 * - generate / regenerate → requires canEditShows (never canDownloadQr alone)
 * - download → requires canDownloadQr; never creates a new code
 * - generate reuses existing qrCodeUrl; only regenerate overwrites Storage + field
 */
export async function POST(request: NextRequest) {
  try {
    const { userDoc, capabilities } = await requireAdminUser(request)
    const parsed = parseBody(await request.json().catch(() => null))
    if (!parsed) {
      return NextResponse.json(
        { error: 'Expected { type, showId, id, action, format? }' },
        { status: 400 },
      )
    }

    const { type, showId, id, format, action } = parsed
    assertAssigned(userDoc, showId)

    const fs = getAdminFirestore()
    const showSnap = await fs.doc(`shows/${showId}`).get()
    if (!showSnap.exists) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 })
    }

    const docRef =
      type === 'room'
        ? fs.doc(`shows/${showId}/rooms/${id}`)
        : fs.doc(`shows/${showId}/sessions/${id}`)
    const entitySnap = await docRef.get()
    if (!entitySnap.exists) {
      return NextResponse.json(
        { error: type === 'room' ? 'Room not found' : 'Session not found' },
        { status: 404 },
      )
    }

    const existingUrl =
      typeof entitySnap.data()?.qrCodeUrl === 'string'
        ? (entitySnap.data()!.qrCodeUrl as string)
        : ''

    if (action === 'generate' || action === 'regenerate') {
      requireQrGenerateCapability(capabilities)

      if (action === 'generate' && existingUrl) {
        // Reuse — do not silently regenerate
        const stored = await readQrFromStorage(qrStoragePath(showId, type, id, format))
        if (stored) {
          return new NextResponse(new Uint8Array(stored.buffer), {
            status: 200,
            headers: {
              'Content-Type': stored.contentType,
              'Content-Disposition': `inline; filename="${type}-${id}.qr.${format}"`,
              'X-Onda-Qr-Target': qrTargetUrl(type, id),
              'X-Onda-Qr-Url': existingUrl,
              'X-Onda-Qr-Reused': '1',
              'Cache-Control': 'no-store',
            },
          })
        }
        // PNG URL exists but storage object missing — fall through to persist
      }

      const { pngUrl, targetUrl } = await persistQrPair(showId, type, id)
      const stored = await readQrFromStorage(qrStoragePath(showId, type, id, format))
      if (!stored) {
        return NextResponse.json({ error: 'QR persisted but read-back failed' }, { status: 500 })
      }

      return new NextResponse(new Uint8Array(stored.buffer), {
        status: 200,
        headers: {
          'Content-Type': stored.contentType,
          'Content-Disposition': `inline; filename="${type}-${id}.qr.${format}"`,
          'X-Onda-Qr-Target': targetUrl,
          'X-Onda-Qr-Url': pngUrl,
          'X-Onda-Qr-Reused': '0',
          'Cache-Control': 'no-store',
        },
      })
    }

    // download — never generate
    requireQrDownloadCapability(capabilities)
    if (!existingUrl) {
      return NextResponse.json(
        { error: 'Not yet generated', code: 'not_generated' },
        { status: 404 },
      )
    }

    const stored = await readQrFromStorage(qrStoragePath(showId, type, id, format))
    if (!stored) {
      // Fallback: if PNG URL exists but SVG object missing, or vice versa —
      // regenerate that format from the same target URL without changing qrCodeUrl identity.
      // Still same payload URL so codes stay equivalent.
      const { generateQrBuffer, uploadQrToStorage } = await import('@/lib/qr')
      const targetUrl = qrTargetUrl(type, id)
      const fresh = await generateQrBuffer(targetUrl, format)
      await uploadQrToStorage(
        qrStoragePath(showId, type, id, format),
        fresh.buffer,
        fresh.contentType,
      )
      return new NextResponse(new Uint8Array(fresh.buffer), {
        status: 200,
        headers: {
          'Content-Type': fresh.contentType,
          'Content-Disposition': `attachment; filename="${type}-${id}.qr.${format}"`,
          'X-Onda-Qr-Target': targetUrl,
          'X-Onda-Qr-Url': existingUrl,
          'Cache-Control': 'no-store',
        },
      })
    }

    return new NextResponse(new Uint8Array(stored.buffer), {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Disposition': `attachment; filename="${type}-${id}.qr.${format}"`,
        'X-Onda-Qr-Target': qrTargetUrl(type, id),
        'X-Onda-Qr-Url': existingUrl,
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
