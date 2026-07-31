/**
 * One-time migration: promote ShowDoc.rooms[] → shows/{showId}/rooms/{roomId}.
 *
 * Preserves existing room IDs so Session.roomId references stay valid.
 * Does NOT modify sessions. Skips rooms that already have a subcollection doc.
 * Leaves ShowDoc.rooms[] in place (Operator unlock dual-write compatibility).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda \
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://cre8ion-onda-default-rtdb.firebaseio.com \
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app \
 *   npx tsx scripts/migrate-rooms-to-subcollection.ts
 *
 * Optional:
 *   DRY_RUN=1          — log only, no writes
 *   SHOW_ID=<id>       — migrate a single show
 */

import { FieldValue } from 'firebase-admin/firestore'
import { getAdminFirestore } from '../lib/firebase/admin'
import type { ShowDoc, ShowRoom } from '../types'

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
  const onlyShowId = process.env.SHOW_ID?.trim() || null

  const fs = getAdminFirestore()
  const showsSnap = onlyShowId
    ? await fs.collection('shows').where('__name__', '==', onlyShowId).get()
    : await fs.collection('shows').get()

  // Fallback if where __name__ fails for single show
  let docs = showsSnap.docs
  if (onlyShowId && docs.length === 0) {
    const one = await fs.doc(`shows/${onlyShowId}`).get()
    if (one.exists) docs = [one as typeof docs[0]]
  }

  console.log(`[migrate-rooms] shows=${docs.length} dryRun=${dryRun}`)

  let created = 0
  let skipped = 0

  for (const showDoc of docs) {
    const data = showDoc.data() as ShowDoc
    const rooms = (Array.isArray(data.rooms) ? data.rooms : []) as ShowRoom[]
    console.log(`[migrate-rooms] show ${showDoc.id} (${data.name}) rooms=${rooms.length}`)

    for (const room of rooms) {
      if (!room?.id || typeof room.name !== 'string') {
        console.warn(`  skip invalid room entry`, room)
        skipped++
        continue
      }
      const ref = fs.doc(`shows/${showDoc.id}/rooms/${room.id}`)
      const existing = await ref.get()
      if (existing.exists) {
        console.log(`  skip existing room ${room.id} (${room.name})`)
        skipped++
        continue
      }

      const payload = {
        name: room.name,
        branding: { inherit: true },
        createdAt: FieldValue.serverTimestamp(),
        createdBy: data.createdBy || 'migration',
      }

      if (dryRun) {
        console.log(`  DRY_RUN would create rooms/${room.id}`, payload)
      } else {
        await ref.set(payload)
        console.log(`  created rooms/${room.id} (${room.name})`)
      }
      created++
    }
  }

  console.log(`[migrate-rooms] done created=${created} skipped=${skipped}`)
}

main().catch((err) => {
  console.error('[migrate-rooms] error:', err)
  process.exit(1)
})
