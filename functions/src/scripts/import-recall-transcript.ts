/**
 * Recover a Recall transcript into Firestore for sessions that have audio
 * but no live-pipeline chunks (NO_TRANSCRIPT_INGRESS).
 *
 * DEFAULT: preview (no writes). Fetches Recall's existing transcript, prints
 * the raw response shape, a proposed TranscriptChunk mapping, and a signed
 * audio download URL for audioStoragePath.
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/cre8ion-onda-sa.json \
 *   FIREBASE_PROJECT_ID=cre8ion-onda \
 *   FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app \
 *   RECALL_API_KEY=... \
 *   npx tsx functions/src/scripts/import-recall-transcript.ts \
 *     --show-id=<showId> --session-id=<sessionId>
 *
 * Write (creates transcript chunks + auditLog TRANSCRIPT_RECOVERED):
 *   ... npx tsx functions/src/scripts/import-recall-transcript.ts \
 *     --show-id=<showId> --session-id=<sessionId> --write
 *
 * Overwrite is never silent. If transcripts/ already has documents:
 *   session already has N transcript chunks — use --force to overwrite
 * And --force still requires --confirm-overwrite (plus --write):
 *   ... --write --force --confirm-overwrite
 *
 * Does NOT touch feedState, reviewState, or trigger summarization.
 * recordingId is read from the session doc — not a CLI argument.
 */

import * as admin from 'firebase-admin'
import type { Timestamp } from 'firebase-admin/firestore'
import { getScriptFirestore, getScriptProjectId, getScriptStorage } from './adminInit'
import { mapRecallTranscriptDownload, summarizeTranscriptShape } from './importRecallTranscriptMap'
import type { MappedChunk, MapResult } from './importRecallTranscriptMap'

const AUDIO_SIGNED_URL_TTL_MS = 60 * 60 * 1000
const BATCH_SIZE = 400
const SAMPLE_LINE_COUNT = 5
const AUDIT_ACTION = 'TRANSCRIPT_RECOVERED'
const PERFORMED_BY = 'system:recall-transcript-import'

type CliArgs = {
  showId: string
  sessionId: string
  write: boolean
  force: boolean
  confirmOverwrite: boolean
  help: boolean
}

type SessionDocLike = {
  title?: string
  friendlyName?: string
  recordingId?: string
  audioStoragePath?: string
  scheduledStart?: Timestamp
}

function parseArgs(argv: string[]): CliArgs {
  let showId = ''
  let sessionId = ''
  let write = false
  let force = false
  let confirmOverwrite = false
  let help = false

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true
    if (arg === '--write') write = true
    if (arg === '--force') force = true
    if (arg === '--confirm-overwrite') confirmOverwrite = true

    const showMatch = arg.match(/^--show-id=(.+)$/)
    if (showMatch) showId = showMatch[1].trim()

    const sessionMatch = arg.match(/^--session-id=(.+)$/)
    if (sessionMatch) sessionId = sessionMatch[1].trim()
  }

  return { showId, sessionId, write, force, confirmOverwrite, help }
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx functions/src/scripts/import-recall-transcript.ts \\
    --show-id=<showId> --session-id=<sessionId>

Flags:
  (default)              Preview only — fetch Recall transcript, print raw shape,
                         mapping preview, and a 1-hour signed audio URL. No writes.
  --write                Create transcript chunks + auditLog TRANSCRIPT_RECOVERED.
  --force                Required if transcripts/ already has documents.
  --confirm-overwrite    Required together with --force --write. Overwrite is never silent.

recordingId is read from the session document. Do not pass it as an argument.

Does not touch feedState, reviewState, or trigger summarization.`)
}

function recallBaseUrl(region: string): string {
  const override = process.env.RECALL_API_BASE?.trim()
  if (override) return override.replace(/\/$/, '')
  return `https://${region}.recall.ai`
}

function sessionTitle(data: SessionDocLike): string {
  return (data.friendlyName || data.title || '(untitled)').trim()
}

function timestampToMs(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    return (value as Timestamp).toMillis()
  }
  return null
}

function redactUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.length > 60 ? `${parsed.pathname.slice(0, 60)}…` : parsed.pathname
    return `${parsed.protocol}//${parsed.host}${path}`
  } catch {
    return url.slice(0, 80) + (url.length > 80 ? '…' : '')
  }
}

type MediaShortcut = {
  id?: unknown
  status?: unknown
  data?: {
    download_url?: string | null
    provider_data_download_url?: string | null
  } | null
}

function asShortcuts(value: unknown): Record<string, MediaShortcut> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, MediaShortcut>
}

