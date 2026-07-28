/**
 * Local verification for POST /api/recall/webhook (Svix path) including
 * server-side Recall audio retrieve → Storage path wiring.
 *
 * Does NOT require a live Recall domain, Firebase credentials, or App Hosting.
 * Spins a tiny HTTP server that wraps the same `handleWorkspaceRecallWebhook`
 * used by `app/api/recall/webhook/route.ts`, posts signed cases, exits
 * non-zero on failure.
 *
 * Usage:
 *   npx tsx scripts/verify-recall-svix-local.ts
 *
 * For a fuller path (mock Recall HTTP + Firebase Storage emulator upload), see:
 *   npx tsx scripts/verify-recall-audio-store-local.ts
 */
import http from 'http'
import { Webhook } from 'svix'
import { RecallAudioRetrieveError } from '../lib/recall/retrieveAndStoreAudio'
import {
  __setWorkspaceWebhookTestDeps,
  handleWorkspaceRecallWebhook,
} from '../lib/recall/workspaceWebhook'

/** Stable test secret (whsec_ + base64). Not used in production. */
const TEST_SECRET =
  'whsec_' + Buffer.from('onda_local_svix_verify_secret_v1!!').toString('base64')

process.env.RECALL_SVIX_SIGNING_SECRET = TEST_SECRET

type CaseResult = {
  name: string
  pass: boolean
  detail: string
}

