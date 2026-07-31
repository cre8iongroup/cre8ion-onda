/**
 * Shared QR generation + Storage persistence (server-side).
 * Used by POST /api/admin/qr for both the QR codes tab and Session/Room edit.
 */

import QRCode from 'qrcode'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminFirestore, getAdminStorage } from '@/lib/firebase/admin'
import {
  getPublicAppOrigin,
  roomPublicUrl,
  sessionPublicUrl,
} from '@/lib/attendee/urls'

export type QrTargetType = 'room' | 'session'
export type QrFormat = 'png' | 'svg'
export type QrAction = 'generate' | 'regenerate' | 'download'

export function qrStoragePath(
  showId: string,
  type: QrTargetType,
  id: string,
  format: QrFormat,
): string {
  if (type === 'room') return `shows/${showId}/rooms/${id}/qr.${format}`
  return `shows/${showId}/sessions/${id}/qr.${format}`
}

export function qrTargetUrl(type: QrTargetType, id: string): string {
  return type === 'room' ? roomPublicUrl(id) : sessionPublicUrl(id)
}

export function qrDocRef(showId: string, type: QrTargetType, id: string) {
  const fs = getAdminFirestore()
  return type === 'room'
    ? fs.doc(`shows/${showId}/rooms/${id}`)
    : fs.doc(`shows/${showId}/sessions/${id}`)
}

export async function generateQrBuffer(
  targetUrl: string,
  format: QrFormat,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (format === 'svg') {
    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 2,
      width: 512,
      errorCorrectionLevel: 'M',
    })
    return { buffer: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml' }
  }

  const buffer = await QRCode.toBuffer(targetUrl, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  })
  return { buffer, contentType: 'image/png' }
}

export async function uploadQrToStorage(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=3600',
    },
    resumable: false,
  })
  await file.makePublic().catch(() => {})

  const [meta] = await file.getMetadata()
  const token = meta.metadata?.firebaseStorageDownloadTokens
  if (token) {
    const encoded = encodeURIComponent(storagePath)
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`
  }

  return `https://storage.googleapis.com/${bucket.name}/${storagePath}`
}

export async function readQrFromStorage(
  storagePath: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) return null
  const [buffer] = await file.download()
  const [meta] = await file.getMetadata()
  const contentType =
    (meta.contentType as string) ||
    (storagePath.endsWith('.svg') ? 'image/svg+xml' : 'image/png')
  return { buffer, contentType }
}

/**
 * Create/overwrite PNG + SVG for a target and persist qrCodeUrl (PNG).
 * Shared by generate + regenerate so tab and edit page never diverge.
 */
export async function persistQrPair(
  showId: string,
  type: QrTargetType,
  id: string,
): Promise<{ pngUrl: string; targetUrl: string }> {
  const targetUrl = qrTargetUrl(type, id)
  // Defense in depth: never persist a QR that points at localhost in prod.
  if (/localhost|127\.0\.0\.1/.test(targetUrl) && process.env.K_SERVICE) {
    throw new Error(
      `Refusing to encode localhost QR target (${targetUrl}). ` +
        `Public origin resolved to ${getPublicAppOrigin()} — fix ONDA_PUBLIC_APP_URL / NEXT_PUBLIC_APP_URL.`,
    )
  }
  const png = await generateQrBuffer(targetUrl, 'png')
  const svg = await generateQrBuffer(targetUrl, 'svg')
  const pngPath = qrStoragePath(showId, type, id, 'png')
  const svgPath = qrStoragePath(showId, type, id, 'svg')
  const pngUrl = await uploadQrToStorage(pngPath, png.buffer, png.contentType)
  await uploadQrToStorage(svgPath, svg.buffer, svg.contentType)

  await qrDocRef(showId, type, id).update({
    qrCodeUrl: pngUrl,
    qrUpdatedAt: FieldValue.serverTimestamp(),
  })

  return { pngUrl, targetUrl }
}