function extractTranscriptDownloadUrl(shortcuts: Record<string, MediaShortcut>): string | null {
  const url = shortcuts.transcript?.data?.download_url
  return typeof url === 'string' && url.trim() ? url.trim() : null
}

async function fetchRecallRecording(recordingId: string): Promise<{
  ok: boolean
  status: number
  json: Record<string, unknown>
}> {
  const apiKey = process.env.RECALL_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('RECALL_API_KEY is required to fetch the Recall recording/transcript')
  }
  const region = process.env.RECALL_REGION?.trim() || 'us-west-2'
  const url = `${recallBaseUrl(region)}/api/v1/recording/${encodeURIComponent(recordingId)}/`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      Authorization: `Token ${apiKey}`,
    },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

async function downloadJson(url: string): Promise<{
  contentType: string | null
  httpStatus: number
  body: unknown
  rawPreview: string
}> {
  const res = await fetch(url)
  const contentType = res.headers.get('content-type')
  const text = await res.text()
  const rawPreview = text.length > 500 ? `${text.slice(0, 500)}…` : text

  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  return { contentType, httpStatus: res.status, body, rawPreview }
}

function printDivider(title: string): void {
  console.log('')
  console.log(`=== ${title} ===`)
}

function printRecordingShape(json: Record<string, unknown>): void {
  const shortcuts = asShortcuts(json.media_shortcuts)
  const shortcutSummary = Object.fromEntries(
    Object.entries(shortcuts).map(([key, value]) => {
      const data = value?.data ?? null
      return [
        key,
        {
          id: value?.id ?? null,
          status: value?.status ?? null,
          has_download_url: Boolean(data?.download_url),
          has_provider_data_download_url: Boolean(data?.provider_data_download_url),
          download_url: redactUrl(typeof data?.download_url === 'string' ? data.download_url : null),
        },
      ]
    }),
  )

  console.log(
    JSON.stringify(
      {
        id: json.id ?? null,
        status: json.status ?? null,
        topLevelKeys: Object.keys(json),
        media_shortcuts_keys: Object.keys(shortcuts),
        media_shortcuts: shortcutSummary,
      },
      null,
      2,
    ),
  )
}

function printTranscriptShape(opts: {
  contentType: string | null
  httpStatus: number
  body: unknown
}): void {
  const shape = summarizeTranscriptShape(opts.body)
  console.log(
    JSON.stringify(
      {
        httpStatus: opts.httpStatus,
        contentType: opts.contentType,
        parsedType: shape.parsedType,
        arrayLength: shape.arrayLength,
        firstItemKeys: shape.firstItemKeys,
        firstItemWordCount: shape.firstItemWordCount,
        firstWordKeys: shape.firstWordKeys,
      },
      null,
      2,
    ),
  )
  console.log('')
  console.log('Sample (first utterance / truncated):')
  console.log(shape.sampleJson)
}

function printMappingPreview(mapped: MapResult): void {
  if (!mapped.ok) {
    console.log('FLAG: transcript format is not a 1:1 text + speaker + sequence mapping.')
    console.log(mapped.reason)
    console.log('No mapping will be written. Inspect the raw shape above before proceeding.')
    return
  }

  const charCount = mapped.chunks.reduce((sum, c) => sum + c.text.trim().length, 0)
  const speakers = new Set(mapped.chunks.map((c) => c.speakerLabel).filter(Boolean))
  const sample = mapped.chunks.slice(0, SAMPLE_LINE_COUNT)

  console.log(`Format: ${mapped.format} (documented Recall utterance array)`)
  console.log(`Chunks that would be created: ${mapped.chunks.length}`)
  console.log(`Skipped empty utterances: ${mapped.skippedEmptyUtterances}`)
  console.log(`Total character count (trimmed text): ${charCount.toLocaleString()}`)
  console.log(`Distinct speaker labels: ${speakers.size === 0 ? '(none)' : [...speakers].join(', ')}`)
  console.log('')
  console.log(`Sample lines (first ${sample.length}):`)
  for (const chunk of sample) {
    const prefix = chunk.speakerLabel ? `${chunk.speakerLabel}: ` : ''
    const text =
      chunk.text.length > 240 ? `${chunk.text.slice(0, 240)}…` : chunk.text
    console.log(`  [${chunk.sequenceNumber}] ${prefix}${text}`)
  }
}

