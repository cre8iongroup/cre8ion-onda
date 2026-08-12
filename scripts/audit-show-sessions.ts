/**
 * READ-ONLY full-show session diagnostic for ALF009 (ALPFA Convention 2026).
 *
 * For every session on the show:
 *   - Firestore SessionDoc (feedState, draft, schedule, room, title, recordingId)
 *   - RTDB liveSessions/{id} presence + chunk stats
 *   - Firestore transcripts/ migration presence
 *   - auditLog lifecycle events for the session
 * Flags stuck / migration-gap / captured-nothing / never-started.
 *
 * Does NOT write feedState, RTDB, Firestore, or call Recall.
 *
 * Loads `.env.local` automatically (same pattern as seed-alf009-sessions.ts).
 * Prefer Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * FIREBASE_SERVICE_ACCOUNT_JSON). Without Admin, falls back to public
 * show/session APIs + world-readable RTDB chunk/feedState paths — auditLog,
 * transcripts/, recordingId, and draft sessions will be UNAVAILABLE.
 *
 * Usage:
 *   npx tsx scripts/audit-show-sessions.ts
 *
 * Optional:
 *   SHOW_ID=cXWxHzN9MwgdsASqGvDO
 *   SHOW_SLUG=alpfa26
 *   SHOW_NAME="ALPFA Convention 2026"
 *   PUBLIC_APP_ORIGIN=https://cre8ion-onda.app
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { rtdbLiveSessionChunksPath, rtdbLiveSessionPath } from '../lib/rtdbPaths'

/** Canonical ALF009 show (ALPFA Convention 2026). */
const DEFAULT_SHOW_ID = 'cXWxHzN9MwgdsASqGvDO'
const DEFAULT_SHOW_SLUG = 'alpfa26'
const DEFAULT_SHOW_NAME = 'ALPFA Convention 2026'

const LIFECYCLE_ACTIONS = [
  'SESSION_SOUND_CHECK_STARTED',
  'SESSION_FEED_GO_LIVE',
  'SESSION_FEED_STOPPED',
  'SESSION_FEED_RESET',
] as const

type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number]

const RTDB_ROOT =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim().replace(/\/$/, '') ||
  'https://cre8ion-onda-default-rtdb.firebaseio.com'

const PUBLIC_APP_ORIGIN =
  process.env.ONDA_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
  'https://cre8ion-onda.app'

type AuditEvent = {
  action: string
  performedAtMs: number | null
  performedBy: string | null
}

type SessionRow = {
  sessionId: string
  showId: string
  title: string
  roomId: string
  roomName: string
  feedState: string
  isDraft: string
  scheduledStartIso: string
  scheduledEndIso: string
  recordingId: string
  rtdbExists: string
  rtdbFeedState: string
  rtdbChunkCount: number | string
  rtdbFinalizedCount: number | string
  rtdbFinalizedRatio: string
  rtdbFirstTs: string
  rtdbLastTs: string
  transcriptChunkCount: number | string
  transcriptWordCount: number | string
  auditEventCount: number | string
  auditTimeline: string
  status: string
  notes: string
  dataSource: string
}

function hasAdminCreds(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim(),
  )
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatTs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toISOString()
}

function timestampToMs(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && value !== null) {
    const v = value as { toMillis?: () => number; _seconds?: number; seconds?: number }
    if (typeof v.toMillis === 'function') return v.toMillis()
    if (typeof v._seconds === 'number') return v._seconds * 1000
    if (typeof v.seconds === 'number') return v.seconds * 1000
  }
  return null
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!, i)
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

async function publicGetJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.json()
}

async function publicRtdbGet(path: string): Promise<unknown> {
  const normalized = path.replace(/^\/+|\/+$/g, '')
  const res = await fetch(`${RTDB_ROOT}/${normalized}.json`)
  if (!res.ok) throw new Error(`RTDB GET ${normalized} → ${res.status}`)
  return res.json()
}

