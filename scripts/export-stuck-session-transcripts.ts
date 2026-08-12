/**
 * One-off READ-ONLY export of stuck ALPFA session RTDB transcript chunks.
 *
 * Does NOT write feedState, RTDB, or Firestore. Exports CSVs under exports/
 * (gitignored) and prints per-session summaries to stdout.
 *
 * Loads `.env.local` automatically (same pattern as seed-alf009-sessions.ts).
 * When Admin credentials are present, also reads liveSessions meta (recordingId)
 * + Firestore SessionDoc and probes Recall Retrieve Recording.
 * Without credentials, falls back to public RTDB chunk/feedState reads +
 * production GET /api/public/sessions/:id for title/room/show.
 *
 * Usage:
 *   npx tsx scripts/export-stuck-session-transcripts.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { rtdbLiveSessionChunksPath, rtdbLiveSessionPath } from '../lib/rtdbPaths'

const SESSION_IDS = [
  'yFucDzMon7dgRBnkUkeY',
  'C4bBaqqCB4m5OdFgIJdc',
  'FTsTX1fuMi41g0kxPoKv',
  '6DLpWtKsqdtgoQ2l7eyB',
  'yYXDftcKZgf7052qcb6S',
  'RE3990vcyj7Ks65RVlPu',
] as const

const RTDB_ROOT =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim().replace(/\/$/, '') ||
  'https://cre8ion-onda-default-rtdb.firebaseio.com'

const PUBLIC_APP_ORIGIN =
  process.env.ONDA_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
  'https://cre8ion-onda.app'

type ChunkRow = {
  id: string
  sequenceNumber: number
  timestamp: number
  speakerLabel: string
  text: string
  isFinalized: boolean
}

type SessionMeta = {
  showId: string | null
  showName: string | null
  title: string | null
  roomId: string | null
  roomName: string | null
  firestoreFeedState: string | null
  recordingId: string | null
  uploadId: string | null
  audioStoragePath: string | null
  source: string
}

type Gap = { from: number; to: number; missing: number }

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toISOString()
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

async function publicGetJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}`)
  }
  return res.json()
}

/** Public RTDB child read (chunks / feedState are world-readable). */
async function publicRtdbGet(path: string): Promise<unknown> {
  const normalized = path.replace(/^\/+|\/+$/g, '')
  return publicGetJson(`${RTDB_ROOT}/${normalized}.json`)
}

