/**
 * READ-ONLY full-show session diagnostic for ALF009 (ALPFA Convention 2026).
 *
 * For every session on the show:
 *   - Firestore SessionDoc (feedState, draft, schedule, room, title, recordingId)
 *   - RTDB liveSessions/{id} presence + chunk stats + word count
 *   - Firestore transcripts/ migration presence + word count
 *   - auditLog lifecycle events for the session
 *   - captured duration vs scheduled window
 * Flags stuck / migration-gap / captured-nothing / never-started / upcoming.
 *
 * Does NOT write feedState, RTDB, Firestore, or call Recall.
 *
 * Auth (in order):
 *   1. GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON
 *   2. Ephemeral ADC bridged from Firebase CLI login
 *      (~/.config/configstore/firebase-tools.json → /tmp/onda-firebase-adc.json)
 *   3. Else public API + world-readable RTDB fallback
 *
 * Usage:
 *   npx tsx scripts/audit-show-sessions.ts
 *
 * Optional:
 *   SHOW_ID=cXWxHzN9MwgdsASqGvDO
 *   SHOW_SLUG=alpfa26
 *   SHOW_NAME="ALPFA Convention 2026"
 *   PUBLIC_APP_ORIGIN=https://cre8ion-onda.app
 *   SHORT_CAPTURE_RATIO=0.5   (flag if captured < this × scheduled duration)
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { rtdbLiveSessionChunksPath, rtdbLiveSessionPath } from '../lib/rtdbPaths'

/** Canonical ALF009 show (ALPFA Convention 2026). */
const DEFAULT_SHOW_ID = 'cXWxHzN9MwgdsASqGvDO'
const DEFAULT_SHOW_SLUG = 'alpfa26'
const DEFAULT_SHOW_NAME = 'ALPFA Convention 2026'

/** Public OAuth client embedded in firebase-tools (used only to mint ADC from CLI login). */
const FIREBASE_TOOLS_OAUTH = {
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'jEQPZQZptRWOsDadboIJe1vIv84',
}

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

const SHORT_CAPTURE_RATIO = Number(process.env.SHORT_CAPTURE_RATIO ?? '0.5')
const EPHEMERAL_ADC_PATH = '/tmp/onda-firebase-adc.json'

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
  scheduledDurationMin: string
  recordingId: string
  rtdbExists: string
  rtdbFeedState: string
  rtdbChunkCount: number | string
  rtdbFinalizedCount: number | string
  rtdbFinalizedRatio: string
  rtdbFirstTs: string
  rtdbLastTs: string
  capturedDurationMin: string
  durationFlag: string
  transcriptChunkCount: number | string
  wordCount: number | string
  wordCountSource: string
  auditEventCount: number | string
  auditTimeline: string
  status: string
  notes: string
  dataSource: string
}

/**
 * Bridge Firebase CLI user login → ephemeral authorized_user ADC for Admin SDK.
 * Writes ONLY under /tmp (outside the repo). Returns true if ADC is usable.
 */
function bridgeFirebaseCliToAdc(): { ok: boolean; detail: string } {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    return { ok: true, detail: `existing GOOGLE_APPLICATION_CREDENTIALS` }
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    return { ok: true, detail: 'FIREBASE_SERVICE_ACCOUNT_JSON set' }
  }

  const toolsPath = join(homedir(), '.config/configstore/firebase-tools.json')
  if (!existsSync(toolsPath)) {
    return { ok: false, detail: 'firebase-tools.json missing — run firebase login --no-localhost' }
  }

  let refreshToken: string | null = null
  let email: string | null = null
  try {
    const raw = JSON.parse(readFileSync(toolsPath, 'utf8')) as {
      tokens?: { refresh_token?: string }
      user?: { email?: string } | string
    }
    refreshToken =
      typeof raw.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null
    email =
      typeof raw.user === 'string'
        ? raw.user
        : typeof raw.user?.email === 'string'
          ? raw.user.email
          : null
  } catch {
    return { ok: false, detail: 'firebase-tools.json unreadable' }
  }

  if (!refreshToken) {
    return { ok: false, detail: 'firebase-tools.json has no refresh_token — login incomplete' }
  }

  const adc = {
    type: 'authorized_user',
    client_id: FIREBASE_TOOLS_OAUTH.client_id,
    client_secret: FIREBASE_TOOLS_OAUTH.client_secret,
    refresh_token: refreshToken,
  }
  writeFileSync(EPHEMERAL_ADC_PATH, JSON.stringify(adc), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = EPHEMERAL_ADC_PATH

  // Ensure project targeting for Admin init guard.
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) {
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'cre8ion-onda'
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim()) {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL =
      'https://cre8ion-onda-default-rtdb.firebaseio.com'
  }

  return {
    ok: true,
    detail: `bridged Firebase CLI login → ${EPHEMERAL_ADC_PATH}${email ? ` (${email})` : ''}`,
  }
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

