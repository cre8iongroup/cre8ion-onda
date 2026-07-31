/**
 * QR code generation + Storage paths (server-side).
 */

import QRCode from 'qrcode'
import { getAdminStorage } from '@/lib/firebase/admin'
import { roomPublicUrl, sessionPublicUrl } from '@/lib/attendee/urls'

export type QrTargetType = 'room' | 'session'
export type QrFormat = 'png' | 'svg'

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

export async function generateQrBuffer(
  targetUrl: string,
  format: QrFormat,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (format === 'svg') {
    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 2,
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
  await file.makePublic().catch(() => {
    // Rules may already allow public read; token URL fallback below
  })

  // Prefer Firebase download URL with token if makePublic is restricted
  const [meta] = await file.getMetadata()
  const token = meta.metadata?.firebaseStorageDownloadTokens
  if (token) {
    const encoded = encodeURIComponent(storagePath)
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`
  }

  return `https://storage.googleapis.com/${bucket.name}/${storagePath}`
}
