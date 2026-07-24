/**
 * Manual RTDB write probe — confirms Admin token + REST push path.
 *
 * Usage (emulator):
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://cre8ion-onda-default-rtdb.firebaseio.com \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   npx tsx scripts/probe-rtdb-write.ts
 *
 * Usage (live): omit FIREBASE_DATABASE_EMULATOR_HOST; point URL + credentials at the real project.
 */
import { pushRtdbJson, getAdminAccessToken } from '../lib/firebase/admin'

async function main() {
  const sessionId = process.env.SESSION_ID || 'spike-probe-session'
  const started = Date.now()
  const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim())

  if (!usingEmulator) {
    console.log('[probe] fetching access token…')
    const token = await getAdminAccessToken()
    console.log('[probe] token prefix:', token.slice(0, 8) + '…', `(${Date.now() - started}ms)`)
  } else {
    console.log('[probe] emulator mode — skipping access token')
  }

  console.log('[probe] REST push…')
  const pushStarted = Date.now()
  const result = await pushRtdbJson(`liveSessions/${sessionId}/chunks`, {
    text: `probe ${new Date().toISOString()}`,
    speakerLabel: 'probe',
    timestamp: Date.now(),
    sequenceNumber: 0,
    isFinalized: true,
    translations: {},
  })
  const elapsed = Date.now() - pushStarted
  console.log('[probe] ok', { chunkId: result.name, elapsedMs: elapsed, totalMs: Date.now() - started })

  if (elapsed > 30_000) {
    console.error('[probe] FAIL: write took >30s — hang regression')
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('[probe] error:', err)
  process.exit(1)
})