function formatDurationMin(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  return (ms / 60000).toFixed(1)
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

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
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
  const { getAdminFirestore, REQUIRED_FIREBASE_PROJECT_ID } = await import(
    '../lib/firebase/admin'
  )
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  if (projectId && projectId !== REQUIRED_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Refusing wrong Firebase project ${projectId} (required ${REQUIRED_FIREBASE_PROJECT_ID})`,
    )
  }

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
    isDraft: null,
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
  wordCount: number | null
  note: string
}> {
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
    let wordCount: number | null = null

    if (chunkCount > 0) {
      const raw = (await publicRtdbGet(rtdbLiveSessionChunksPath(sessionId))) as Record<
        string,
        { timestamp?: number; isFinalized?: boolean; text?: string }
      > | null
      if (raw && typeof raw === 'object') {
        let fin = 0
        let words = 0
        for (const v of Object.values(raw)) {
          if (!v || typeof v !== 'object') continue
          const ts = typeof v.timestamp === 'number' ? v.timestamp : null
          if (ts != null) {
            if (firstTs == null || ts < firstTs) firstTs = ts
            if (lastTs == null || ts > lastTs) lastTs = ts
          }
          // Prefer finalized text to avoid partial-utterance inflation.
          if (v.isFinalized) {
            fin += 1
            if (typeof v.text === 'string') words += countWords(v.text)
          }
        }
        finalizedCount = fin
        wordCount = words
      }
    } else {
      finalizedCount = 0
      wordCount = 0
    }

    return {
      exists: nodePresent,
      feedState: feedState == null ? '' : String(feedState).replace(/^"|"$/g, ''),
      chunkCount,
      finalizedCount,
      firstTs,
      lastTs,
      wordCount,
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
      wordCount: null,
      note: `RTDB read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function loadTranscriptsAdmin(
  showId: string,
  sessionId: string,
): Promise<{
  chunkCount: number
  wordCount: number
  firstTs: number | null
  lastTs: number | null
}> {
  const { getAdminFirestore } = await import('../lib/firebase/admin')
  const snap = await getAdminFirestore()
    .collection(`shows/${showId}/sessions/${sessionId}/transcripts`)
    .select('text', 'timestamp')
    .get()
  let wordCount = 0
  let firstTs: number | null = null
  let lastTs: number | null = null
  for (const doc of snap.docs) {
    const data = doc.data() as { text?: string; timestamp?: unknown }
    if (typeof data.text === 'string') wordCount += countWords(data.text)
    const ts = timestampToMs(data.timestamp)
    if (ts != null) {
      if (firstTs == null || ts < firstTs) firstTs = ts
      if (lastTs == null || ts > lastTs) lastTs = ts
    }
  }
  return { chunkCount: snap.size, wordCount, firstTs, lastTs }
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
  scheduledStartMs: number | null
  scheduledEndMs: number | null
  nowMs: number
  rtdbChunkCount: number | null
  transcriptChunkCount: number | null
  capturedDurationMs: number | null
  scheduledDurationMs: number | null
  audit: AuditEvent[] | null
  adminMode: boolean
}): { status: string; notes: string; durationFlag: string } {
  const {
    feedState,
    scheduledStartMs,
    scheduledEndMs,
    nowMs,
    rtdbChunkCount,
    transcriptChunkCount,
    capturedDurationMs,
    scheduledDurationMs,
    audit,
    adminMode,
  } = opts

  const rtdbChunks = rtdbChunkCount ?? 0
  const migrated = transcriptChunkCount ?? 0
  const wentLive =
    audit != null &&
    audit.some(
      (e) =>
        e.action === 'SESSION_SOUND_CHECK_STARTED' ||
        e.action === 'SESSION_FEED_GO_LIVE' ||
        e.action === 'SESSION_FEED_STOPPED',
    )

  let durationFlag = ''
  if (
    capturedDurationMs != null &&
    scheduledDurationMs != null &&
    scheduledDurationMs > 0 &&
    Number.isFinite(SHORT_CAPTURE_RATIO) &&
    SHORT_CAPTURE_RATIO > 0 &&
    capturedDurationMs < scheduledDurationMs * SHORT_CAPTURE_RATIO
  ) {
    durationFlag = `SHORT_CAPTURE (<${Math.round(SHORT_CAPTURE_RATIO * 100)}% of scheduled)`
  }

  // Upcoming takes priority over NEVER STARTED / standby-OK for future sessions.
  if (scheduledStartMs != null && scheduledStartMs > nowMs) {
    if (feedState === 'standby' || feedState === 'ended') {
      return {
        status: 'UPCOMING - not yet started',
        notes: `scheduledStart in future (${formatTs(scheduledStartMs)})`,
        durationFlag,
      }
    }
    // Future-dated but already non-terminal — still flag stuck.
  }

  if (feedState !== 'standby' && feedState !== 'ended') {
    return {
      status: `STUCK - ${feedState}`,
      notes: [
        `Non-terminal feedState=${feedState}`,
        rtdbChunks > 0 ? `RTDB chunks=${rtdbChunks}` : 'RTDB chunks=0',
      ].join('; '),
      durationFlag,
    }
  }

  if (feedState === 'ended') {
    if (adminMode) {
      if (migrated === 0) {
        return {
          status: 'MIGRATION GAP',
          notes: 'feedState=ended but transcripts/ subcollection empty or missing',
          durationFlag,
        }
      }
      return {
        status: 'OK - ended & migrated',
        notes: `transcripts=${migrated}`,
        durationFlag,
      }
    }
    return {
      status: 'ENDED - migration unverified',
      notes: 'transcripts/ unverified (no Admin)',
      durationFlag,
    }
  }

  // standby
  if (adminMode && wentLive && rtdbChunks === 0 && migrated === 0) {
    return {
      status: 'CAPTURED NOTHING',
      notes: 'Lifecycle audit present but zero RTDB chunks and zero migrated transcripts',
      durationFlag,
    }
  }

  if (feedState === 'standby' && rtdbChunks > 0) {
    return {
      status: 'RTDB ORPHAN - standby with live node',
      notes: `feedState=standby but RTDB still has ${rtdbChunks} chunk(s) — reset/end cleanup may have missed RTDB`,
      durationFlag,
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
          durationFlag,
        }
      }
      if (wentLive && rtdbChunks === 0 && migrated === 0) {
        return {
          status: 'CAPTURED NOTHING',
          notes: 'went live per audit but no capture artifacts remain',
          durationFlag,
        }
      }
      const resetOnly =
        audit &&
        audit.length > 0 &&
        audit.every((e) => e.action === 'SESSION_FEED_RESET')
      return {
        status: 'OK - standby',
        notes: [
          audit && audit.length ? `audit=${audit.length}` : 'no lifecycle audit',
          resetOnly ? 'audit is reset-only' : null,
          migrated ? `transcripts=${migrated}` : null,
        ]
          .filter(Boolean)
          .join('; '),
        durationFlag,
      }
    }
    if (rtdbChunks === 0) {
      return {
        status: 'NEVER STARTED (unverified)',
        notes:
          'past schedule + standby + no RTDB; auditLog not readable without Admin — may also be reset',
        durationFlag,
      }
    }
  }

  return {
    status: 'OK - standby',
    notes: adminMode
      ? audit && audit.length
        ? `audit=${audit.length}`
        : 'no lifecycle audit'
      : 'public data only',
    durationFlag,
  }
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
    'scheduledDurationMin',
    'recordingId',
    'rtdbExists',
    'rtdbFeedState',
    'rtdbChunkCount',
    'rtdbFinalizedCount',
    'rtdbFinalizedRatio',
    'rtdbFirstTs',
    'rtdbLastTs',
    'capturedDurationMin',
    'durationFlag',
    'transcriptChunkCount',
    'wordCount',
    'wordCountSource',
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
    'wordCount',
    'capturedDurationMin',
    'transcriptChunkCount',
    'auditEventCount',
    'sessionId',
  ] as const
  const widths = Object.fromEntries(
    cols.map((c) => [
      c,
      Math.min(40, Math.max(String(c).length, ...rows.map((r) => String(r[c] ?? '').length))),
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
  let wordCount: number | string = rtdb.wordCount ?? 'UNAVAILABLE'
  let wordCountSource =
    rtdb.wordCount != null && rtdb.chunkCount && rtdb.chunkCount > 0
      ? 'RTDB finalized'
      : rtdb.chunkCount === 0
        ? 'none'
        : 'UNAVAILABLE'
  let audit: AuditEvent[] | null = null
  let auditEventCount: number | string = 'UNAVAILABLE'
  let auditTimeline = 'UNAVAILABLE'
  const recordingId = session.recordingId ?? ''
  let transcriptFirstTs: number | null = null
  let transcriptLastTs: number | null = null

  if (adminMode) {
    try {
      const t = await loadTranscriptsAdmin(session.showId, session.sessionId)
      transcriptChunkCount = t.chunkCount
      transcriptFirstTs = t.firstTs
      transcriptLastTs = t.lastTs
      // Prefer migrated transcript words when present; else keep RTDB words.
      if (t.chunkCount > 0) {
        wordCount = t.wordCount
        wordCountSource = 'Firestore transcripts/'
      } else if (rtdb.wordCount != null && (rtdb.chunkCount ?? 0) > 0) {
        wordCount = rtdb.wordCount
        wordCountSource = 'RTDB finalized'
      } else {
        wordCount = 0
        wordCountSource = 'none'
      }
    } catch (err) {
      transcriptChunkCount = 'ERROR'
      console.warn(
        `[audit] transcripts failed ${session.sessionId}:`,
        err instanceof Error ? err.message : err,
      )
    }
    try {
      audit = await loadAuditAdmin(session.sessionId)
      auditEventCount = audit.length
      auditTimeline = audit
        .map(
          (e) =>
            `${e.action}@${formatTs(e.performedAtMs) || '?'}${
              e.performedBy ? `(${e.performedBy})` : ''
            }`,
        )
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

  const scheduledDurationMs =
    session.scheduledStartMs != null &&
    session.scheduledEndMs != null &&
    session.scheduledEndMs >= session.scheduledStartMs
      ? session.scheduledEndMs - session.scheduledStartMs
      : null

  // Captured duration: RTDB window if live node present; else migrated transcript timestamps.
  let capturedDurationMs: number | null = null
  if (
    rtdb.firstTs != null &&
    rtdb.lastTs != null &&
    rtdb.lastTs >= rtdb.firstTs &&
    (rtdb.chunkCount ?? 0) > 0
  ) {
    capturedDurationMs = rtdb.lastTs - rtdb.firstTs
  } else if (
    transcriptFirstTs != null &&
    transcriptLastTs != null &&
    transcriptLastTs >= transcriptFirstTs
  ) {
    capturedDurationMs = transcriptLastTs - transcriptFirstTs
  }
  const { status, notes, durationFlag } = classify({
    feedState: session.feedState,
    scheduledStartMs: session.scheduledStartMs,
    scheduledEndMs: session.scheduledEndMs,
    nowMs,
    rtdbChunkCount: rtdb.chunkCount,
    transcriptChunkCount: typeof transcriptChunkCount === 'number' ? transcriptChunkCount : null,
    capturedDurationMs,
    scheduledDurationMs,
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
    scheduledDurationMin: formatDurationMin(scheduledDurationMs),
    recordingId: recordingId || (adminMode ? '' : 'UNAVAILABLE'),
    rtdbExists: rtdb.exists == null ? 'UNAVAILABLE' : rtdb.exists ? 'true' : 'false',
    rtdbFeedState: rtdb.feedState,
    rtdbChunkCount: rtdb.chunkCount ?? 'UNAVAILABLE',
    rtdbFinalizedCount: rtdb.finalizedCount ?? 'UNAVAILABLE',
    rtdbFinalizedRatio: finalizedRatio,
    rtdbFirstTs: formatTs(rtdb.firstTs ?? transcriptFirstTs),
    rtdbLastTs: formatTs(rtdb.lastTs ?? transcriptLastTs),
    capturedDurationMin: formatDurationMin(capturedDurationMs),
    durationFlag,
    transcriptChunkCount,
    wordCount,
    wordCountSource,
    auditEventCount,
    auditTimeline,
    status,
    notes: [notes, rtdb.note !== 'public RTDB' ? rtdb.note : null].filter(Boolean).join('; '),
    dataSource: `${session.source} + ${rtdb.note}${adminMode ? ' + Admin audit/transcripts' : ''}`,
  }
}

async function main() {
  console.log('[audit-show-sessions] READ-ONLY — no writes')
  console.log(`[audit] RTDB_ROOT=${RTDB_ROOT}`)
  console.log(`[audit] PUBLIC_APP_ORIGIN=${PUBLIC_APP_ORIGIN}`)

  const bridge = bridgeFirebaseCliToAdc()
  console.log(`[audit] Auth bridge: ${bridge.detail}`)

  const adminMode = hasAdminCreds()
  console.log(`[audit] Admin SDK: ${adminMode ? 'ENABLED' : 'absent (public fallback)'}`)
  console.log(`[audit] Project target: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unset)'}`)
  console.log('[audit] Recall API: not queried (by design for this script)')

  if (adminMode) {
    // Fail loud if wrong project before scanning.
    const { assertCorrectFirebaseProject } = await import('../lib/firebase/admin')
    const checked = assertCorrectFirebaseProject()
    console.log(`[audit] Project guard OK: ${checked.projectId}`)
  }

  const loaded = adminMode
    ? await loadShowAndSessionsAdmin()
    : await loadShowAndSessionsPublic()

  console.log(
    `[audit] show=${loaded.show.showName} (${loaded.show.showId}) via ${loaded.show.source}`,
  )
  console.log(
    `[audit] sessions=${loaded.sessions.length}${adminMode ? ' (includes drafts)' : ' (non-draft public only)'}`,
  )

  const nowMs = Date.now()
  const rows = await mapPool(loaded.sessions, adminMode ? 4 : 8, (session) =>
    auditOne(session, loaded.show, adminMode, nowMs),
  )

  const outDir = join(process.cwd(), 'exports')
  mkdirSync(outDir, { recursive: true })
  const csvPath = join(outDir, `alf009-session-audit-${new Date().toISOString().slice(0, 10)}.csv`)
  writeCsv(rows, csvPath)

  printTable(rows)

  console.log('\n[audit] status counts:')
  for (const [k, v] of Object.entries(statusCounts(rows)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}\t${k}`)
  }

  const orphan = rows.find((r) => r.sessionId === 'AAhZwKUOyu6Nw6GkFuSF')
  if (orphan) {
    console.log('\n[audit] ORPHAN DETAIL AAhZwKUOyu6Nw6GkFuSF:')
    console.log(`  status=${orphan.status}`)
    console.log(`  feedState=${orphan.feedState} rtdbChunks=${orphan.rtdbChunkCount}`)
    console.log(`  audit=${orphan.auditTimeline}`)
    console.log(`  notes=${orphan.notes}`)
  }

  const never = rows.filter((r) => r.status === 'NEVER STARTED' || r.status.startsWith('NEVER STARTED'))
  if (never.length) {
    console.log(`\n[audit] NEVER STARTED (${never.length}):`)
    for (const r of never) {
      console.log(
        `  ${r.sessionId} | ${r.title.slice(0, 50)} | audit=${r.auditTimeline || '(none)'}`,
      )
    }
  }

  const short = rows.filter((r) => r.durationFlag)
  if (short.length) {
    console.log(`\n[audit] SHORT_CAPTURE flags (${short.length}):`)
    for (const r of short.slice(0, 30)) {
      console.log(
        `  ${r.sessionId} | captured=${r.capturedDurationMin}m scheduled=${r.scheduledDurationMin}m | ${r.title.slice(0, 40)}`,
      )
    }
  }

  console.log(`\n[audit] CSV: ${csvPath}`)
  if (!adminMode) {
    console.log(
      '[audit] NOTE: Without Admin credentials, auditLog + transcripts/ + recordingId + draft sessions are UNAVAILABLE. Complete `firebase login --no-localhost` (or set a service account) and re-run.',
    )
  }
}

main().catch((err) => {
  console.error('[audit] fatal', err)
  process.exit(1)
})
