/**
 * Workspace-level Recall webhook logic (POST /api/recall/webhook).
 *
 * Auth: Svix only (RECALL_SVIX_SIGNING_SECRET). Never x-recall-secret —
 * that header is for the Electron per-session forwarder at /api/webhook/[sessionId].
 *
 * sdk_upload.complete → resolve session via recordingIndex/{recordingId} only,
 * then markSessionEndedFromRecall (same outcome as the Electron forwarder).
 */
import { pushRtdbJson } from '@/lib/firebase/admin'
import { normalizeToOndaPayload } from '@/lib/recall/normalizeTranscript'
import { verifyRecallSvixPayload, SvixVerificationError } from '@/lib/recall/verifySvix'
import {
  markSessionEndedFromRecall,
  resolveSessionIdFromRecordingId,
} from '@/lib/tech/sessionLifecycle'

export type WorkspaceWebhookDeps = {
  resolveSessionIdFromRecordingId: typeof resolveSessionIdFromRecordingId
  markSessionEndedFromRecall: typeof markSessionEndedFromRecall
  pushRtdbJson: typeof pushRtdbJson
  verify: typeof verifyRecallSvixPayload
}

const defaultDeps: WorkspaceWebhookDeps = {
  resolveSessionIdFromRecordingId,
  markSessionEndedFromRecall,
  pushRtdbJson,
  verify: verifyRecallSvixPayload,
}

/** @internal Test-only override — null restores production deps. */
let testDeps: Partial<WorkspaceWebhookDeps> | null = null

export function __setWorkspaceWebhookTestDeps(deps: Partial<WorkspaceWebhookDeps> | null) {
  testDeps = deps
}

function deps(): WorkspaceWebhookDeps {
  return {
    resolveSessionIdFromRecordingId:
      testDeps?.resolveSessionIdFromRecordingId ??
      defaultDeps.resolveSessionIdFromRecordingId,
    markSessionEndedFromRecall:
      testDeps?.markSessionEndedFromRecall ?? defaultDeps.markSessionEndedFromRecall,
    pushRtdbJson: testDeps?.pushRtdbJson ?? defaultDeps.pushRtdbJson,
    verify: testDeps?.verify ?? defaultDeps.verify,
  }
}

export type WorkspaceWebhookResult = {
  status: number
  body: Record<string, unknown>
}

function headerMap(headers: Headers): {
  'svix-id': string | null
  'svix-timestamp': string | null
  'svix-signature': string | null
} {
  return {
    'svix-id': headers.get('svix-id'),
    'svix-timestamp': headers.get('svix-timestamp'),
    'svix-signature': headers.get('svix-signature'),
  }
}

/**
 * Core handler used by the App Router route and the local verification script.
 * `rawBody` must be the exact UTF-8 string that was signed.
 */
export async function handleWorkspaceRecallWebhook(opts: {
  rawBody: string
  headers: Headers
  searchParams?: URLSearchParams
}): Promise<WorkspaceWebhookResult> {
  const d = deps()

  let body: unknown
  try {
    body = d.verify(opts.rawBody, headerMap(opts.headers))
  } catch (err) {
    if (err instanceof SvixVerificationError) {
      console.error('[recall/webhook] Svix verification rejected', {
        code: err.code,
        message: err.message,
      })
      return {
        status: 401,
        body: { error: err.message, code: err.code },
      }
    }
    console.error('[recall/webhook] Unexpected verification error', err)
    return { status: 401, body: { error: 'Unauthorized', code: 'invalid_signature' } }
  }

  const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const sessionIdFromQuery = opts.searchParams?.get('sessionId') ?? null

  const event = typeof bodyObj.event === 'string' ? bodyObj.event : null
  if (event?.startsWith('sdk_upload.')) {
    const data = (bodyObj.data ?? {}) as Record<string, unknown>
    const recording = (data.recording ?? {}) as Record<string, unknown>
    const sdkUpload = (data.sdk_upload ?? {}) as Record<string, unknown>
    const recordingId = typeof recording.id === 'string' ? recording.id : null

    console.info('[recall/webhook] lifecycle', { event, recordingId })

    if (event === 'sdk_upload.complete') {
      if (!recordingId) {
        console.error(
          '[recall/webhook] LOUD FAILURE: sdk_upload.complete missing data.recording.id — cannot resolve session',
          { event, bodyKeys: Object.keys(bodyObj) },
        )
        return {
          status: 422,
          body: {
            error: 'sdk_upload.complete missing data.recording.id',
            code: 'missing_recording_id',
            flag: 'recall_lifecycle_session_resolution',
          },
        }
      }

      const resolved = await d.resolveSessionIdFromRecordingId(recordingId)
      if (!resolved) {
        console.error(
          '[recall/webhook] LOUD FAILURE: no recordingIndex entry for recordingId — bind-recording must run after createSdkUpload. Not ending any session.',
          {
            recordingId,
            event,
            hint: 'POST /api/tech/sessions/bind-recording writes recordingIndex/{recordingId}',
          },
        )
        return {
          status: 422,
          body: {
            error:
              `No recordingIndex/${recordingId} entry — cannot resolve session for sdk_upload.complete. ` +
              'Upstream bind-recording likely failed or never ran.',
            code: 'recording_index_miss',
            recordingId,
            flag: 'recall_lifecycle_session_resolution',
          },
        }
      }

      const result = await d.markSessionEndedFromRecall({
        sessionId: resolved.sessionId,
        showId: resolved.showId,
        recordingId,
        reason: event,
      })

      console.info('[recall/webhook] session ended via Svix sdk_upload.complete', {
        recordingId,
        sessionId: result.sessionId,
        showId: result.showId,
      })

      return { status: 200, body: { ended: true, ...result } }
    }

    return {
      status: 200,
      body: { ok: true, skipped: event, note: 'ended only on sdk_upload.complete' },
    }
  }

  // Transcript / other payloads (still Svix-authenticated if Recall sends them here)
  const sessionId =
    (typeof bodyObj.sessionId === 'string' ? bodyObj.sessionId : null) ?? sessionIdFromQuery

  if (!sessionId) {
    return {
      status: 400,
      body: { error: 'Missing sessionId (body.sessionId or ?sessionId=)' },
    }
  }

  if (
    typeof bodyObj.event === 'string' &&
    bodyObj.event !== 'transcript.data' &&
    bodyObj.event !== 'transcript.partial_data' &&
    typeof bodyObj.text !== 'string'
  ) {
    return { status: 200, body: { ok: true, skipped: bodyObj.event } }
  }

  const eventHint =
    typeof bodyObj.event === 'string' ? bodyObj.event : opts.searchParams?.get('event') ?? null

  const normalized = normalizeToOndaPayload(body, sessionId, { eventHint })
  if (!normalized) {
    return { status: 400, body: { error: 'Unrecognized transcript payload' } }
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
    const { name: chunkId } = await d.pushRtdbJson(rtdbPath, payload, { timeoutMs: 15_000 })
    console.info('[recall/webhook] chunk written', {
      sessionId: normalized.sessionId,
      chunkId,
    })
    return { status: 200, body: { ok: true, chunkId } }
  } catch (err) {
    console.error('[recall/webhook] RTDB write failed:', err)
    return { status: 500, body: { error: 'Internal Server Error' } }
  }
}