async function signedAudioUrl(audioStoragePath: string | null): Promise<void> {
  printDivider('Audio download')

  if (!audioStoragePath) {
    console.log('audioStoragePath: (none — session has no audioStoragePath)')
    console.log('No signed URL to generate.')
    return
  }

  console.log(`audioStoragePath: ${audioStoragePath}`)

  try {
    const bucket = getScriptStorage().bucket()
    const bucketName = bucket.name
    console.log(`gs://${bucketName}/${audioStoragePath}`)

    const file = bucket.file(audioStoragePath)
    const [exists] = await file.exists()
    if (!exists) {
      console.log('Storage object: NOT FOUND — cannot sign a download URL.')
      return
    }

    const expires = Date.now() + AUDIO_SIGNED_URL_TTL_MS
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires,
    })
    console.log(`Signed URL (1 hour, expires ${new Date(expires).toISOString()}):`)
    console.log(url)
  } catch (err) {
    console.log(
      `Could not generate a signed URL: ${err instanceof Error ? err.message : String(err)}`,
    )
    console.log(
      'Set FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app and use a service account key that can sign URLs.',
    )
  }
}

async function loadExistingChunkIds(
  showId: string,
  sessionId: string,
): Promise<string[]> {
  const snap = await getScriptFirestore()
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .get()
  return snap.docs.map((d) => d.id)
}

async function deleteChunks(showId: string, sessionId: string, ids: string[]): Promise<void> {
  const firestore = getScriptFirestore()
  const col = firestore.collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.delete(col.doc(id))
    }
    await batch.commit()
  }
}

async function writeChunks(
  showId: string,
  sessionId: string,
  chunks: MappedChunk[],
): Promise<void> {
  const firestore = getScriptFirestore()
  const col = firestore.collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    const slice = chunks.slice(i, i + BATCH_SIZE)
    for (const chunk of slice) {
      batch.set(col.doc(), {
        text: chunk.text,
        speakerLabel: chunk.speakerLabel,
        timestamp: admin.firestore.Timestamp.fromMillis(chunk.timestampMs),
        sequenceNumber: chunk.sequenceNumber,
        translations: chunk.translations,
        isFinalized: true,
      })
    }
    await batch.commit()
  }
}