async function loadPublicSessionMeta(sessionId: string): Promise<SessionMeta> {
  const url = `${PUBLIC_APP_ORIGIN}/api/public/sessions/${encodeURIComponent(sessionId)}`
  try {
    const body = (await publicGetJson(url)) as {
      session?: {
        id?: string
        showId?: string
        roomId?: string
        title?: string
        feedState?: string
      }
      show?: {
        name?: string
        rooms?: Array<{ id: string; name: string }>
      }
    }
    const session = body.session
    const show = body.show
    const rooms = Array.isArray(show?.rooms) ? show!.rooms! : []
    const roomId = session?.roomId ?? null
    const roomName = roomId ? rooms.find((r) => r.id === roomId)?.name ?? null : null
    return {
      showId: session?.showId ?? null,
      showName: show?.name ?? null,
      title: session?.title ?? null,
      roomId,
      roomName,
      firestoreFeedState: session?.feedState ?? null,
      recordingId: null,
      uploadId: null,
      audioStoragePath: null,
      source: `GET ${url}`,
    }
  } catch (err) {
    return {
      showId: null,
      showName: null,
      title: null,
      roomId: null,
      roomName: null,
      firestoreFeedState: null,
      recordingId: null,
      uploadId: null,
      audioStoragePath: null,
      source: `public session meta failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function tryAdminEnrich(sessionId: string, base: SessionMeta): Promise<SessionMeta> {
  const hasCreds = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim(),
  )
  if (!hasCreds) return base

  try {
    const { getRtdbJson, getAdminFirestore } = await import('../lib/firebase/admin')
    const live = (await getRtdbJson(rtdbLiveSessionPath(sessionId))) as {
      showId?: string
      recordingId?: string
      uploadId?: string
      feedState?: string
    } | null

    let recordingId = typeof live?.recordingId === 'string' ? live.recordingId : base.recordingId
    let uploadId = typeof live?.uploadId === 'string' ? live.uploadId : base.uploadId
    let audioStoragePath = base.audioStoragePath
    let showId = base.showId ?? (typeof live?.showId === 'string' ? live.showId : null)
    let title = base.title
    let roomId = base.roomId
    let roomName = base.roomName
    let showName = base.showName
    let firestoreFeedState = base.firestoreFeedState

    if (showId) {
      const snap = await getAdminFirestore().doc(`shows/${showId}/sessions/${sessionId}`).get()
      if (snap.exists) {
        const data = snap.data() as Record<string, unknown>
        if (typeof data.recordingId === 'string' && data.recordingId) recordingId = data.recordingId
        if (typeof data.audioStoragePath === 'string') audioStoragePath = data.audioStoragePath
        if (typeof data.title === 'string') title = data.title
        if (typeof data.roomId === 'string') roomId = data.roomId
        if (typeof data.feedState === 'string') firestoreFeedState = data.feedState
      }
      const showSnap = await getAdminFirestore().doc(`shows/${showId}`).get()
      if (showSnap.exists) {
        const sd = showSnap.data() as {
          name?: string
          rooms?: Array<{ id: string; name: string }>
        }
        if (typeof sd.name === 'string') showName = sd.name
        if (roomId && Array.isArray(sd.rooms)) {
          roomName = sd.rooms.find((r) => r.id === roomId)?.name ?? roomName
        }
      }
    }

    return {
      showId,
      showName,
      title,
      roomId,
      roomName,
      firestoreFeedState,
      recordingId,
      uploadId,
      audioStoragePath,
      source: `${base.source} + Admin RTDB/Firestore`,
    }
  } catch (err) {
    console.warn(
      `[export] Admin enrich failed for ${sessionId} (continuing with public data):`,
      err instanceof Error ? err.message : err,
    )
    return base
  }
}

async function loadChunks(sessionId: string): Promise<{
  chunks: ChunkRow[]
  rtdbFeedState: unknown
  source: string
}> {
  const hasCreds = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim(),
  )

  let raw: Record<string, Record<string, unknown>> | null = null
  let rtdbFeedState: unknown = null
  let source = 'public RTDB REST'

  if (hasCreds) {
    try {
      const { getRtdbJson } = await import('../lib/firebase/admin')
      raw = (await getRtdbJson(rtdbLiveSessionChunksPath(sessionId))) as typeof raw
      const live = (await getRtdbJson(rtdbLiveSessionPath(sessionId))) as {
        feedState?: unknown
      } | null
      rtdbFeedState = live?.feedState ?? null
      source = 'Admin getRtdbJson'
    } catch (err) {
      console.warn(
        `[export] Admin RTDB read failed for ${sessionId}; falling back to public REST:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  if (raw === null) {
    raw = (await publicRtdbGet(rtdbLiveSessionChunksPath(sessionId))) as typeof raw
    try {
      rtdbFeedState = await publicRtdbGet(`${rtdbLiveSessionPath(sessionId)}/feedState`)
    } catch {
      rtdbFeedState = null
    }
    source = 'public RTDB REST (chunks + feedState)'
  }

  const chunks: ChunkRow[] = []
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue
      const sequenceNumber =
        typeof v.sequenceNumber === 'number' && Number.isFinite(v.sequenceNumber)
          ? v.sequenceNumber
          : 0
      const timestamp =
        typeof v.timestamp === 'number' && Number.isFinite(v.timestamp) ? v.timestamp : 0
      chunks.push({
        id,
        sequenceNumber,
        timestamp,
        speakerLabel: typeof v.speakerLabel === 'string' ? v.speakerLabel : '',
        text: typeof v.text === 'string' ? v.text : '',
        isFinalized: Boolean(v.isFinalized),
      })
    }
  }

  const usableSeq = chunks.some((c) => c.sequenceNumber > 0)
  chunks.sort((a, b) => {
    if (usableSeq) {
      if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber
    }
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    return a.id.localeCompare(b.id)
  })

  return { chunks, rtdbFeedState, source }
}

