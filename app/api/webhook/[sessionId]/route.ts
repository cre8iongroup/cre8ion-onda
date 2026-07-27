import { NextRequest, NextResponse } from 'next/server'
import { pushRtdbJson } from '@/lib/firebase/admin'
import { normalizeToOndaPayload } from '@/lib/recall/normalizeTranscript'
import {
  markSessionEndedFromRecall,
  resolveSessionIdFromRecordingId,
} from '@/lib/tech/sessionLifecycle'

/**
 * POST /api/webhook/[sessionId]
 *
 * Per-session webhook so multi-room deployments never mix transcript chunks.
 *
 * Accepts:
 *  1. Onda-normalized transcript payloads (Electron forwarder + x-recall-secret)
 *  2. Native Recall transcript.data envelopes
 *  3. Recall Desktop SDK lifecycle events (sdk_upload.complete / recording_ended)
 *     → marks session ended (NOT on stop-button alone)
 *
 * IMPLEMENTATION NOTE — Recall lifecycle signal quality:
 *  - Cleanest "recording actually closed out" signal: `sdk_upload.complete`
 *    (media ready). `sdk_upload.recording_ended` means capture stopped but
 *    upload may still be in progress — we treat complete as authoritative ended.
 *  - Svix dashboard payloads document `sdk_upload.metadata: {}` even when
 *    create-upload set metadata.sessionId. Do NOT rely on metadata alone;
 *    Electron calls /api/tech/sessions/bind-recording so we can resolve via
 *    recording.id → recordingIndex/{id}. Path param [sessionId] is preferred
 *    when Electron (or a tunneled per-session URL) posts here directly.
 *  - Workspace-level Svix endpoints should also hit /api/recall/webhook (legacy)
 *    or this route with the correct sessionId; without bind-recording, ended
 *    cannot be attributed in multi-room.
 */

type RouteCtx = { params: Promise<{ sessionId: string }> }

function extractLifecycleEvent(body: Record<string, unknown>): {
  event: string
  recordingId: string | null
  uploadId: string | null
  metadataSessionId: string | null
} | null {
  const event = typeof body.event === 'string' ? body.event : null
  if (!event || !event.startsWith('sdk_upload.')) return null

  const data = (body.data ?? {}) as Record<string, unknown>
  const recording = (data.recording ?? {}) as Record<string, unknown>
  const sdkUpload = (data.sdk_upload ?? {}) as Record<string, unknown>
  const uploadMeta = (sdkUpload.metadata ?? {}) as Record<string, unknown>
  const recordingMeta = (recording.metadata ?? {}) as Record<string, unknown>

  const metadataSessionId =
    (typeof uploadMeta.sessionId === 'string' ? uploadMeta.sessionId : null) ??
    (typeof recordingMeta.sessionId === 'string' ? recordingMeta.sessionId : null)

  return {
    event,
    recordingId: typeof recording.id === 'string' ? recording.id : null,
    uploadId: typeof sdkUpload.id === 'string' ? sdkUpload.id : null,
    metadataSessionId,
  }
}

export async function POST(request: NextRequest, context: RouteCtx) {
  const { sessionId: pathSessionId } = await context.params

  const secret = request.headers.get('x-recall-secret')
  const expected = process.env.RECALL_WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.warn('[webhook/session] Invalid or missing x-recall-secret', { pathSessionId })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!pathSessionId) {
    return NextResponse.json({ error: 'Missing sessionId in path' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // ── Lifecycle events (ended authority)
  const lifecycle = extractLifecycleEvent(bodyObj)
  if (lifecycle) {
    console.info('[webhook/session] lifecycle event', {
      pathSessionId,
      event: lifecycle.event,
      recordingId: lifecycle.recordingId,
      metadataSessionId: lifecycle.metadataSessionId,
    })

    if (lifecycle.event === 'sdk_upload.complete') {
      let sessionId = pathSessionId
      if (lifecycle.metadataSessionId && lifecycle.metadataSessionId !== pathSessionId) {
        console.warn('[webhook/session] metadata sessionId mismatch — preferring path', {
          pathSessionId,
          metadataSessionId: lifecycle.metadataSessionId,
        })
      }
      if (lifecycle.recordingId) {
        const resolved = await resolveSessionIdFromRecordingId(lifecycle.recordingId)
        if (resolved && resolved.sessionId !== pathSessionId) {
          console.warn('[webhook/session] recordingIndex session differs from path', {
            pathSessionId,
            resolved,
          })
          // Prefer path for this route; index is advisory here
        }
      }

      const result = await markSessionEndedFromRecall({
        sessionId,
        recordingId: lifecycle.recordingId,
        reason: lifecycle.event,
      })
      return NextResponse.json({ ended: true, ...result }, { status: 200 })
    }

    // recording_ended / failed / started — log only; do not flip to ended yet
    return NextResponse.json(
      { ok: true, skipped: lifecycle.event, note: 'ended only on sdk_upload.complete' },
      { status: 200 },
    )
  }

  // ── Skip other non-transcript events
  if (
    typeof bodyObj.event === 'string' &&
    bodyObj.event !== 'transcript.data' &&
    bodyObj.event !== 'transcript.partial_data' &&
    typeof bodyObj.text !== 'string'
  ) {
    return NextResponse.json({ ok: true, skipped: bodyObj.event }, { status: 200 })
  }

  const eventHint =
    typeof bodyObj.event === 'string' ? bodyObj.event : request.nextUrl.searchParams.get('event')

  const normalized = normalizeToOndaPayload(body, pathSessionId, { eventHint })
  if (!normalized) {
    return NextResponse.json({ error: 'Unrecognized transcript payload' }, { status: 400 })
  }

  // Force path sessionId so a spoofed body.sessionId cannot cross rooms
  const sessionId = pathSessionId
  const rtdbPath = `liveSessions/${sessionId}/chunks`
  const payload = {
    text: normalized.text,
    speakerLabel: normalized.speaker ?? null,
    timestamp: normalized.timestamp,
    sequenceNumber: normalized.sequenceNumber ?? 0,
    isFinalized: normalized.isFinal,
    translations: {},
  }

  try {
    const { name: chunkId } = await pushRtdbJson(rtdbPath, payload, { timeoutMs: 15_000 })
    console.info('[webhook/session] chunk written', { sessionId, chunkId })
    return NextResponse.json({ ok: true, chunkId, sessionId }, { status: 200 })
  } catch (err) {
    console.error('[webhook/session] RTDB write failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-recall-secret',
    },
  })
}
