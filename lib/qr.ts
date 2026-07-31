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

/** CDN-friendly TTL for QR objects — short so a missed bust cannot linger for an hour. */
export const QR_CACHE_CONTROL = 'public, max-age=120'

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

/**
 * Append/replace `v=` with the Storage object generation so each persist
 * yields a distinct URL for browsers/CDNs even though the object path is stable.
 */
export function appendQrCacheBust(url: string, generation: string | number): string {
  const v = String(generation)
  try {
    const u = new URL(url)
    u.searchParams.set('v', v)
    return u.toString()
  } catch {
    const cleaned = url.replace(/([?&])v=[^&]*&?/, '$1').replace(/[?&]$/, '')
    return `${cleaned}${cleaned.includes('?') ? '&' : '?'}v=${encodeURIComponent(v)}`
  }
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
      cacheControl: QR_CACHE_CONTROL,
    },
    resumable: false,
  })
  await file.makePublic().catch(() => {})

  const [meta] = await file.getMetadata()
  const generation = meta.generation || String(Date.now())
  const token = meta.metadata?.firebaseStorageDownloadTokens

  let baseUrl: string
  if (token) {
    const encoded = encodeURIComponent(storagePath)
    baseUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`
  } else {
    baseUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`
  }

  return appendQrCacheBust(baseUrl, generation)
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
 * qrCodeUrl always includes a generation cache-bust query param.
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