function detectGaps(chunks: ChunkRow[]): {
  mode: 'sequential' | 'all_zero_or_absent'
  gaps: Gap[]
  minSeq: number | null
  maxSeq: number | null
  /** True when walking by sequenceNumber shows timestamps moving backwards (seq reuse / multi-start). */
  sequenceRestartSuspected: boolean
  backwardTimestampPairs: number
} {
  const seqs = chunks.map((c) => c.sequenceNumber).filter((n) => n > 0)
  if (seqs.length === 0) {
    return {
      mode: 'all_zero_or_absent',
      gaps: [],
      minSeq: null,
      maxSeq: null,
      sequenceRestartSuspected: false,
      backwardTimestampPairs: 0,
    }
  }
  const unique = [...new Set(seqs)].sort((a, b) => a - b)
  const gaps: Gap[] = []
  for (let i = 1; i < unique.length; i++) {
    const prev = unique[i - 1]!
    const curr = unique[i]!
    if (curr > prev + 1) {
      gaps.push({ from: prev, to: curr, missing: curr - prev - 1 })
    }
  }

  // Detect seq counter restarts: when sorted by sequenceNumber, timestamps should
  // roughly increase. Many backwards steps ⇒ Operator restarted without clearing RTDB.
  let backwardTimestampPairs = 0
  for (let i = 1; i < chunks.length; i++) {
    const a = chunks[i - 1]!
    const b = chunks[i]!
    if (a.sequenceNumber > 0 && b.sequenceNumber > 0 && b.timestamp + 5_000 < a.timestamp) {
      backwardTimestampPairs += 1
    }
  }

  return {
    mode: 'sequential',
    gaps,
    minSeq: unique[0] ?? null,
    maxSeq: unique[unique.length - 1] ?? null,
    sequenceRestartSuspected: backwardTimestampPairs >= 20,
    backwardTimestampPairs,
  }
}

function coherenceNote(chunks: ChunkRow[]): string {
  if (chunks.length === 0) {
    return 'NO CHUNKS — transcript empty / never arrived / already cleaned from RTDB'
  }
  const finals = chunks.filter((c) => c.isFinalized && c.text.trim())
  const sample = (finals.length > 0 ? finals : chunks).map((c) => c.text.trim()).filter(Boolean)
  if (sample.length === 0) return 'Chunks present but all empty text — incomplete'

  const joined = sample.join(' ')
  const first = sample.slice(0, 3).join(' | ')
  const last = sample.slice(-3).join(' | ')
  const words = joined.split(/\s+/).filter(Boolean).length
  const hasTesting =
    /\btesting\b/i.test(sample.slice(0, 5).join(' ')) && sample.length < 40
  const short = words < 40 && chunks.length < 30

  if (short || hasTesting) {
    return `LIKELY INCOMPLETE / sound-check only — ~${words} words across ${chunks.length} chunks. First: "${first}". Last: "${last}".`
  }
  if (words >= 200) {
    return `READS AS SUBSTANTIVE / continuous (~${words} words, ${finals.length} finalized). First: "${first}". Last: "${last}".`
  }
  return `PARTIAL / short substantive content (~${words} words, ${finals.length} finalized). First: "${first}". Last: "${last}".`
}

