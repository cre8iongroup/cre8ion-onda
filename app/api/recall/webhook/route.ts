import { NextRequest, NextResponse } from 'next/server'
import { pushRtdbJson } from '@/lib/firebase/admin'
import { normalizeToOndaPayload } from '@/lib/recall/normalizeTranscript'
import {
  markSessionEndedFromRecall,
  resolveSessionIdFromRecordingId,
} from '@/lib/tech/sessionLifecycle'

/**
 * POST /api/recall/webhook
 *
 * Legacy / workspace-level entry (still used for Svix dashboard endpoints).
 * Prefer `/api/webhook/[sessionId]` for Electron transcript forwarding.
 *
 * Also handles `sdk_upload.complete` by resolving session via recordingIndex
 * (see bind-recording) because Recall docs show empty metadata on lifecycle
 * payloads.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-recall-secret')
  const expected = process.env.RECALL_WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.warn('[recall/webhook] Invalid or missing x-recall-secret header')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionIdFromQuery = request.nextUrl.searchParams.get('sessionId')
  const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Lifecycle: sdk_upload.*
  const event = typeof bodyObj.event === 'string' ? bodyObj.event : null
  if (event?.startsWith('sdk_upload.')) {
    const data = (bodyObj.data ?? {}) as Record<string, unknown>
    const recording = (data.recording ?? {}) as Record<string, unknown>
    const sdkUpload = (data.sdk_upload ?? {}) as Record<string, unknown>
    const uploadMeta = (sdkUpload.metadata ?? {}) as Record<string, unknown>
    const recordingId = typeof recording.id === 'string' ? recording.id : null
    const metaSessionId =
      (typeof uploadMeta.sessionId === 'string' ? uploadMeta.sessionId : null) ??
      sessionIdFromQuery

    console.info('[recall/webhook] lifecycle', { event, recordingId, metaSessionId })

    if (event === 'sdk_upload.complete') {
      let sessionId = metaSessionId
      let showId: string | null = null
      if (recordingId) {
        const resolved = await resolveSessionIdFromRecordingId(recordingId)
        if (resolved) {
          sessionId = sessionId || resolved.sessionId
          showId = resolved.showId
        }
      }
      if (!sessionId) {
        return NextResponse.json(
          {
            error:
              'Cannot resolve sessionId for sdk_upload.complete — set ?sessionId= or call bind-recording',
            flag: 'recall_lifecycle_session_resolution',
          },
          { status: 422 },
        )
      }
      const result = await markSessionEndedFromRecall({
        sessionId,
        showId,
        recordingId,
        reason: event,
      })
      return NextResponse.json({ ended: true, ...result }, { status: 200 })
    }

    return NextResponse.json(
      { ok: true, skipped: event, note: 'ended only on sdk_upload.complete' },
      { status: 200 },
    )
  }

  const sessionId =
    (typeof bodyObj.sessionId === 'string' ? bodyObj.sessionId : null) ??
    sessionIdFromQuery

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing sessionId (body.sessionId or ?sessionId=)' },
      { status: 400 },
    )
  }

  const eventHint =
    typeof bodyObj.event === 'string' ? bodyObj.event : request.nextUrl.searchParams.get('event')

  if (
    typeof bodyObj.event === 'string' &&
    bodyObj.event !== 'transcript.data' &&
    bodyObj.event !== 'transcript.partial_data' &&
    typeof bodyObj.text !== 'string'
  ) {
    return NextResponse.json({ ok: true, skipped: bodyObj.event }, { status: 200 })
  }

  const normalized = normalizeToOndaPayload(body, sessionId, { eventHint })
  if (!normalized) {
    return NextResponse.json({ error: 'Unrecognized transcript payload' }, { status: 400 })
  }

  const rtdbPath = `liveSessions/${normalized.sessionId}/chunks`
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
    console.info('[recall/webhook] chunk written', {
      sessionId: normalized.sessionId,
      chunkId,
    })
    return NextResponse.json({ ok: true, chunkId }, { status: 200 })
  } catch (err) {
    console.error('[recall/webhook] RTDB write failed:', err)
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
