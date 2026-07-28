/**
 * Local end-to-end verification: signed sdk_upload.complete → Retrieve Recording
 * → Firebase Storage + Firestore `audioStoragePath`.
 *
 * Modes:
 *   1) Emulator mode (default, no live domain / production Firebase):
 *        - Mock Recall HTTP (Retrieve Recording + audio bytes)
 *        - Firebase Storage + Firestore + RTDB emulators
 *        - Synthetic recordingId that the mock serves
 *
 *   2) Live Recall mode (optional):
 *        RECALL_API_KEY + RECALL_TEST_RECORDING_ID (+ Firebase Admin creds)
 *        Uses a real retrievable Recall recording against emulators or live
 *        Storage depending on FIREBASE_*_EMULATOR_HOST.
 *
 * Usage:
 *   npx tsx scripts/verify-recall-audio-store-local.ts
 *
 * Expects Firebase emulators already running OR will try to start them via npx.
 */
import { spawn, type ChildProcess } from 'child_process'
import http from 'http'
import { Webhook } from 'svix'
import { FieldValue } from 'firebase-admin/firestore'
import {
  getAdminFirestore,
  getAdminStorage,
  setRtdbJson,
} from '../lib/firebase/admin'
import {
  buildSessionAudioStoragePath,
  retrieveAndStoreRecallAudio,
} from '../lib/recall/retrieveAndStoreAudio'
import {
  __setWorkspaceWebhookTestDeps,
  handleWorkspaceRecallWebhook,
} from '../lib/recall/workspaceWebhook'
import {
  markSessionEndedFromRecall,
  resolveSessionIdFromRecordingId,
} from '../lib/tech/sessionLifecycle'

const TEST_SECRET =
  'whsec_' + Buffer.from('onda_local_svix_verify_secret_v1!!').toString('base64')

const SHOW_ID = 'show_audio_verify'
const SESSION_ID = 'sess_audio_verify'
const MOCK_RECORDING_ID = 'rec_audio_verify_local'
const BUCKET = 'cre8ion-onda.firebasestorage.app'

/** Minimal valid-ish MP3 frame payload (not playable; enough non-empty bytes). */
const MOCK_MP3 = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x4f, 0x6e, 0x64, 0x61, 0x41, 0x75, 0x64, 0x69, 0x6f, 0x54,
  0x65, 0x73, 0x74,
])

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForHttp(url: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.status > 0) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function sign(body: string) {
  const wh = new Webhook(TEST_SECRET)
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const ts = new Date()
  const signature = wh.sign(id, ts, body)
  return {
    id,
    timestamp: Math.floor(ts.getTime() / 1000).toString(),
    signature,
  }
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function startMockRecall(): Promise<{ port: number; close: () => Promise<void> }> {
  const liveRecordingId = process.env.RECALL_TEST_RECORDING_ID?.trim()
  const liveKey = process.env.RECALL_API_KEY?.trim()
  const useLiveRecall = Boolean(liveRecordingId && liveKey)

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/audio/mock.mp3') {
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': MOCK_MP3.length })
        res.end(MOCK_MP3)
        return
      }
      // GET /api/v1/recording/{id}/
      const match = url.pathname.match(/^\/api\/v1\/recording\/([^/]+)\/?$/)
      if (req.method === 'GET' && match) {
        const recordingId = decodeURIComponent(match[1]!)
        if (useLiveRecall && recordingId === liveRecordingId) {
          // Proxy to real Recall so the signed webhook can use a real recordingId.
          const region = process.env.RECALL_REGION?.trim() || 'us-west-2'
          const upstream = await fetch(
            `https://${region}.recall.ai/api/v1/recording/${encodeURIComponent(recordingId)}/`,
            {
              headers: {
                accept: 'application/json',
                Authorization: `Token ${liveKey}`,
              },
            },
          )
          const text = await upstream.text()
          res.writeHead(upstream.status, { 'content-type': 'application/json' })
          res.end(text)
          return
        }
        const downloadUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/audio/mock.mp3`
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: recordingId,
            status: { code: 'done' },
            media_shortcuts: {
              audio_mixed_mp3: { data: { download_url: downloadUrl } },
            },
          }),
        )
        return
      }
      res.writeHead(404)
      res.end('not found')
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('mock Recall bind failed')
  return {
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}

async function ensureEmulators(): Promise<ChildProcess | null> {
  const already =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST &&
    process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIREBASE_DATABASE_EMULATOR_HOST
  if (already) {
    console.log('[verify-audio] using pre-set emulator hosts')
    return null
  }

  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000'
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'

  console.log('[verify-audio] starting Firebase emulators (firestore, database, storage)…')
  const child = spawn(
    'npx',
    [
      '--yes',
      'firebase-tools@13.29.1',
      'emulators:start',
      '--only',
      'firestore,database,storage',
      '--project',
      'cre8ion-onda',
    ],
    {
      cwd: '/workspace',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  )

  let sawAllReady = false
  const onData = (buf: Buffer) => {
    const s = buf.toString()
    if (s.includes('All emulators ready')) sawAllReady = true
    process.stdout.write(`[emu] ${s}`)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Emulators exited early with code ${child.exitCode}`)
    }
    if (sawAllReady) break
    // Probe ports — database especially must accept connections before RTDB REST.
    const portsOk = await Promise.all(
      [8080, 9000, 9199].map(async (port) => {
        try {
          await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
          return true
        } catch {
          return false
        }
      }),
    )
    if (portsOk.every(Boolean)) {
      sawAllReady = true
      break
    }
    await sleep(500)
  }
  if (!sawAllReady) {
    child.kill('SIGTERM')
    throw new Error('Firebase emulators did not become ready in time')
  }
  // Extra settle — storage/rules sometimes lag the first accept.
  await sleep(1000)
  return child
}