async function probeRecallRecording(recordingId: string | null): Promise<string> {
  if (!recordingId) return 'recordingId absent — cannot probe Recall'
  const apiKey = process.env.RECALL_API_KEY?.trim()
  if (!apiKey) return `recordingId=${recordingId} but RECALL_API_KEY unset — skipped Recall probe`

  const region = process.env.RECALL_REGION?.trim() || 'us-west-2'
  const base =
    process.env.RECALL_API_BASE?.trim().replace(/\/$/, '') || `https://${region}.recall.ai`
  const url = `${base}/api/v1/recording/${encodeURIComponent(recordingId)}/`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return `Recall retrieve FAILED HTTP ${res.status} for ${recordingId}: ${JSON.stringify(json).slice(0, 240)}`
    }

    const status = json.status ?? null
    const shortcuts = (json.media_shortcuts ?? {}) as Record<string, any>
    const audio =
      shortcuts.audio_mixed?.data?.download_url ??
      shortcuts.audio_mixed_mp3?.data?.download_url ??
      null
    const audioStatus =
      shortcuts.audio_mixed?.status?.code ??
      shortcuts.audio_mixed_mp3?.status?.code ??
      null
    const startedAt = typeof json.started_at === 'string' ? json.started_at : null
    const completedAt = typeof json.completed_at === 'string' ? json.completed_at : null
    let durationNote = 'duration n/a'
    if (startedAt && completedAt) {
      const ms = Date.parse(completedAt) - Date.parse(startedAt)
      if (Number.isFinite(ms) && ms >= 0) durationNote = `duration≈${formatDuration(ms)}`
    }

    let sizeNote = 'file size n/a'
    if (typeof audio === 'string' && audio) {
      try {
        const head = await fetch(audio, { method: 'HEAD' })
        const len = head.headers.get('content-length')
        if (len) {
          const bytes = Number(len)
          sizeNote = Number.isFinite(bytes)
            ? `fileSize≈${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`
            : `content-length=${len}`
        } else {
          sizeNote = 'file size unknown (no content-length on HEAD)'
        }
      } catch {
        sizeNote = 'file size probe failed'
      }
    }

    const downloadable = Boolean(audio)
    return [
      `recordingId=${recordingId}`,
      `status=${JSON.stringify(status)}`,
      `audioArtifactStatus=${audioStatus ?? 'n/a'}`,
      durationNote,
      sizeNote,
      downloadable ? 'DOWNLOADABLE=yes (audio URL present)' : 'DOWNLOADABLE=no (no audio URL)',
    ].join(' | ')
  } catch (err) {
    return `Recall retrieve threw for ${recordingId}: ${err instanceof Error ? err.message : String(err)}`
  }
}

