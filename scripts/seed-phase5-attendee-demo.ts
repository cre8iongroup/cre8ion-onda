/**
 * Seed a minimal published show + room + session for Phase 5 attendee testing.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda \
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://cre8ion-onda-default-rtdb.firebaseio.com \
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app \
 *   npx tsx scripts/seed-phase5-attendee-demo.ts
 *
 * Prints the public URLs to hit locally after `npm run dev`.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAdminFirestore } from '../lib/firebase/admin'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_SHOW_TIMEZONE,
  DEFAULT_TEXT_COLOR,
  syncAccentFields,
} from '../lib/branding'

async function main() {
  const fs = getAdminFirestore()
  const accents = syncAccentFields({
    primaryColor: DEFAULT_PRIMARY_COLOR,
    secondaryColor: DEFAULT_SECONDARY_COLOR,
  })

  const start = new Date()
  start.setHours(start.getHours() + 1, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)

  const showRef = fs.collection('shows').doc()
  const roomId = crypto.randomUUID()
  const slug = `phase5-demo-${Date.now().toString(36)}`

  await showRef.set({
    name: 'Phase 5 Attendee Demo',
    clientName: 'cre8ion',
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)),
    glossary: [],
    branding: {
      primaryColor: accents.primaryColor,
      secondaryColor: accents.secondaryColor,
      accentColors: accents.accentColors,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      textColor: DEFAULT_TEXT_COLOR,
      logoURL: '',
      endSessionBehavior: 'message',
      endSessionMessage: 'Thank you for attending.',
      portalURL: slug,
      legalNotice: 'Demo legal notice for Phase 5.',
    },
    defaultLanguages: ['en'],
    portalPublished: true,
    showTimezone: DEFAULT_SHOW_TIMEZONE,
    links: [
      { title: 'Event website', url: 'https://cre8ion.com', order: 0 },
      { title: 'Operator download', url: '/download', order: 1 },
    ],
    rooms: [{ id: roomId, name: 'Main Hall' }],
    transcriptionStyle: 'standard',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-phase5',
  })

  await showRef.collection('rooms').doc(roomId).set({
    name: 'Main Hall',
    branding: { inherit: true },
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-phase5',
  })

  const sessionRef = await showRef.collection('sessions').add({
    title: 'Welcome Keynote',
    friendlyName: 'Opening',
    roomId,
    scheduledStart: Timestamp.fromDate(start),
    scheduledEnd: Timestamp.fromDate(end),
    languages: ['en'],
    isDraft: false,
    feedState: 'standby',
    approvalState: {},
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-phase5',
  })

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000'
  console.log('[seed-phase5] created')
  console.log(`  showId:    ${showRef.id}`)
  console.log(`  roomId:    ${roomId}`)
  console.log(`  sessionId: ${sessionRef.id}`)
  console.log(`  slug:      ${slug}`)
  console.log('Public URLs:')
  console.log(`  ${origin}/show/${slug}`)
  console.log(`  ${origin}/room/${roomId}`)
  console.log(`  ${origin}/session/${sessionRef.id}`)
  console.log(`  ${origin}/show/${slug}/sessions`)
  console.log('Admin:')
  console.log(`  ${origin}/admin/shows/${showRef.id}`)
}

main().catch((err) => {
  console.error('[seed-phase5]', err)
  process.exit(1)
})
