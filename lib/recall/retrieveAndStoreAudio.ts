/**
 * Server-side Recall audio retrieve → Firebase Storage.
 *
 * Triggered by verified `sdk_upload.complete` (workspace Svix webhook).
 * The webhook event means the recording is ready — no polling.
 *
 * Storage object path (canonical):
 *   shows/{showId}/sessions/{sessionId}/audio/{recordingId}.mp3
 *
 * Firestore session field written by the webhook after a successful upload:
 *   audioStoragePath — that Storage object path (string)
 *   recordingId      — Recall recording id (string)
 *   audioStoredAt    — server timestamp
 *
 * Independent of Electron's local download path (electron-spike/downloads/).
 */
import { getAdminStorage } from '@/lib/firebase/admin'

export type RetrieveAndStoreAudioResult = {
  storagePath: string
  bytes: number
  contentType: string
  audioUrlHost: string | null
}

export type RecallAudioFailureCode =
  | 'missing_api_key'
  | 'retrieve_failed'
  | 'no_audio_url'
  | 'download_failed'
  | 'storage_upload_failed'
  | 'missing_storage_bucket'

export class RecallAudioRetrieveError extends Error {
  code: RecallAudioFailureCode
  detail?: unknown

  constructor(code: RecallAudioFailureCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'RecallAudioRetrieveError'
    this.code = code
    this.detail = detail
  }
}

/** Canonical Storage object path for a session's Recall audio. */
export function buildSessionAudioStoragePath(
  showId: string,
  sessionId: string,
  recordingId: string,
): string {
  return `shows/${showId}/sessions/${sessionId}/audio/${recordingId}.mp3`
}

function recallBaseUrl(region: string): string {
  const override = process.env.RECALL_API_BASE?.trim()
  if (override) return override.replace(/\/$/, '')
  return `https://${region}.recall.ai`
}

type MediaShortcuts = {
  audio_mixed?: { data?: { download_url?: string | null } | null } | null
  audio_mixed_mp3?: { data?: { download_url?: string | null } | null } | null
}

export function extractAudioDownloadUrl(mediaShortcuts: unknown): string | null {
  const shortcuts = (mediaShortcuts ?? {}) as MediaShortcuts
  return (
    shortcuts.audio_mixed?.data?.download_url ??
    shortcuts.audio_mixed_mp3?.data?.download_url ??
    null
  )
}

/**
 * GET Recall Retrieve Recording, download audio bytes, upload to Firebase Storage.
 */
export async function retrieveAndStoreRecallAudio(opts: {
  showId: string
  sessionId: string
  recordingId: string
  apiKey?: string | null
  region?: string | null
  storageBucket?: string | null
}): Promise<RetrieveAndStoreAudioResult> {
  const apiKey = (opts.apiKey ?? process.env.RECALL_API_KEY)?.trim()
  if (!apiKey) {
    throw new RecallAudioRetrieveError(
      'missing_api_key',
      'RECALL_API_KEY is not configured — cannot Retrieve Recording on sdk_upload.complete',
    )
  }

  const region = (opts.region ?? process.env.RECALL_REGION ?? 'us-west-2').trim()
  const recordingId = opts.recordingId
  const retrieveUrl = `${recallBaseUrl(region)}/api/v1/recording/${encodeURIComponent(recordingId)}/`

  let retrieveJson: Record<string, unknown> = {}
  let retrieveStatus = 0
  try {
    const res = await fetch(retrieveUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    })
    retrieveStatus = res.status
    retrieveJson = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      throw new RecallAudioRetrieveError(
        'retrieve_failed',
        `Recall Retrieve Recording failed (${res.status}) for recordingId=${recordingId}`,
        retrieveJson,
      )
    }
  } catch (err) {
    if (err instanceof RecallAudioRetrieveError) throw err
    throw new RecallAudioRetrieveError(
      'retrieve_failed',
      `Recall Retrieve Recording request errored for recordingId=${recordingId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { retrieveStatus },
    )
  }

  const audioUrl = extractAudioDownloadUrl(retrieveJson.media_shortcuts)
  if (!audioUrl) {
    throw new RecallAudioRetrieveError(
      'no_audio_url',
      `Recall recording ${recordingId} has no audio download_url in media_shortcuts ` +
        `(checked audio_mixed and audio_mixed_mp3) — not marking session ended without audio`,
      {
        mediaShortcutKeys: Object.keys(
          (retrieveJson.media_shortcuts as Record<string, unknown> | undefined) ?? {},
        ),
        status: retrieveJson.status ?? null,
      },
    )
  }

  let audioBytes: Buffer
  let contentType = 'audio/mpeg'
  try {
    const dl = await fetch(audioUrl)
    if (!dl.ok) {
      throw new RecallAudioRetrieveError(
        'download_failed',
        `Audio download failed (${dl.status}) for recordingId=${recordingId}`,
      )
    }
    const headerType = dl.headers.get('content-type')
    if (headerType?.startsWith('audio/')) contentType = headerType.split(';')[0]!.trim()
    audioBytes = Buffer.from(await dl.arrayBuffer())
    if (audioBytes.length === 0) {
      throw new RecallAudioRetrieveError(
        'download_failed',
        `Audio download returned empty body for recordingId=${recordingId}`,
      )
    }
  } catch (err) {
    if (err instanceof RecallAudioRetrieveError) throw err
    throw new RecallAudioRetrieveError(
      'download_failed',
      `Audio download errored for recordingId=${recordingId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  const storagePath = buildSessionAudioStoragePath(opts.showId, opts.sessionId, recordingId)
  const bucketName =
    (opts.storageBucket ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)?.trim() || null
  if (!bucketName) {
    throw new RecallAudioRetrieveError(
      'missing_storage_bucket',
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not configured — cannot upload session audio',
    )
  }

  try {
    const bucket = getAdminStorage().bucket(bucketName)
    const file = bucket.file(storagePath)
    await file.save(audioBytes, {
      resumable: false,
      contentType,
      metadata: {
        contentType,
        metadata: {
          showId: opts.showId,
          sessionId: opts.sessionId,
          recordingId,
          source: 'recall_sdk_upload_complete',
        },
      },
    })
  } catch (err) {
    if (err instanceof RecallAudioRetrieveError) throw err
    throw new RecallAudioRetrieveError(
      'storage_upload_failed',
      `Firebase Storage upload failed for ${storagePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { storagePath, bytes: audioBytes.length },
    )
  }

  let audioUrlHost: string | null = null
  try {
    audioUrlHost = new URL(audioUrl).host
  } catch {
    audioUrlHost = null
  }

  return {
    storagePath,
    bytes: audioBytes.length,
    contentType,
    audioUrlHost,
  }
}