function writeCsv(sessionId: string, chunks: ChunkRow[]): string {
  const dir = join(process.cwd(), 'exports')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${sessionId}.csv`)
  const lines = ['sequenceNumber,timestamp,speakerLabel,text,isFinalized']
  for (const c of chunks) {
    lines.push(
      [
        String(c.sequenceNumber),
        csvEscape(formatTs(c.timestamp)),
        csvEscape(c.speakerLabel),
        csvEscape(c.text),
        c.isFinalized ? 'true' : 'false',
      ].join(','),
    )
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
  return path
}

function printSummary(opts: {
  sessionId: string
  meta: SessionMeta
  chunks: ChunkRow[]
  rtdbFeedState: unknown
  chunkSource: string
  gapInfo: ReturnType<typeof detectGaps>
  recallLine: string
  csvPath: string
}) {
  const { sessionId, meta, chunks, rtdbFeedState, chunkSource, gapInfo, recallLine, csvPath } =
    opts
  const first = chunks[0]
  const last = chunks[chunks.length - 1]
  const durationMs =
    first && last && first.timestamp > 0 && last.timestamp >= first.timestamp
      ? last.timestamp - first.timestamp
      : NaN

  console.log('\n' + '='.repeat(72))
  console.log(`SESSION ${sessionId}`)
  console.log(`  Show:     ${meta.showName ?? '?'} (${meta.showId ?? '?'})`)
  console.log(`  Title:    ${meta.title ?? '?'}`)
  console.log(`  Room:     ${meta.roomName ?? '?'} (${meta.roomId ?? '?'})`)
  console.log(`  FS feed:  ${meta.firestoreFeedState ?? '?'}`)
  console.log(`  RTDB feed:${JSON.stringify(rtdbFeedState)}`)
  console.log(`  Meta via: ${meta.source}`)
  console.log(`  Chunks via: ${chunkSource}`)
  console.log(`  CSV:      ${csvPath}`)
  console.log('-'.repeat(72))
  console.log(`  Chunk count:     ${chunks.length}`)
  console.log(`  First timestamp: ${first ? formatTs(first.timestamp) : 'n/a'}`)
  console.log(`  Last timestamp:  ${last ? formatTs(last.timestamp) : 'n/a'}`)
  console.log(`  Implied duration:${formatDuration(durationMs)}`)
  console.log(`  Finalized count: ${chunks.filter((c) => c.isFinalized).length}`)
  console.log(`  Partial count:   ${chunks.filter((c) => !c.isFinalized).length}`)

  if (gapInfo.mode === 'all_zero_or_absent') {
    console.log(
      '  Sequence gaps:   sequenceNumber is 0/absent for this session — cannot claim "no gaps"',
    )
  } else if (gapInfo.gaps.length === 0) {
    console.log(
      `  Sequence gaps:   none detected (seq ${gapInfo.minSeq}…${gapInfo.maxSeq}, contiguous unique values)`,
    )
  } else {
    console.log(
      `  Sequence gaps:   ${gapInfo.gaps.length} gap(s) in range ${gapInfo.minSeq}…${gapInfo.maxSeq}`,
    )
    for (const g of gapInfo.gaps.slice(0, 20)) {
      console.log(`    - after ${g.from} → ${g.to} (missing ${g.missing} number(s))`)
    }
    if (gapInfo.gaps.length > 20) {
      console.log(`    … ${gapInfo.gaps.length - 20} more gap(s) omitted`)
    }
  }
  if (gapInfo.sequenceRestartSuspected) {
    console.log(
      `  Seq restart?:    YES — ${gapInfo.backwardTimestampPairs} timestamp-backwards pairs when sorted by sequenceNumber (likely multiple Operator starts without clearing RTDB; unique-seq gap check is unreliable)`,
    )
  } else if (gapInfo.mode === 'sequential' && gapInfo.backwardTimestampPairs > 0) {
    console.log(
      `  Seq restart?:    mild — ${gapInfo.backwardTimestampPairs} small timestamp inversions`,
    )
  }

  console.log(`  Coherence:       ${coherenceNote(chunks)}`)
  console.log(`  Recall:          ${recallLine}`)
  console.log(`  uploadId:        ${meta.uploadId ?? '(not available)'}`)
  console.log(`  audioStoragePath:${meta.audioStoragePath ?? '(not available)'}`)
}

async function main() {
  console.log('[export-stuck-session-transcripts] READ-ONLY — no feedState / RTDB / Firestore writes')
  console.log(`[export] RTDB_ROOT=${RTDB_ROOT}`)
  console.log(`[export] PUBLIC_APP_ORIGIN=${PUBLIC_APP_ORIGIN}`)
  console.log(
    `[export] Admin creds: ${
      process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? 'present'
        : 'absent (public fallback)'
    }`,
  )
  console.log(`[export] RECALL_API_KEY: ${process.env.RECALL_API_KEY?.trim() ? 'present' : 'absent'}`)

  for (const sessionId of SESSION_IDS) {
    const publicMeta = await loadPublicSessionMeta(sessionId)
    const meta = await tryAdminEnrich(sessionId, publicMeta)
    const { chunks, rtdbFeedState, source: chunkSource } = await loadChunks(sessionId)
    const gapInfo = detectGaps(chunks)
    const csvPath = writeCsv(sessionId, chunks)
    const recallLine = await probeRecallRecording(meta.recordingId)
    printSummary({
      sessionId,
      meta,
      chunks,
      rtdbFeedState,
      chunkSource,
      gapInfo,
      recallLine,
      csvPath,
    })
  }

  console.log('\n[export] done — CSVs under exports/ (gitignored)')
}

main().catch((err) => {
  console.error('[export] fatal', err)
  process.exit(1)
})
