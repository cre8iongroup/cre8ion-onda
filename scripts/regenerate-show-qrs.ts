/**
 * Regenerate all existing room/session QR codes for a show (or all shows).
 * Run AFTER App Hosting has the correct ONDA_PUBLIC_APP_URL / NEXT_PUBLIC_APP_URL.
 *
 * Loads `.env.local` automatically.
 *
 * Usage:
 *   SHOW_ID=gXCOEu9gUyGQhNWRJCt7 \
 *   npx tsx scripts/regenerate-show-qrs.ts
 *
 * Optional:
 *   DRY_RUN=1          — list targets only
 *   ONLY_EXISTING=0    — also generate for rooms/sessions that never had a QR
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { persistQrPair, qrTargetUrl } from '../lib/qr'
import { getAdminFirestore } from '../lib/firebase/admin'
import { getPublicAppOrigin } from '../lib/attendee/urls'

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
  const onlyExisting = process.env.ONLY_EXISTING !== '0'
  const onlyShowId = process.env.SHOW_ID?.trim() || null
  const origin = getPublicAppOrigin()

  console.log(`[regenerate-qrs] publicAppOrigin=${origin} dryRun=${dryRun} onlyExisting=${onlyExisting}`)
  if (/localhost|127\.0\.0\.1/.test(origin)) {
    throw new Error(
      `Public origin is localhost (${origin}). Set ONDA_PUBLIC_APP_URL=https://cre8ion-onda.app before regenerating.`,
    )
  }

  const fs = getAdminFirestore()
  let showDocs
  if (onlyShowId) {
    const one = await fs.doc(`shows/${onlyShowId}`).get()
    showDocs = one.exists ? [one] : []
  } else {
    showDocs = (await fs.collection('shows').get()).docs
  }

  console.log(`[regenerate-qrs] shows=${showDocs.length}`)
  const report: Array<{ showId: string; type: string; id: string; name: string; targetUrl: string }> =
    []

  for (const showDoc of showDocs) {
    const showId = showDoc.id
    const showName = (showDoc.data() as { name?: string }).name || showId
    console.log(`[regenerate-qrs] show ${showId} (${showName})`)

    const [roomsSnap, sessionsSnap] = await Promise.all([
      fs.collection(`shows/${showId}/rooms`).get(),
      fs.collection(`shows/${showId}/sessions`).get(),
    ])

    for (const doc of roomsSnap.docs) {
      const data = doc.data()
      const name = typeof data.name === 'string' ? data.name : doc.id
      const has = typeof data.qrCodeUrl === 'string' && data.qrCodeUrl.length > 0
      if (onlyExisting && !has) {
        console.log(`  skip room ${doc.id} (no qr)`)
        continue
      }
      const targetUrl = qrTargetUrl('room', doc.id)
      if (dryRun) {
        console.log(`  DRY_RUN room ${doc.id} (${name}) → ${targetUrl}`)
        report.push({ showId, type: 'room', id: doc.id, name, targetUrl })
        continue
      }
      const { pngUrl } = await persistQrPair(showId, 'room', doc.id)
      console.log(`  regenerated room ${doc.id} (${name}) → ${targetUrl} png=${pngUrl}`)
      report.push({ showId, type: 'room', id: doc.id, name, targetUrl })
    }

    for (const doc of sessionsSnap.docs) {
      const data = doc.data()
      const name =
        (typeof data.friendlyName === 'string' && data.friendlyName) ||
        (typeof data.title === 'string' && data.title) ||
        doc.id
      const has = typeof data.qrCodeUrl === 'string' && data.qrCodeUrl.length > 0
      if (onlyExisting && !has) {
        console.log(`  skip session ${doc.id} (no qr)`)
        continue
      }
      const targetUrl = qrTargetUrl('session', doc.id)
      if (dryRun) {
        console.log(`  DRY_RUN session ${doc.id} (${name}) → ${targetUrl}`)
        report.push({ showId, type: 'session', id: doc.id, name, targetUrl })
        continue
      }
      const { pngUrl } = await persistQrPair(showId, 'session', doc.id)
      console.log(`  regenerated session ${doc.id} (${name}) → ${targetUrl} png=${pngUrl}`)
      report.push({ showId, type: 'session', id: doc.id, name, targetUrl })
    }
  }

  console.log(`[regenerate-qrs] done count=${report.length}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error('[regenerate-qrs]', err)
  process.exit(1)
})