function sign(body: string): { id: string; timestamp: string; signature: string } {
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

function sdkUploadCompleteBody(recordingId: string): string {
  return JSON.stringify({
    event: 'sdk_upload.complete',
    data: {
      data: { code: 'complete', sub_code: null, updated_at: new Date().toISOString() },
      recording: { id: recordingId, metadata: {} },
      sdk_upload: { id: 'upload_test', metadata: {} },
    },
  })
}

async function post(
  port: number,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/recall/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
  const json = (await res.json()) as Record<string, unknown>
  return { status: res.status, json }
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const endedCalls: Array<{
    sessionId: string
    showId?: string | null
    recordingId?: string | null
    audioStoragePath?: string | null
    reason: string
  }> = []
  const audioCalls: Array<{
    showId: string
    sessionId: string
    recordingId: string
  }> = []
  let audioShouldFail = false

  __setWorkspaceWebhookTestDeps({
    resolveSessionIdFromRecordingId: async (recordingId) => {
      if (recordingId === 'rec_known_local') {
        return { sessionId: 'sess_local_1', showId: 'show_local_1' }
      }
      return null
    },
    retrieveAndStoreRecallAudio: async (opts) => {
      audioCalls.push({
        showId: opts.showId,
        sessionId: opts.sessionId,
        recordingId: opts.recordingId,
      })
      if (audioShouldFail) {
        throw new RecallAudioRetrieveError(
          'no_audio_url',
          'simulated missing audio URL',
        )
      }
      const storagePath = `shows/${opts.showId}/sessions/${opts.sessionId}/audio/${opts.recordingId}.mp3`
      return {
        storagePath,
        bytes: 128,
        contentType: 'audio/mpeg',
        audioUrlHost: 'mock.recall.test',
      }
    },
    markSessionEndedFromRecall: async (opts) => {
      endedCalls.push(opts)
      return { ok: true as const, sessionId: opts.sessionId, showId: opts.showId ?? null }
    },
    pushRtdbJson: async () => {
      throw new Error('pushRtdbJson should not run in lifecycle cases')
    },
  })

  const server = http.createServer(async (req, res) => {
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
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server')
  const port = addr.port
  console.log(`[verify] local endpoint http://127.0.0.1:${port}/api/recall/webhook`)
  console.log(`[verify] using test secret (not a live Recall secret)`)
  console.log(`[verify] no live domain / Firebase / App Hosting required\n`)

  const results: CaseResult[] = []

  // ── (a) valid signature + known recordingId + audio ok → ended + path
  {
    endedCalls.length = 0
    audioCalls.length = 0
    audioShouldFail = false
    const body = sdkUploadCompleteBody('rec_known_local')
    const sig = sign(body)
    const { status, json } = await post(port, body, {
      'svix-id': sig.id,
      'svix-timestamp': sig.timestamp,
      'svix-signature': sig.signature,
    })
    const expectedPath =
      'shows/show_local_1/sessions/sess_local_1/audio/rec_known_local.mp3'
    const pass =
      status === 200 &&
      json.ended === true &&
      json.sessionId === 'sess_local_1' &&
      json.audioStoragePath === expectedPath &&
      audioCalls.length === 1 &&
      endedCalls.length === 1 &&
      endedCalls[0].sessionId === 'sess_local_1' &&
      endedCalls[0].showId === 'show_local_1' &&
      endedCalls[0].audioStoragePath === expectedPath &&
      endedCalls[0].reason === 'sdk_upload.complete'
    results.push({
      name: '(a) valid signature + known recordingId → audio stored + session ended',
      pass,
      detail: JSON.stringify({ status, json, endedCalls, audioCalls }),
    })
  }

  // ── (b) invalid signature → rejected
  {
    endedCalls.length = 0
    audioCalls.length = 0
    audioShouldFail = false
    const body = sdkUploadCompleteBody('rec_known_local')
    const sig = sign(body)
    const { status, json } = await post(port, body, {
      'svix-id': sig.id,
      'svix-timestamp': sig.timestamp,
      'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    })
    const pass =
      status === 401 &&
      endedCalls.length === 0 &&
      audioCalls.length === 0 &&
      (json.code === 'invalid_signature' || typeof json.error === 'string')
    results.push({
      name: '(b) invalid signature → rejected (401)',
      pass,
      detail: JSON.stringify({ status, json, endedCalls, audioCalls }),
    })
  }

  // ── (c) valid signature + unknown recordingId → loud 422, no silent no-op
  {
    endedCalls.length = 0
    audioCalls.length = 0
    audioShouldFail = false
    const body = sdkUploadCompleteBody('rec_UNKNOWN_no_index')
    const sig = sign(body)
    const { status, json } = await post(port, body, {
      'svix-id': sig.id,
      'svix-timestamp': sig.timestamp,
      'svix-signature': sig.signature,
    })
    const pass =
      status === 422 &&
      json.code === 'recording_index_miss' &&
      json.flag === 'recall_lifecycle_session_resolution' &&
      endedCalls.length === 0 &&
      audioCalls.length === 0
    results.push({
      name: '(c) valid signature + unknown recordingId → loud 422 (no silent no-op)',
      pass,
      detail: JSON.stringify({ status, json, endedCalls, audioCalls }),
    })
  }

  // ── (d) audio retrieve fails → loud 502, session NOT ended
  {
    endedCalls.length = 0
    audioCalls.length = 0
    audioShouldFail = true
    const body = sdkUploadCompleteBody('rec_known_local')
    const sig = sign(body)
    const { status, json } = await post(port, body, {
      'svix-id': sig.id,
      'svix-timestamp': sig.timestamp,
      'svix-signature': sig.signature,
    })
    const pass =
      status === 502 &&
      json.flag === 'recall_audio_retrieve_store' &&
      typeof json.code === 'string' &&
      String(json.code).startsWith('recall_audio_') &&
      audioCalls.length === 1 &&
      endedCalls.length === 0
    results.push({
      name: '(d) audio retrieve failure → loud 502, session NOT ended',
      pass,
      detail: JSON.stringify({ status, json, endedCalls, audioCalls }),
    })
  }

  __setWorkspaceWebhookTestDeps(null)
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )

  console.log('── Results ──────────────────────────────────────────')
  let allPass = true
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`       ${r.detail}`)
    if (!r.pass) allPass = false
  }
  console.log('─────────────────────────────────────────────────────')
  if (!allPass) {
    console.error('One or more cases failed')
    process.exit(1)
  }
  console.log('All local Svix verification cases passed (incl. audio retrieve wiring).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