type LoadedShow = {
  showId: string
  showName: string
  rooms: Map<string, string>
  source: string
}

type LoadedSession = {
  sessionId: string
  showId: string
  title: string
  roomId: string
  feedState: string
  isDraft: boolean | null
  scheduledStartMs: number | null
  scheduledEndMs: number | null
  recordingId: string | null
  source: string
}

async function loadShowAndSessionsAdmin(): Promise<{
  show: LoadedShow
  sessions: LoadedSession[]
}> {
  const { getAdminFirestore } = await import('../lib/firebase/admin')
  const fs = getAdminFirestore()

  const showIdEnv = process.env.SHOW_ID?.trim()
  const showSlug = (process.env.SHOW_SLUG?.trim() || DEFAULT_SHOW_SLUG).toLowerCase()
  const showName = process.env.SHOW_NAME?.trim() || DEFAULT_SHOW_NAME

  let showSnap
  let showId: string

  if (showIdEnv) {
    showSnap = await fs.doc(`shows/${showIdEnv}`).get()
    if (!showSnap.exists) throw new Error(`SHOW_ID not found: ${showIdEnv}`)
    showId = showSnap.id
  } else {
    // Prefer known ALF009 id, then name / portal slug scan.
    const known = await fs.doc(`shows/${DEFAULT_SHOW_ID}`).get()
    if (known.exists) {
      showSnap = known
      showId = known.id
    } else {
      const all = await fs.collection('shows').get()
      const match = all.docs.find((d) => {
        const data = d.data() as {
          name?: string
          branding?: { portalURL?: string }
        }
        if ((data.name || '').trim() === showName) return true
        if ((data.branding?.portalURL || '').trim().toLowerCase() === showSlug) return true
        return false
      })
      if (!match) {
        throw new Error(
          `Could not resolve ALF009 show (tried id=${DEFAULT_SHOW_ID}, name=${showName}, slug=${showSlug})`,
        )
      }
      showSnap = match
      showId = match.id
    }
  }

  const showData = showSnap.data() as {
    name?: string
    rooms?: Array<{ id: string; name: string }>
  }
  const rooms = new Map<string, string>()
  for (const r of showData.rooms ?? []) {
    if (r?.id) rooms.set(r.id, r.name || r.id)
  }

  const sessSnap = await fs
    .collection(`shows/${showId}/sessions`)
    .orderBy('scheduledStart', 'asc')
    .get()

  const sessions: LoadedSession[] = sessSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    return {
      sessionId: doc.id,
      showId,
      title: typeof data.title === 'string' ? data.title : doc.id,
      roomId: typeof data.roomId === 'string' ? data.roomId : '',
      feedState: typeof data.feedState === 'string' ? data.feedState : 'unknown',
      isDraft: data.isDraft === true,
      scheduledStartMs: timestampToMs(data.scheduledStart),
      scheduledEndMs: timestampToMs(data.scheduledEnd),
      recordingId: typeof data.recordingId === 'string' ? data.recordingId : null,
      source: 'Admin Firestore',
    }
  })

  return {
    show: {
      showId,
      showName: showData.name || showName,
      rooms,
      source: 'Admin Firestore',
    },
    sessions,
  }
}

async function loadShowAndSessionsPublic(): Promise<{
  show: LoadedShow
  sessions: LoadedSession[]
}> {
  const slug = process.env.SHOW_SLUG?.trim() || DEFAULT_SHOW_SLUG
  const url = `${PUBLIC_APP_ORIGIN}/api/public/shows/${encodeURIComponent(slug)}/sessions`
  const body = (await publicGetJson(url)) as {
    show?: {
      id?: string
      name?: string
      rooms?: Array<{ id: string; name: string }>
    }
    sessions?: Array<{
      id: string
      showId: string
      roomId: string
      title: string
      feedState: string
      scheduledStartMs: number
      scheduledEndMs: number
    }>
  }
  const showId = body.show?.id || process.env.SHOW_ID?.trim() || DEFAULT_SHOW_ID
  const rooms = new Map<string, string>()
  for (const r of body.show?.rooms ?? []) {
    if (r?.id) rooms.set(r.id, r.name || r.id)
  }
  const sessions: LoadedSession[] = (body.sessions ?? []).map((s) => ({
    sessionId: s.id,
    showId: s.showId || showId,
    title: s.title,
    roomId: s.roomId,
    feedState: s.feedState,
    isDraft: null, // public API excludes drafts
    scheduledStartMs: s.scheduledStartMs,
    scheduledEndMs: s.scheduledEndMs,
    recordingId: null,
    source: `GET ${url}`,
  }))
  return {
    show: {
      showId,
      showName: body.show?.name || DEFAULT_SHOW_NAME,
      rooms,
      source: `GET ${url}`,
    },
    sessions,
  }
}