async function writeAuditLog(opts: {
  showId: string
  sessionId: string
  recordingId: string
  chunkCount: number
  charCount: number
  overwrittenChunkCount: number
}): Promise<void> {
  await getScriptFirestore().collection('auditLog').add({
    action: AUDIT_ACTION,
    performedBy: PERFORMED_BY,
    performedAt: admin.firestore.FieldValue.serverTimestamp(),
    showId: opts.showId,
    sessionId: opts.sessionId,
    metadata: {
      source: 'recall_transcript_url',
      recordingId: opts.recordingId,
      chunkCount: opts.chunkCount,
      charCount: opts.charCount,
      overwrittenChunkCount: opts.overwrittenChunkCount,
    },
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  if (!args.showId || !args.sessionId) {
    printUsage()
    throw new Error('Both --show-id and --session-id are required')
  }

  const firestore = getScriptFirestore()
  const projectId = getScriptProjectId()

  console.log('=== Recall transcript recovery import ===')
  console.log(`Mode: ${args.write ? 'WRITE' : 'PREVIEW (no writes)'}`)
  console.log(`Project: ${projectId}`)
  console.log(`Show: ${args.showId}`)
  console.log(`Session: ${args.sessionId}`)
  console.log(`Force: ${args.force}  confirm-overwrite: ${args.confirmOverwrite}`)
  console.log('')

  const sessionRef = firestore.doc(`shows/${args.showId}/sessions/${args.sessionId}`)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) {
    throw new Error(`Session not found: shows/${args.showId}/sessions/${args.sessionId}`)
  }

  const data = sessionSnap.data() as SessionDocLike
  const recordingId = typeof data.recordingId === 'string' ? data.recordingId.trim() : ''
  const audioStoragePath =
    typeof data.audioStoragePath === 'string' && data.audioStoragePath.trim()
      ? data.audioStoragePath.trim()
      : null
  const scheduledStartMs = timestampToMs(data.scheduledStart)

  console.log(`Title: ${sessionTitle(data)}`)
  console.log(`recordingId (from session doc): ${recordingId || '(missing)'}`)
  console.log(`audioStoragePath: ${audioStoragePath ?? '(missing)'}`)

  const existingIds = await loadExistingChunkIds(args.showId, args.sessionId)
  console.log(`Existing transcript chunks: ${existingIds.length}`)

  // Audio URL is useful even when there is no Recall transcript (Group B).
  await signedAudioUrl(audioStoragePath)

  if (!recordingId) {
    console.log('')
    console.log('No recordingId on the session document — cannot fetch a Recall transcript.')
    console.log('Audio URL above is still valid if Storage signing succeeded.')
    if (args.write) {
      throw new Error('Refusing --write: session has no recordingId')
    }
    return
  }

  printDivider('RAW Recall recording retrieve')
  const retrieve = await fetchRecallRecording(recordingId)
  if (!retrieve.ok) {
    console.log(`Recall Retrieve Recording failed: HTTP ${retrieve.status}`)
    console.log(JSON.stringify(retrieve.json, null, 2).slice(0, 2000))
    throw new Error(`Recall Retrieve Recording failed (HTTP ${retrieve.status})`)
  }
  printRecordingShape(retrieve.json)

  const shortcuts = asShortcuts(retrieve.json.media_shortcuts)
  const transcriptUrl = extractTranscriptDownloadUrl(shortcuts)

  if (!transcriptUrl) {
    printDivider('Recall transcript')
    console.log('No media_shortcuts.transcript.data.download_url on this recording.')
    console.log('This session cannot be recovered via transcript import (audio-only / Group B).')
    console.log('Use the signed audio URL above if you need the recording locally.')
    if (args.write) {
      throw new Error('Refusing --write: Recall recording has no transcript download_url')
    }
    return
  }

  printDivider('RAW transcript download')
  const downloaded = await downloadJson(transcriptUrl)
  if (downloaded.httpStatus < 200 || downloaded.httpStatus >= 300) {
    console.log(`Transcript download failed: HTTP ${downloaded.httpStatus}`)
    console.log(downloaded.rawPreview)
    throw new Error(`Transcript download failed (HTTP ${downloaded.httpStatus})`)
  }
  printTranscriptShape({
    contentType: downloaded.contentType,
    httpStatus: downloaded.httpStatus,
    body: downloaded.body,
  })

  printDivider('Proposed mapping')
  const mapped = mapRecallTranscriptDownload(downloaded.body, {
    fallbackBaseMs: scheduledStartMs ?? Date.now(),
  })
  printMappingPreview(mapped)

  if (!mapped.ok) {
    if (args.write) {
      throw new Error('Refusing --write: transcript format is unrecognized. See FLAG above.')
    }
    console.log('')
    console.log('Preview complete — no writes. Re-run with --write only after the mapping looks right.')
    return
  }

  if (mapped.chunks.length === 0) {
    console.log('')
    console.log('Recall transcript mapped to 0 chunks (empty). Nothing to import.')
    if (args.write) {
      throw new Error('Refusing --write: mapped transcript has 0 chunks')
    }
    return
  }

  if (existingIds.length > 0) {
    console.log('')
    console.log(
      `session already has ${existingIds.length} transcript chunks — use --force to overwrite`,
    )
    if (args.write && !args.force) {
      throw new Error(
        `Refusing --write: session already has ${existingIds.length} transcript chunks. ` +
          `Re-run with --write --force --confirm-overwrite to replace them.`,
      )
    }
    if (args.write && args.force && !args.confirmOverwrite) {
      throw new Error(
        `Overwrite is not silent. Re-run with --write --force --confirm-overwrite ` +
          `to delete the existing ${existingIds.length} chunks and replace them.`,
      )
    }
  }

  if (!args.write) {
    console.log('')
    console.log('Preview complete — no writes.')
    console.log(
      'If the mapping looks right: re-run with --write ' +
        '(add --force --confirm-overwrite if chunks already exist).',
    )
    console.log('Does not touch feedState, reviewState, or trigger summarization.')
    return
  }

  const overwrittenChunkCount = existingIds.length
  if (overwrittenChunkCount > 0) {
    console.log('')
    console.log(
      `WRITE: deleting ${overwrittenChunkCount} existing chunks, then inserting ${mapped.chunks.length} recovered chunks…`,
    )
    await deleteChunks(args.showId, args.sessionId, existingIds)
  } else {
    console.log('')
    console.log(`WRITE: inserting ${mapped.chunks.length} recovered chunks…`)
  }

  await writeChunks(args.showId, args.sessionId, mapped.chunks)
  const charCount = mapped.chunks.reduce((sum, c) => sum + c.text.trim().length, 0)
  await writeAuditLog({
    showId: args.showId,
    sessionId: args.sessionId,
    recordingId,
    chunkCount: mapped.chunks.length,
    charCount,
    overwrittenChunkCount,
  })

  console.log('')
  console.log('=== Write complete ===')
  console.log(`Chunks written: ${mapped.chunks.length}`)
  console.log(`Characters: ${charCount.toLocaleString()}`)
  console.log(`auditLog: ${AUDIT_ACTION} (source=recall_transcript_url, recordingId=${recordingId})`)
  console.log('feedState / reviewState / summarization: not touched.')
  console.log('Next: open Review and click Generate Summary for this session.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