async function seedSessionDocs(recordingId: string) {
  const db = getAdminFirestore()
  const sessionRef = db.doc(`shows/${SHOW_ID}/sessions/${SESSION_ID}`)
  await sessionRef.set(
    {
      title: 'Audio verify session',
      location: 'Lab',
      friendlyName: 'Audio Verify',
      languages: ['en'],
      lifecycleStatus: 'stopping',
      feedState: 'paused',
      approvalState: {},
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'verify-recall-audio-store-local',
      scheduledStart: FieldValue.serverTimestamp(),
      scheduledEnd: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  await setRtdbJson(`recordingIndex/${recordingId}`, {
    sessionId: SESSION_ID,
    showId: SHOW_ID,
    uploadId: 'upload_verify',
    boundAt: Date.now(),
  })

  await setRtdbJson(`liveSessions/${SESSION_ID}`, {
    showId: SHOW_ID,
    feedState: 'paused',
    recordingId,
  })
}

async function main() {
  const liveRecordingId = process.env.RECALL_TEST_RECORDING_ID?.trim()
  const liveKey = process.env.RECALL_API_KEY?.trim()
  const recordingId = liveRecordingId || MOCK_RECORDING_ID
  const mode = liveRecordingId && liveKey ? 'live-recall+emulator-storage' : 'mock-recall+emulator-storage'

  console.log(`[verify-audio] mode=${mode}`)
  console.log(`[verify-audio] recordingId=${recordingId}`)

  process.env.RECALL_SVIX_SIGNING_SECRET = TEST_SECRET
  process.env.RECALL_API_KEY = liveKey || 'test-recall-key'
  process.env.RECALL_REGION = process.env.RECALL_REGION || 'us-west-2'
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'cre8ion-onda'
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    'https://cre8ion-onda-default-rtdb.firebaseio.com'
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = BUCKET
  process.env.GOOGLE_APPLICATION_CREDENTIALS =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || '/tmp/onda-emu-sa.json'

  // Prefer already-running emulators (e.g. started in another terminal).
  let emu: ChildProcess | null = null
  const portsUp = await Promise.all(
    [8080, 9000, 9199].map(async (port) => {
      try {
        await fetch(`http://127.0.0.1:${port}/`)
        return true
      } catch {
        return false
      }
    }),
  )
  if (portsUp.every(Boolean)) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
    process.env.FIREBASE_DATABASE_EMULATOR_HOST =
      process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'
    process.env.FIREBASE_STORAGE_EMULATOR_HOST =
      process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199'
    console.log('[verify-audio] detected running emulators on 8080/9000/9199')
  } else {
    emu = await ensureEmulators()
  }
  const mockRecall = await startMockRecall()
  process.env.RECALL_API_BASE = `http://127.0.0.1:${mockRecall.port}`
  console.log(`[verify-audio] mock Recall at ${process.env.RECALL_API_BASE}`)

  // Clear webhook test overrides — exercise production deps against emulators.
  __setWorkspaceWebhookTestDeps(null)

  await seedSessionDocs(recordingId)

  // Sanity: retrieveAndStore alone
  const direct = await retrieveAndStoreRecallAudio({
    showId: SHOW_ID,
    sessionId: SESSION_ID,
    recordingId,
  })
  console.log('[verify-audio] direct retrieve+store ok', direct)

  const expectedPath = buildSessionAudioStoragePath(SHOW_ID, SESSION_ID, recordingId)
  if (direct.storagePath !== expectedPath) {
    throw new Error(`Unexpected storage path: ${direct.storagePath}`)
  }

  const bucket = getAdminStorage().bucket(BUCKET)
  const [exists] = await bucket.file(expectedPath).exists()
  if (!exists) throw new Error(`Storage object missing after upload: ${expectedPath}`)
  const [meta] = await bucket.file(expectedPath).getMetadata()
  console.log('[verify-audio] storage object present', {
    path: expectedPath,
    size: meta.size,
    contentType: meta.contentType,
  })

  // Full webhook path with real resolve + mark ended (emulator Firestore/RTDB)
  __setWorkspaceWebhookTestDeps({
    // Use real implementations — only leave verify as default env secret.
    resolveSessionIdFromRecordingId,
    markSessionEndedFromRecall,
    retrieveAndStoreRecallAudio,
  })

  const webhookServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url?.startsWith('/api/recall/webhook')) {
        const rawBody = await readRawBody(req)
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers.set(k, v)
          else if (Array.isArray(v) && v[0]) headers.set(k, v[0])
        }
        const result = await handleWorkspaceRecallWebhook({ rawBody, headers })
        res.writeHead(result.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result.body))
        return
      }
      res.writeHead(404)
      res.end('not found')
    } catch (err) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
  await new Promise<void>((r) => webhookServer.listen(0, '127.0.0.1', r))
  const whAddr = webhookServer.address()
  if (!whAddr || typeof whAddr === 'string') throw new Error('webhook server bind failed')

  // Reset session to stopping so ended transition is observable
  await getAdminFirestore().doc(`shows/${SHOW_ID}/sessions/${SESSION_ID}`).update({
    lifecycleStatus: 'stopping',
    feedState: 'paused',
    audioStoragePath: FieldValue.delete(),
    recordingId: FieldValue.delete(),
  })

  const body = JSON.stringify({
    event: 'sdk_upload.complete',
    data: {
      data: { code: 'complete', sub_code: null, updated_at: new Date().toISOString() },
      recording: { id: recordingId, metadata: {} },
      sdk_upload: { id: 'upload_verify', metadata: {} },
    },
  })
  const sig = sign(body)
  const res = await fetch(`http://127.0.0.1:${whAddr.port}/api/recall/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': sig.id,
      'webhook-timestamp': sig.timestamp,
      'webhook-signature': sig.signature,
    },
    body,
  })
  const json = (await res.json()) as Record<string, unknown>
  console.log('[verify-audio] webhook response', { status: res.status, json })

  if (res.status !== 200 || json.ended !== true || json.audioStoragePath !== expectedPath) {
    throw new Error(`Webhook did not end+store as expected: ${JSON.stringify(json)}`)
  }

  const snap = await getAdminFirestore().doc(`shows/${SHOW_ID}/sessions/${SESSION_ID}`).get()
  const data = snap.data() || {}
  console.log('[verify-audio] Firestore session fields', {
    lifecycleStatus: data.lifecycleStatus,
    feedState: data.feedState,
    recordingId: data.recordingId,
    audioStoragePath: data.audioStoragePath,
    audioStoredAt: data.audioStoredAt ?? null,
  })

  if (data.lifecycleStatus !== 'ended') {
    throw new Error(`Expected lifecycleStatus=ended, got ${data.lifecycleStatus}`)
  }
  if (data.audioStoragePath !== expectedPath) {
    throw new Error(`Expected audioStoragePath=${expectedPath}, got ${data.audioStoragePath}`)
  }
  if (data.recordingId !== recordingId) {
    throw new Error(`Expected recordingId=${recordingId}, got ${data.recordingId}`)
  }

  const [existsAfter] = await bucket.file(expectedPath).exists()
  if (!existsAfter) throw new Error('Storage object missing after webhook')

  console.log('─────────────────────────────────────────────────────')
  console.log('PASS  audio landed in Firebase Storage (emulator)')
  console.log(`      path: ${expectedPath}`)
  console.log('PASS  Firestore SessionDoc.audioStoragePath written')
  console.log(`      field: audioStoragePath`)
  console.log('─────────────────────────────────────────────────────')

  __setWorkspaceWebhookTestDeps(null)
  await new Promise<void>((resolve, reject) =>
    webhookServer.close((e) => (e ? reject(e) : resolve())),
  )
  await mockRecall.close()
  if (emu) {
    emu.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('[verify-audio] FAIL', err)
  process.exit(1)
})