async function loadRtdbStats(sessionId: string): Promise<{
  exists: boolean | null
  feedState: string
  chunkCount: number | null
  finalizedCount: number | null
  firstTs: number | null
  lastTs: number | null
  note: string
}> {
  // feedState + chunks are world-readable; parent node is not.
  try {
    const feedState = await publicRtdbGet(`${rtdbLiveSessionPath(sessionId)}/feedState`)

    const shallowRes = await fetch(
      `${RTDB_ROOT}/${rtdbLiveSessionChunksPath(sessionId)}.json?shallow=true`,
    )
    if (!shallowRes.ok) {
      throw new Error(`RTDB shallow chunks → ${shallowRes.status}`)
    }
    const chunkIds = (await shallowRes.json()) as Record<string, boolean> | null
    const chunkCount = chunkIds && typeof chunkIds === 'object' ? Object.keys(chunkIds).length : 0
    const nodePresent = feedState != null || chunkCount > 0

    let finalizedCount: number | null = null
    let firstTs: number | null = null
    let lastTs: number | null = null

    if (chunkCount > 0) {
      const raw = (await publicRtdbGet(rtdbLiveSessionChunksPath(sessionId))) as Record<
        string,
        { timestamp?: number; isFinalized?: boolean }
      > | null
      if (raw && typeof raw === 'object') {
        let fin = 0
        for (const v of Object.values(raw)) {
          if (!v || typeof v !== 'object') continue
          if (v.isFinalized) fin += 1
          const ts = typeof v.timestamp === 'number' ? v.timestamp : null
          if (ts != null) {
            if (firstTs == null || ts < firstTs) firstTs = ts
            if (lastTs == null || ts > lastTs) lastTs = ts
          }
        }
        finalizedCount = fin
      }
    } else {
      finalizedCount = 0
    }

    return {
      exists: nodePresent,
      feedState: feedState == null ? '' : String(feedState).replace(/^"|"$/g, ''),
      chunkCount,
      finalizedCount,
      firstTs,
      lastTs,
      note: 'public RTDB',
    }
  } catch (err) {
    return {
      exists: null,
      feedState: '',
      chunkCount: null,
      finalizedCount: null,
      firstTs: null,
      lastTs: null,
      note: `RTDB read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function loadTranscriptsAdmin(
  showId: string,
  sessionId: string,
): Promise<{ chunkCount: number; wordCount: number } | null> {
  const { getAdminFirestore } = await import('../lib/firebase/admin')
  const snap = await getAdminFirestore()
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .select('text')
    .get()
  let wordCount = 0
  for (const doc of snap.docs) {
    const text = (doc.data() as { text?: string }).text
    if (typeof text === 'string' && text.trim()) {
      wordCount += text.trim().split(/\s+/).filter(Boolean).length
    }
  }
  return { chunkCount: snap.size, wordCount }
}

async function loadAuditAdmin(sessionId: string): Promise<AuditEvent[]> {
  const { getAdminFirestore } = await import('../lib/firebase/admin')
  const snap = await getAdminFirestore()
    .collection('auditLog')
    .where('sessionId', '==', sessionId)
    .get()

  const events: AuditEvent[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as {
      action?: string
      performedAt?: unknown
      performedBy?: string
    }
    const action = typeof data.action === 'string' ? data.action : ''
    if (!LIFECYCLE_ACTIONS.includes(action as LifecycleAction)) continue
    events.push({
      action,
      performedAtMs: timestampToMs(data.performedAt),
      performedBy: typeof data.performedBy === 'string' ? data.performedBy : null,
    })
  }
  events.sort((a, b) => (a.performedAtMs ?? 0) - (b.performedAtMs ?? 0))
  return events
}

function classify(opts: {
  feedState: string
  scheduledEndMs: number | null
  nowMs: number
  rtdbChunkCount: number | null
  transcriptChunkCount: number | null
  audit: AuditEvent[] | null
  adminMode: boolean
}): { status: string; notes: string } {
  const { feedState, scheduledEndMs, nowMs, rtdbChunkCount, transcriptChunkCount, audit, adminMode } =
    opts
  const notes: string[] = []
  const wentLive =
    audit != null &&
    audit.some(
      (e) =>
        e.action === 'SESSION_SOUND_CHECK_STARTED' ||
        e.action === 'SESSION_FEED_GO_LIVE' ||
        e.action === 'SESSION_FEED_STOPPED',
    )
  const rtdbChunks = rtdbChunkCount ?? 0
  const migrated = transcriptChunkCount ?? 0

  if (feedState !== 'standby' && feedState !== 'ended') {
    return {
      status: `STUCK - ${feedState}`,
      notes: [
        `Non-terminal feedState=${feedState}`,
        rtdbChunks > 0 ? `RTDB chunks=${rtdbChunks}` : 'RTDB chunks=0',
      ].join('; '),
    }
  }

  if (feedState === 'ended') {
    if (adminMode) {
      if (migrated === 0) {
        return {
          status: 'MIGRATION GAP',
          notes: 'feedState=ended but transcripts/ subcollection empty or missing',
        }
      }
      return {
        status: 'OK - ended & migrated',
        notes: `transcripts=${migrated}`,
      }
    }
    notes.push('transcripts/ unverified (no Admin)')
    return {
      status: 'ENDED - migration unverified',
      notes: notes.join('; '),
    }
  }

  // standby
  if (adminMode && wentLive && rtdbChunks === 0 && migrated === 0) {
    return {
      status: 'CAPTURED NOTHING',
      notes: `Lifecycle audit present but zero RTDB chunks and zero migrated transcripts`,
    }
  }

  if (feedState === 'standby' && rtdbChunks > 0) {
    return {
      status: 'RTDB ORPHAN - standby with live node',
      notes: `feedState=standby but RTDB still has ${rtdbChunks} chunk(s) — reset/end cleanup may have missed RTDB`,
    }
  }

  const past = scheduledEndMs != null && scheduledEndMs < nowMs
  if (past && feedState === 'standby') {
    if (adminMode) {
      const noAudit = !audit || audit.length === 0
      if (noAudit && rtdbChunks === 0 && migrated === 0) {
        return {
          status: 'NEVER STARTED',
          notes: 'scheduledEnd passed; standby; no lifecycle audit; no RTDB/transcripts',
        }
      }
      if (wentLive && rtdbChunks === 0 && migrated === 0) {
        return {
          status: 'CAPTURED NOTHING',
          notes: 'went live per audit but no capture artifacts remain',
        }
      }
      return {
        status: 'OK - standby',
        notes: [
          audit && audit.length ? `audit=${audit.length}` : 'no lifecycle audit',
          migrated ? `transcripts=${migrated}` : null,
        ]
          .filter(Boolean)
          .join('; '),
      }
    }
    // public fallback — cannot confirm audit trail
    if (rtdbChunks === 0) {
      return {
        status: 'NEVER STARTED (unverified)',
        notes:
          'past schedule + standby + no RTDB; auditLog not readable without Admin — may also be reset',
      }
    }
  }

  if (feedState === 'standby') {
    return {
      status: 'OK - standby',
      notes: adminMode
        ? audit && audit.length
          ? `audit=${audit.length}`
          : 'no lifecycle audit'
        : 'public data only',
    }
  }

  return { status: `UNKNOWN - ${feedState}`, notes: notes.join('; ') || '' }
}

function writeCsv(rows: SessionRow[], path: string) {
  const headers: (keyof SessionRow)[] = [
    'sessionId',
    'showId',
    'title',
    'roomId',
    'roomName',
    'feedState',
    'isDraft',
    'scheduledStartIso',
    'scheduledEndIso',
    'recordingId',
    'rtdbExists',
    'rtdbFeedState',
    'rtdbChunkCount',
    'rtdbFinalizedCount',
    'rtdbFinalizedRatio',
    'rtdbFirstTs',
    'rtdbLastTs',
    'transcriptChunkCount',
    'transcriptWordCount',
    'auditEventCount',
    'auditTimeline',
    'status',
    'notes',
    'dataSource',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(String(row[h] ?? ''))).join(','))
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

function printTable(rows: SessionRow[]) {
  const cols = [
    'status',
    'feedState',
    'roomName',
    'title',
    'rtdbChunkCount',
    'transcriptChunkCount',
    'auditEventCount',
    'sessionId',
  ] as const
  const widths = Object.fromEntries(
    cols.map((c) => [
      c,
      Math.min(44, Math.max(String(c).length, ...rows.map((r) => String(r[c] ?? '').length))),
    ]),
  ) as Record<(typeof cols)[number], number>

  const pad = (c: (typeof cols)[number], v: string) => {
    const w = widths[c]
    return v.length > w ? `${v.slice(0, Math.max(0, w - 1))}…` : v.padEnd(w)
  }

  console.log('\n' + cols.map((c) => pad(c, c)).join(' | '))
  console.log(cols.map((c) => '-'.repeat(widths[c])).join('-+-'))
  for (const row of rows) {
    console.log(cols.map((c) => pad(c, String(row[c] ?? ''))).join(' | '))
  }
}

function statusCounts(rows: SessionRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    out[r.status] = (out[r.status] ?? 0) + 1
  }
  return out
}

async function auditOne(
  session: LoadedSession,
  show: LoadedShow,
  adminMode: boolean,
  nowMs: number,
): Promise<SessionRow> {
  const rtdb = await loadRtdbStats(session.sessionId)

  let transcriptChunkCount: number | string = 'UNAVAILABLE'
  let transcriptWordCount: number | string = 'UNAVAILABLE'
  let audit: AuditEvent[] | null = null
  let auditEventCount: number | string = 'UNAVAILABLE'
  let auditTimeline = 'UNAVAILABLE'
  let recordingId = session.recordingId ?? ''

  if (adminMode) {
    try {
      const t = await loadTranscriptsAdmin(session.showId, session.sessionId)
      transcriptChunkCount = t?.chunkCount ?? 0
      transcriptWordCount = t?.wordCount ?? 0
    } catch (err) {
      transcriptChunkCount = 'ERROR'
      transcriptWordCount = 'ERROR'
      console.warn(
        `[audit] transcripts failed ${session.sessionId}:`,
        err instanceof Error ? err.message : err,
      )
    }
    try {
      audit = await loadAuditAdmin(session.sessionId)
      auditEventCount = audit.length
      auditTimeline = audit
        .map((e) => `${e.action}@${formatTs(e.performedAtMs) || '?'}`)
        .join(' > ')
    } catch (err) {
      auditEventCount = 'ERROR'
      auditTimeline = `ERROR: ${err instanceof Error ? err.message : String(err)}`
      console.warn(
        `[audit] auditLog failed ${session.sessionId}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  const { status, notes } = classify({
    feedState: session.feedState,
    scheduledEndMs: session.scheduledEndMs,
    nowMs,
    rtdbChunkCount: rtdb.chunkCount,
    transcriptChunkCount: typeof transcriptChunkCount === 'number' ? transcriptChunkCount : null,
    audit,
    adminMode,
  })

  const finalizedRatio =
    rtdb.chunkCount != null &&
    rtdb.chunkCount > 0 &&
    rtdb.finalizedCount != null
      ? `${((rtdb.finalizedCount / rtdb.chunkCount) * 100).toFixed(1)}%`
      : rtdb.chunkCount === 0
        ? 'n/a'
        : 'UNAVAILABLE'

  return {
    sessionId: session.sessionId,
    showId: session.showId,
    title: session.title,
    roomId: session.roomId,
    roomName: show.rooms.get(session.roomId) || session.roomId || '',
    feedState: session.feedState,
    isDraft: session.isDraft == null ? 'UNAVAILABLE' : session.isDraft ? 'true' : 'false',
    scheduledStartIso: formatTs(session.scheduledStartMs),
    scheduledEndIso: formatTs(session.scheduledEndMs),
    recordingId: recordingId || (adminMode ? '' : 'UNAVAILABLE'),
    rtdbExists: rtdb.exists == null ? 'UNAVAILABLE' : rtdb.exists ? 'true' : 'false',
    rtdbFeedState: rtdb.feedState,
    rtdbChunkCount: rtdb.chunkCount ?? 'UNAVAILABLE',
    rtdbFinalizedCount: rtdb.finalizedCount ?? 'UNAVAILABLE',
    rtdbFinalizedRatio: finalizedRatio,
    rtdbFirstTs: formatTs(rtdb.firstTs),
    rtdbLastTs: formatTs(rtdb.lastTs),
    transcriptChunkCount,
    transcriptWordCount,
    auditEventCount,
    auditTimeline,
    status,
    notes: [notes, rtdb.note !== 'public RTDB' ? rtdb.note : null].filter(Boolean).join('; '),
    dataSource: `${session.source} + ${rtdb.note}${adminMode ? ' + Admin audit/transcripts' : ''}`,
  }
}

async function main() {
  const adminMode = hasAdminCreds()
  console.log('[audit-show-sessions] READ-ONLY — no writes')
  console.log(`[audit] RTDB_ROOT=${RTDB_ROOT}`)
  console.log(`[audit] PUBLIC_APP_ORIGIN=${PUBLIC_APP_ORIGIN}`)
  console.log(`[audit] Admin creds: ${adminMode ? 'present' : 'absent (public fallback)'}`)
  console.log('[audit] Recall API: not queried (by design for this script)')

  const loaded = adminMode
    ? await loadShowAndSessionsAdmin()
    : await loadShowAndSessionsPublic()

  console.log(
    `[audit] show=${loaded.show.showName} (${loaded.show.showId}) via ${loaded.show.source}`,
  )
  console.log(`[audit] sessions=${loaded.sessions.length}${adminMode ? '' : ' (non-draft public only)'}`)

  const nowMs = Date.now()
  const rows = await mapPool(loaded.sessions, 8, (session) =>
    auditOne(session, loaded.show, adminMode, nowMs),
  )

  // Stable schedule order already from loader; keep it.
  const outDir = join(process.cwd(), 'exports')
  mkdirSync(outDir, { recursive: true })
  const csvPath = join(outDir, `alf009-session-audit-${new Date().toISOString().slice(0, 10)}.csv`)
  writeCsv(rows, csvPath)

  printTable(rows)

  console.log('\n[audit] status counts:')
  for (const [k, v] of Object.entries(statusCounts(rows)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}\t${k}`)
  }
  console.log(`\n[audit] CSV: ${csvPath}`)
  if (!adminMode) {
    console.log(
      '[audit] NOTE: Without Admin credentials, auditLog + transcripts/ + recordingId + draft sessions are UNAVAILABLE. Re-run with .env.local Admin SA for full flags (MIGRATION GAP / CAPTURED NOTHING / verified NEVER STARTED).',
    )
  }
}

main().catch((err) => {
  console.error('[audit] fatal', err)
  process.exit(1)
})

