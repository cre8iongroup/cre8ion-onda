/**
 * Workspace-level Recall webhook logic (POST /api/recall/webhook).
 *
 * Auth: Svix only (RECALL_SVIX_SIGNING_SECRET). Never x-recall-secret —
 * that header is for the Electron per-session forwarder at /api/webhook/[sessionId].
 *
 * sdk_upload.complete →
 *   1. resolve session via recordingIndex/{recordingId} only
 *   2. Retrieve Recording + upload audio to Firebase Storage
 *   3. markSessionEndedFromRecall (lifecycle ended + audioStoragePath on session)
 *
 * Electron's local download is unchanged — this is an independent server path.
 */
import { pushRtdbJson } from '@/lib/firebase/admin'
import { rtdbLiveSessionChunksPath } from '@/lib/rtdbPaths'
import { applyTextCorrections } from '@/lib/recall/applyTextCorrections'
import { loadTextCorrectionsForSession } from '@/lib/recall/loadTextCorrectionsForSession'
import { normalizeToOndaPayload } from '@/lib/recall/normalizeTranscript'
import {
  RecallAudioRetrieveError,
  retrieveAndStoreRecallAudio,
  type RetrieveAndStoreAudioResult,
} from '@/lib/recall/retrieveAndStoreAudio'
import { verifyRecallSvixPayload, SvixVerificationError, listIncomingHeaderNames } from '@/lib/recall/verifySvix'
import {
  markSessionEndedFromRecall,
  resolveSessionIdFromRecordingId,
} from '@/lib/tech/sessionLifecycle'

export type WorkspaceWebhookDeps = {
  resolveSessionIdFromRecordingId: typeof resolveSessionIdFromRecordingId
  markSessionEndedFromRecall: typeof markSessionEndedFromRecall
  retrieveAndStoreRecallAudio: typeof retrieveAndStoreRecallAudio
  pushRtdbJson: typeof pushRtdbJson
  verify: typeof verifyRecallSvixPayload
}

const defaultDeps: WorkspaceWebhookDeps = {
  resolveSessionIdFromRecordingId,
  markSessionEndedFromRecall,
  retrieveAndStoreRecallAudio,
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
    retrieveAndStoreRecallAudio:
      testDeps?.retrieveAndStoreRecallAudio ?? defaultDeps.retrieveAndStoreRecallAudio,
    pushRtdbJson: testDeps?.pushRtdbJson ?? defaultDeps.pushRtdbJson,
    verify: testDeps?.verify ?? defaultDeps.verify,
  }
}

export type WorkspaceWebhookResult = {
  status: number
  body: Record<string, unknown>
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
  // Header *names* only (never values) — confirms Recall/Svix brand in App Hosting logs.
  console.info('[recall/webhook] incoming header names', {
    names: listIncomingHeaderNames(opts.headers),
  })

  const d = deps()

  let body: unknown
  try {
    // Pass full Headers — verifyRecallSvixPayload + svix Webhook.verify handle
    // both webhook-* (Recall docs) and svix-* brands.
    body = d.verify(opts.rawBody, opts.headers)
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

      let stored: RetrieveAndStoreAudioResult
      try {
        stored = await d.retrieveAndStoreRecallAudio({
          showId: resolved.showId,
          sessionId: resolved.sessionId,
          recordingId,
        })
      } catch (err) {
        const code =
          err instanceof RecallAudioRetrieveError ? err.code : 'retrieve_failed'
        const detail = err instanceof RecallAudioRetrieveError ? err.detail : undefined
        console.error(
          '[recall/webhook] LOUD FAILURE: server-side Recall audio retrieve/store failed — NOT marking session ended (no silent empty audio).',
          {
            recordingId,
            sessionId: resolved.sessionId,
            showId: resolved.showId,
            code,
            message: err instanceof Error ? err.message : String(err),
            detail,
            flag: 'recall_audio_retrieve_store',
          },
        )
        return {
          status: 502,
          body: {
            error:
              err instanceof Error
                ? err.message
                : 'Recall audio retrieve/store failed',
            code: `recall_audio_${code}`,
            recordingId,
            sessionId: resolved.sessionId,
            showId: resolved.showId,
            flag: 'recall_audio_retrieve_store',
          },
        }
      }

      const result = await d.markSessionEndedFromRecall({
        sessionId: resolved.sessionId,
        showId: resolved.showId,
        recordingId,
        audioStoragePath: stored.storagePath,
        reason: event,
      })

      console.info('[recall/webhook] session ended + audio stored via Svix sdk_upload.complete', {
        recordingId,
        sessionId: result.sessionId,
        showId: result.showId,
        audioStoragePath: stored.storagePath,
        audioBytes: stored.bytes,
      })

      return {
        status: 200,
        body: {
          ended: true,
          ...result,
          audioStoragePath: stored.storagePath,
          audioBytes: stored.bytes,
        },
      }
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

  // Canonical path — must match database.rules.json + Operator CaptionPreview
  const rtdbPath = rtdbLiveSessionChunksPath(normalized.sessionId)
  const corrections = await loadTextCorrectionsForSession(normalized.sessionId)
  const correctedText = applyTextCorrections(normalized.text, corrections)
  const textChanged = correctedText !== normalized.text
  if (normalized.isFinal || textChanged || corrections.length > 0) {
    console.info('[recall/webhook] text corrections', {
      sessionId: normalized.sessionId,
      isFinal: normalized.isFinal,
      ruleCount: corrections.length,
      matched: textChanged,
      before: normalized.text,
      after: correctedText,
    })
  }
  const payload = {
    text: correctedText,
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
